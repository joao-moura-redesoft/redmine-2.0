import { useState, useMemo, useEffect } from 'react';
import { useProjectVersions, useVersionIssues } from '../hooks/useRedmine';
import { RefreshCw, TrendingDown, Flag, CheckCircle2, Clock, ListTodo } from 'lucide-react';
import type { Issue } from '../types/redmine';

const DAY = 24 * 60 * 60 * 1000;

function dateOnly(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function startOfWeek(t: number): number {
  const d = new Date(t);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface BurndownData {
  points: { t: number; ideal: number; actual: number | null }[];
  velocity: { label: string; closed: number }[];
  total: number;
  closed: number;
  estTotal: number;
  estRemaining: number;
}

function compute(issues: Issue[], dueDateIso?: string): BurndownData {
  const total = issues.length;
  const closedIssues = issues.filter(i => i.closed_on);
  const estTotal = issues.reduce((s, i) => s + (i.estimated_hours || 0), 0);
  const estRemaining = issues.filter(i => !i.closed_on).reduce((s, i) => s + (i.estimated_hours || 0), 0);

  // Janela do gráfico: do início mais cedo até o due date (ou hoje, o que for maior).
  const starts = issues.map(i => dateOnly(i.start_date) ?? dateOnly(i.created_on)).filter((x): x is number => x !== null);
  const now = Date.now();
  const start = starts.length ? Math.min(...starts) : now - 14 * DAY;
  const due = dateOnly(dueDateIso);
  const end = Math.max(due ?? now, now);

  const span = Math.max(1, Math.round((end - start) / DAY));
  const step = span > 60 ? 7 : 1; // amostra semanal em sprints longas
  const closedTimes = closedIssues.map(i => dateOnly(i.closed_on)!).filter(x => x !== null);

  const points: BurndownData['points'] = [];
  for (let d = 0; d <= span; d += step) {
    const t = start + d * DAY;
    const ideal = total * (1 - d / span);
    // "actual" só até hoje; futuro fica null (linha para no presente).
    const actual = t <= now ? total - closedTimes.filter(ct => ct <= t).length : null;
    points.push({ t, ideal: Math.max(0, ideal), actual });
  }

  // Velocidade: concluídas por semana.
  const byWeek = new Map<number, number>();
  closedTimes.forEach(ct => { const w = startOfWeek(ct); byWeek.set(w, (byWeek.get(w) || 0) + 1); });
  const velocity = [...byWeek.entries()].sort(([a], [b]) => a - b).map(([w, closed]) => ({
    label: new Date(w).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    closed,
  }));

  return { points, velocity, total, closed: closedIssues.length, estTotal, estRemaining };
}

function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-none">{value}</p>
        <p className="text-[11px] text-slate-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function BurndownChart({ data }: { data: BurndownData }) {
  const W = 600, H = 200, P = 24;
  const max = Math.max(1, data.total);
  const n = data.points.length;
  const x = (i: number) => P + (i / Math.max(1, n - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - v / max) * (H - 2 * P);

  const idealPath = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.ideal)}`).join(' ');
  const actualPts = data.points.map((p, i) => ({ i, p })).filter(({ p }) => p.actual !== null);
  const actualPath = actualPts.map(({ i, p }, k) => `${k === 0 ? 'M' : 'L'}${x(i)},${y(p.actual!)}`).join(' ');

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burndown</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-4 h-0 border-t-2 border-dashed border-slate-400" /> Ideal</span>
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-4 h-0.5 bg-blue-500" /> Real</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* grid horizontal */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={1} />
        ))}
        <path d={idealPath} fill="none" className="stroke-slate-400" strokeWidth={2} strokeDasharray="5 4" />
        {actualPath && <path d={actualPath} fill="none" className="stroke-blue-500" strokeWidth={2.5} strokeLinejoin="round" />}
        {actualPts.map(({ i, p }) => (
          <circle key={i} cx={x(i)} cy={y(p.actual!)} r={2.5} className="fill-blue-500" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 px-5 mt-1">
        <span>{data.points.length ? new Date(data.points[0].t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}</span>
        <span>{data.points.length ? new Date(data.points[data.points.length - 1].t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}</span>
      </div>
    </div>
  );
}

function VelocityChart({ data }: { data: BurndownData }) {
  const max = Math.max(1, ...data.velocity.map(v => v.closed));
  const avg = data.velocity.length ? (data.velocity.reduce((s, v) => s + v.closed, 0) / data.velocity.length) : 0;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Velocidade (concluídas por semana)</h3>
        <span className="text-xs text-slate-500">média {avg.toFixed(1)}/sem</span>
      </div>
      {data.velocity.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Nenhuma tarefa concluída ainda.</p>
      ) : (
        <div className="flex items-end justify-between gap-2 h-32">
          {data.velocity.map(v => (
            <div key={v.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-semibold text-slate-500">{v.closed}</span>
              <div className="w-full flex items-end justify-center h-24">
                <div className="w-full max-w-10 bg-green-500 rounded-t hover:bg-green-600 transition-all" style={{ height: `${(v.closed / max) * 100}%`, minHeight: 4 }} />
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionBurndown({ projectId }: { projectId?: number }) {
  const { data: versions, isLoading: loadingVersions } = useProjectVersions(projectId);
  const [versionId, setVersionId] = useState<number | undefined>(undefined);

  // Seleciona a primeira versão aberta automaticamente ao trocar de projeto.
  useEffect(() => {
    if (!versions?.length) { setVersionId(undefined); return; }
    const open = versions.find(v => v.status === 'open') ?? versions[0];
    setVersionId(open.id);
  }, [versions]);

  const { data: issues, isLoading, isFetching, refetch } = useVersionIssues(projectId, versionId);
  const version = versions?.find(v => v.id === versionId);
  const data = useMemo(() => compute(issues ?? [], version?.due_date), [issues, version]);

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Flag size={30} className="mb-3 opacity-30" />
        <p className="text-sm">Selecione um projeto para ver o burndown da versão.</p>
      </div>
    );
  }

  const pctDone = data.total ? Math.round((data.closed / data.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <select
          value={versionId ?? ''}
          onChange={e => setVersionId(e.target.value ? Number(e.target.value) : undefined)}
          disabled={loadingVersions || !versions?.length}
          className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-72"
        >
          {!versions?.length && <option value="">Nenhuma versão neste projeto</option>}
          {versions?.map(v => <option key={v.id} value={v.id}>{v.name}{v.status !== 'open' ? ` (${v.status})` : ''}</option>)}
        </select>
        <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Atualizar">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400"><RefreshCw size={20} className="animate-spin" /></div>
      ) : !versionId || data.total === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <TrendingDown size={30} className="mb-3 opacity-30" />
          <p className="text-sm">Sem tarefas nesta versão.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat icon={<ListTodo size={16} className="text-blue-600" />} color="bg-blue-50 dark:bg-blue-900/30" label="Total" value={String(data.total)} />
            <Stat icon={<CheckCircle2 size={16} className="text-green-600" />} color="bg-green-50 dark:bg-green-900/30" label={`Concluídas (${pctDone}%)`} value={String(data.closed)} />
            <Stat icon={<TrendingDown size={16} className="text-amber-600" />} color="bg-amber-50 dark:bg-amber-900/30" label="Restantes" value={String(data.total - data.closed)} />
            <Stat icon={<Clock size={16} className="text-violet-600" />} color="bg-violet-50 dark:bg-violet-900/30" label="Horas est. restantes" value={data.estTotal ? `${Math.round(data.estRemaining)}h` : '—'} />
          </div>
          <BurndownChart data={data} />
          <VelocityChart data={data} />
        </>
      )}
    </div>
  );
}
