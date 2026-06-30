import { useState, useMemo, useEffect } from 'react';
import { useProjectVersions, useVersionIssues } from '../hooks/useRedmine';
import {
  RefreshCw,
  TrendingDown,
  Flag,
  CheckCircle2,
  Clock,
  ListTodo,
  CalendarClock,
  Gauge,
} from 'lucide-react';
import type { Issue } from '../types/redmine';

const DAY = 24 * 60 * 60 * 1000;

type Metric = 'count' | 'hours';

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

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

type Status = 'done' | 'ahead' | 'ontrack' | 'behind' | 'unknown';

interface BurndownData {
  metric: Metric;
  domainStart: number;
  domainEnd: number;
  max: number;
  now: number;
  points: { t: number; ideal: number; actual: number | null }[];
  forecast: { t: number; v: number }[] | null;
  velocity: { label: string; closed: number }[];
  total: number;
  closed: number;
  totalValue: number;
  remainingValue: number;
  idealNow: number;
  burnPerDay: number;
  predictedDate: number | null;
  dueDate: number | null;
  status: Status;
  estTotal: number;
  estRemaining: number;
  unit: string;
}

function compute(issues: Issue[], metric: Metric, dueDateIso?: string): BurndownData {
  const valueOf = (i: Issue) => (metric === 'hours' ? i.estimated_hours || 0 : 1);

  const total = issues.length;
  const closedIssues = issues.filter((i) => i.closed_on);
  const estTotal = issues.reduce((s, i) => s + (i.estimated_hours || 0), 0);
  const estRemaining = issues
    .filter((i) => !i.closed_on)
    .reduce((s, i) => s + (i.estimated_hours || 0), 0);

  const totalValue = issues.reduce((s, i) => s + valueOf(i), 0);

  // Janela do gráfico: do início mais cedo até o due date (ou hoje, o que for maior).
  const starts = issues
    .map((i) => dateOnly(i.start_date) ?? dateOnly(i.created_on))
    .filter((x): x is number => x !== null);
  const now = Date.now();
  const start = starts.length ? Math.min(...starts) : now - 14 * DAY;
  const due = dateOnly(dueDateIso);
  const idealEnd = Math.max(due ?? now, now);

  // Concluídas com timestamp + valor da métrica, ordenadas no tempo.
  const closedEvents = closedIssues
    .map((i) => ({ t: dateOnly(i.closed_on)!, v: valueOf(i) }))
    .filter((e) => e.t !== null)
    .sort((a, b) => a.t - b.t);

  const valueClosedBy = (t: number) =>
    closedEvents.reduce((s, e) => (e.t <= t ? s + e.v : s), 0);

  const remainingValue = totalValue - valueClosedBy(now);

  // Ritmo médio de queima por dia, desde o início até agora.
  const daysElapsed = Math.max(1, (now - start) / DAY);
  const burnPerDay = (totalValue - remainingValue) / daysElapsed;

  // Previsão de conclusão por extrapolação do ritmo atual.
  const predictedDate =
    remainingValue > 0 && burnPerDay > 0
      ? now + (remainingValue / burnPerDay) * DAY
      : remainingValue <= 0
        ? now
        : null;

  // Domínio do eixo X: inclui a previsão (limitada a 1 ano à frente).
  const cap = now + 365 * DAY;
  const domainEnd = Math.max(idealEnd, predictedDate != null ? Math.min(predictedDate, cap) : now);
  const domainStart = start;

  const idealSpan = Math.max(1, idealEnd - start);
  const span = Math.max(1, Math.round((now - start) / DAY));
  const step = span > 60 ? 7 : 1; // amostra semanal em sprints longas

  // Linha "real": amostra do início até hoje.
  const points: BurndownData['points'] = [];
  for (let d = 0; d <= span; d += step) {
    const t = Math.min(now, start + d * DAY);
    const ideal = totalValue * (1 - (t - start) / idealSpan);
    points.push({ t, ideal: Math.max(0, ideal), actual: totalValue - valueClosedBy(t) });
  }
  // Garante o ponto exato de hoje.
  if (points.length === 0 || points[points.length - 1].t < now) {
    points.push({
      t: now,
      ideal: Math.max(0, totalValue * (1 - (now - start) / idealSpan)),
      actual: remainingValue,
    });
  }

  const forecast =
    predictedDate != null && remainingValue > 0
      ? [
          { t: now, v: remainingValue },
          { t: Math.min(predictedDate, cap), v: predictedDate <= cap ? 0 : remainingValue * 0.05 },
        ]
      : null;

  const idealNow = Math.max(0, totalValue * (1 - (now - start) / idealSpan));
  let status: Status = 'unknown';
  if (remainingValue <= 0) status = 'done';
  else if (closedEvents.length === 0) status = 'unknown';
  else if (remainingValue > idealNow * 1.05) status = 'behind';
  else if (remainingValue < idealNow * 0.95) status = 'ahead';
  else status = 'ontrack';

  // Velocidade: concluídas por semana (sempre em nº de tarefas).
  const byWeek = new Map<number, number>();
  closedEvents.forEach((e) => {
    const w = startOfWeek(e.t);
    byWeek.set(w, (byWeek.get(w) || 0) + 1);
  });
  const velocity = [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([w, closed]) => ({ label: fmtDate(w), closed }));

  return {
    metric,
    domainStart,
    domainEnd,
    max: Math.max(1, totalValue),
    now,
    points,
    forecast,
    velocity,
    total,
    closed: closedIssues.length,
    totalValue,
    remainingValue,
    idealNow,
    burnPerDay,
    predictedDate,
    dueDate: due,
    status,
    estTotal,
    estRemaining,
    unit: metric === 'hours' ? 'h' : '',
  };
}

function Stat({
  icon,
  label,
  value,
  color,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const base =
    'bg-white dark:bg-slate-900 border rounded-xl p-3 flex items-center gap-3 text-left w-full transition-colors';
  const border = active
    ? 'border-blue-400 ring-1 ring-blue-400'
    : 'border-slate-200 dark:border-slate-700';
  const inner = (
    <>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-none">{value}</p>
        <p className="text-[11px] text-slate-500 mt-1">{label}</p>
      </div>
    </>
  );
  if (!onClick) return <div className={`${base} ${border}`}>{inner}</div>;
  return (
    <button
      onClick={onClick}
      className={`${base} ${border} hover:border-blue-300 dark:hover:border-blue-600 hover:bg-slate-50 dark:hover:bg-slate-800/60`}
    >
      {inner}
    </button>
  );
}

type Filter = 'all' | 'closed' | 'open';

function IssueList({
  title,
  issues,
  metric,
  onIssueClick,
}: {
  title: string;
  issues: Issue[];
  metric: Metric;
  onIssueClick?: (id: number) => void;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
        <ListTodo size={14} className="text-blue-500" />
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <span className="text-xs text-slate-400">· {issues.length}</span>
      </div>
      {issues.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Nenhuma tarefa.</p>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-slate-800 max-h-80 overflow-y-auto">
          {issues.map((issue) => {
            const est = issue.estimated_hours || 0;
            return (
              <button
                key={issue.id}
                onClick={() => onIssueClick?.(issue.id)}
                disabled={!onIssueClick}
                className="w-full text-left flex items-center gap-2.5 px-4 py-2 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors group disabled:cursor-default"
              >
                <span className="text-xs font-medium text-slate-400 flex-shrink-0 w-12">
                  #{issue.id}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate">
                    {issue.subject}
                  </p>
                  {issue.assigned_to && (
                    <p className="text-[11px] text-slate-400 truncate">{issue.assigned_to.name}</p>
                  )}
                </div>
                {metric === 'hours' && est > 0 && (
                  <span className="text-[10px] font-medium text-violet-600 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded flex-shrink-0">
                    {est}h
                  </span>
                )}
                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex-shrink-0">
                  {issue.status.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  done: { label: 'Concluído', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  ahead: { label: 'Adiantado', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' },
  ontrack: { label: 'No ritmo', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  behind: { label: 'Atrasado', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' },
  unknown: { label: 'Sem dados', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

function BurndownChart({ data }: { data: BurndownData }) {
  const W = 600,
    H = 200,
    P = 28;
  const { max, domainStart, domainEnd, now } = data;
  const span = Math.max(1, domainEnd - domainStart);
  const x = (t: number) => P + ((t - domainStart) / span) * (W - 2 * P);
  const y = (v: number) => P + (1 - v / max) * (H - 2 * P);

  const idealPath = data.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.ideal)}`)
    .join(' ');
  const actualPts = data.points.filter((p) => p.actual !== null);
  const actualPath = actualPts
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.t)},${y(p.actual!)}`)
    .join(' ');
  const forecastPath = data.forecast
    ? data.forecast.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.t)},${y(p.v)}`).join(' ')
    : '';

  const fmtVal = (v: number) =>
    data.metric === 'hours' ? `${Math.round(v)}h` : String(Math.round(v));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Burndown {data.metric === 'hours' ? '(horas)' : '(tarefas)'}
        </h3>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-4 h-0 border-t-2 border-dashed border-slate-400" /> Ideal
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-4 h-0.5 bg-blue-500" /> Real
          </span>
          {data.forecast && (
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-4 h-0 border-t-2 border-dotted border-violet-500" /> Previsão
            </span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* grid horizontal + escala */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={P}
              x2={W - P}
              y1={y(max * f)}
              y2={y(max * f)}
              className="stroke-slate-100 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text x={4} y={y(max * f) + 3} className="fill-slate-400 text-[9px]">
              {fmtVal(max * f)}
            </text>
          </g>
        ))}

        {/* marcador: hoje */}
        <line
          x1={x(now)}
          x2={x(now)}
          y1={P}
          y2={H - P}
          className="stroke-slate-300 dark:stroke-slate-600"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <text x={x(now)} y={P - 4} textAnchor="middle" className="fill-slate-400 text-[9px]">
          hoje
        </text>

        {/* marcador: due date */}
        {data.dueDate != null && data.dueDate >= domainStart && data.dueDate <= domainEnd && (
          <>
            <line
              x1={x(data.dueDate)}
              x2={x(data.dueDate)}
              y1={P}
              y2={H - P}
              className="stroke-amber-400"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={x(data.dueDate)}
              y={P - 4}
              textAnchor="middle"
              className="fill-amber-500 text-[9px]"
            >
              prazo
            </text>
          </>
        )}

        <path
          d={idealPath}
          fill="none"
          className="stroke-slate-400"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        {forecastPath && (
          <path
            d={forecastPath}
            fill="none"
            className="stroke-violet-500"
            strokeWidth={2}
            strokeDasharray="1 4"
            strokeLinecap="round"
          />
        )}
        {actualPath && (
          <path
            d={actualPath}
            fill="none"
            className="stroke-blue-500"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
        {actualPts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.actual!)} r={2.5} className="fill-blue-500">
            <title>
              {fmtDate(p.t)}: {fmtVal(p.actual!)} restante{data.metric === 'hours' ? '' : 's'}
            </title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 px-7 mt-1">
        <span>{fmtDate(domainStart)}</span>
        <span>{fmtDate(domainEnd)}</span>
      </div>
    </div>
  );
}

function VelocityChart({ data }: { data: BurndownData }) {
  const max = Math.max(1, ...data.velocity.map((v) => v.closed));
  const avg = data.velocity.length
    ? data.velocity.reduce((s, v) => s + v.closed, 0) / data.velocity.length
    : 0;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Velocidade (concluídas por semana)
        </h3>
        <span className="text-xs text-slate-500">média {avg.toFixed(1)}/sem</span>
      </div>
      {data.velocity.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Nenhuma tarefa concluída ainda.</p>
      ) : (
        <div className="flex items-end justify-between gap-2 h-32">
          {data.velocity.map((v) => (
            <div key={v.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-semibold text-slate-500">{v.closed}</span>
              <div className="w-full flex items-end justify-center h-24">
                <div
                  className="w-full max-w-10 bg-green-500 rounded-t hover:bg-green-600 transition-all"
                  style={{ height: `${(v.closed / max) * 100}%`, minHeight: 4 }}
                />
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionBurndown({
  projectId,
  onIssueClick,
}: {
  projectId?: number;
  onIssueClick?: (id: number) => void;
}) {
  const { data: versions, isLoading: loadingVersions } = useProjectVersions(projectId);
  const [versionId, setVersionId] = useState<number | undefined>(undefined);
  const [metric, setMetric] = useState<Metric>('count');
  const [filter, setFilter] = useState<Filter | null>(null);

  // Seleciona a primeira versão aberta automaticamente ao trocar de projeto.
  useEffect(() => {
    if (!versions?.length) {
      setVersionId(undefined);
      return;
    }
    const open = versions.find((v) => v.status === 'open') ?? versions[0];
    setVersionId(open.id);
  }, [versions]);

  const { data: issues, isLoading, isFetching, refetch } = useVersionIssues(projectId, versionId);
  const version = versions?.find((v) => v.id === versionId);
  const data = useMemo(
    () => compute(issues ?? [], metric, version?.due_date),
    [issues, metric, version],
  );

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Flag size={30} className="mb-3 opacity-30" />
        <p className="text-sm">Selecione um projeto para ver o burndown da versão.</p>
      </div>
    );
  }

  const pctDone = data.total ? Math.round((data.closed / data.total) * 100) : 0;
  const hasHours = data.estTotal > 0;
  const status = STATUS_META[data.status];
  const predictedLabel =
    data.predictedDate != null
      ? new Date(data.predictedDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      : '—';
  // Atraso previsto em relação ao prazo da versão.
  const predictedLate =
    data.predictedDate != null && data.dueDate != null && data.predictedDate > data.dueDate + DAY;

  const all = issues ?? [];
  const filteredIssues =
    filter === 'closed'
      ? all.filter((i) => i.closed_on)
      : filter === 'open'
        ? all.filter((i) => !i.closed_on)
        : all;
  const filterTitle =
    filter === 'closed'
      ? 'Tarefas concluídas'
      : filter === 'open'
        ? 'Tarefas restantes'
        : 'Todas as tarefas';
  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? null : f));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={versionId ?? ''}
            onChange={(e) => setVersionId(e.target.value ? Number(e.target.value) : undefined)}
            disabled={loadingVersions || !versions?.length}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-72"
          >
            {!versions?.length && <option value="">Nenhuma versão neste projeto</option>}
            {versions?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.status !== 'open' ? ` (${v.status})` : ''}
              </option>
            ))}
          </select>
          {data.total > 0 && (
            <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${status.cls}`}>
              {status.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle métrica: tarefas x horas */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
            <button
              onClick={() => setMetric('count')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${metric === 'count' ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}
            >
              Tarefas
            </button>
            <button
              onClick={() => hasHours && setMetric('hours')}
              disabled={!hasHours}
              title={hasHours ? '' : 'Sem horas estimadas nesta versão'}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${metric === 'hours' ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-slate-500'} ${!hasHours ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Horas
            </button>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Atualizar"
          >
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      ) : !versionId || data.total === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <TrendingDown size={30} className="mb-3 opacity-30" />
          <p className="text-sm">Sem tarefas nesta versão.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat
              icon={<ListTodo size={16} className="text-blue-600" />}
              color="bg-blue-50 dark:bg-blue-900/30"
              label="Total"
              value={String(data.total)}
              onClick={() => toggle('all')}
              active={filter === 'all'}
            />
            <Stat
              icon={<CheckCircle2 size={16} className="text-green-600" />}
              color="bg-green-50 dark:bg-green-900/30"
              label={`Concluídas (${pctDone}%)`}
              value={String(data.closed)}
              onClick={() => toggle('closed')}
              active={filter === 'closed'}
            />
            <Stat
              icon={<TrendingDown size={16} className="text-amber-600" />}
              color="bg-amber-50 dark:bg-amber-900/30"
              label={metric === 'hours' ? 'Horas restantes' : 'Restantes'}
              value={
                metric === 'hours'
                  ? `${Math.round(data.remainingValue)}h`
                  : String(data.total - data.closed)
              }
              onClick={() => toggle('open')}
              active={filter === 'open'}
            />
            <Stat
              icon={<Gauge size={16} className="text-violet-600" />}
              color="bg-violet-50 dark:bg-violet-900/30"
              label={metric === 'hours' ? 'Ritmo (h/dia)' : 'Ritmo (tar./dia)'}
              value={data.burnPerDay > 0 ? data.burnPerDay.toFixed(1) : '—'}
            />
            <Stat
              icon={
                <CalendarClock
                  size={16}
                  className={predictedLate ? 'text-rose-600' : 'text-teal-600'}
                />
              }
              color={
                predictedLate
                  ? 'bg-rose-50 dark:bg-rose-900/30'
                  : 'bg-teal-50 dark:bg-teal-900/30'
              }
              label={predictedLate ? 'Conclusão (após prazo)' : 'Conclusão prevista'}
              value={predictedLabel}
            />
          </div>
          {filter && (
            <IssueList
              title={filterTitle}
              issues={filteredIssues}
              metric={metric}
              onIssueClick={onIssueClick}
            />
          )}
          <BurndownChart data={data} />
          <VelocityChart data={data} />
          {!hasHours && metric === 'count' && (
            <p className="text-[11px] text-slate-400 px-1">
              Dica: cadastre horas estimadas nas tarefas para habilitar o burndown por horas.
            </p>
          )}
        </>
      )}
    </div>
  );
}
