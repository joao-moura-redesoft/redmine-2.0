import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Clock,
  Hourglass,
  Layers,
  Loader2,
  RefreshCw,
  Timer,
  User,
} from 'lucide-react';
import { getFlowAnalytics, type FlowAnalytics } from '../api/analytics';

interface Props {
  projectId?: number;
  onIssueClick: (id: number) => void;
}

const num = (n: number | null | undefined) => (n == null ? '—' : n);

function Tile({
  icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  suffix?: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
      <span className={`flex-shrink-0 ${tone}`}>{icon}</span>
      <div className="leading-tight min-w-0">
        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
          {value}
          {suffix && <span className="text-sm font-medium text-slate-400 ml-1">{suffix}</span>}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</div>
      </div>
    </div>
  );
}

// Badge de dias parada, colorido pelo bucket.
function DaysBadge({ days, watch, stuck }: { days: number; watch: number; stuck: number }) {
  const cls =
    days >= stuck
      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
      : days >= watch
        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums flex-shrink-0 ${cls}`}>
      {days}d
    </span>
  );
}

function AgingBar({ data }: { data: FlowAnalytics }) {
  const total = data.totalOpen || 1;
  const seg = [
    { key: 'fresh', label: 'Em dia', value: data.buckets.fresh, color: 'bg-emerald-500' },
    { key: 'watch', label: 'Atenção', value: data.buckets.watch, color: 'bg-amber-500' },
    { key: 'stuck', label: 'Paradas', value: data.buckets.stuck, color: 'bg-red-500' },
  ];
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {seg.map(
          (s) =>
            s.value > 0 && (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ),
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
        {seg.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />
            {s.label}
            <b className="text-slate-800 dark:text-slate-200 tabular-nums">{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Bottlenecks({ data }: { data: FlowAnalytics }) {
  const max = Math.max(1, ...data.statusDistribution.map((s) => s.count));
  return (
    <div className="space-y-2.5">
      {data.statusDistribution.map((s) => (
        <div key={s.status} className="flex items-center gap-3">
          <div className="w-32 flex-shrink-0 text-sm text-slate-600 dark:text-slate-300 truncate" title={s.status}>
            {s.status}
          </div>
          <div className="flex-1 relative h-6 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-blue-500/25 dark:bg-blue-500/30"
              style={{ width: `${(s.count / max) * 100}%` }}
            />
            {s.stuck > 0 && (
              <div
                className="absolute inset-y-0 left-0 bg-red-500/40"
                style={{ width: `${(s.stuck / max) * 100}%` }}
                title={`${s.stuck} paradas`}
              />
            )}
            <div className="absolute inset-0 flex items-center px-2 gap-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{s.count}</span>
              {s.stuck > 0 && <span className="text-red-600 dark:text-red-400 tabular-nums">{s.stuck} parada(s)</span>}
              <span className="ml-auto text-slate-400 tabular-nums">~{s.avgAge}d médio</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FlowView({ projectId, onIssueClick }: Props) {
  const q = useQuery({
    queryKey: ['analytics', 'flow', projectId],
    queryFn: () => getFlowAnalytics(projectId),
    staleTime: 60_000,
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Activity size={18} className="text-blue-500" /> Fluxo
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Onde o trabalho empaca: envelhecimento, gargalos por status e tempo de ciclo.
          </p>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          {q.isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Atualizar
        </button>
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : q.isError || !q.data ? (
        <div className="text-center py-16 text-slate-500">
          Não consegui carregar as métricas. Tente atualizar.
        </div>
      ) : (
        <FlowContent data={q.data} onIssueClick={onIssueClick} />
      )}
    </div>
  );
}

function FlowContent({ data, onIssueClick }: { data: FlowAnalytics; onIssueClick: (id: number) => void }) {
  const { watch, stuck } = data.thresholds;
  return (
    <div className="space-y-6">
      {data.capped && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Mostrando as primeiras 2000 tarefas abertas — filtre por projeto para números exatos.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={<Layers size={22} />} label="tarefas abertas" value={data.totalOpen} tone="text-blue-500" />
        <Tile
          icon={<AlertTriangle size={22} />}
          label={`paradas (${stuck}d+ sem update)`}
          value={data.buckets.stuck}
          tone="text-red-500"
        />
        <Tile
          icon={<Timer size={22} />}
          label="ciclo médio (fechadas 30d)"
          value={num(data.cycle.avg)}
          suffix="d"
          tone="text-violet-500"
        />
        <Tile icon={<Hourglass size={22} />} label="mais antiga" value={data.oldest} suffix="d" tone="text-amber-500" />
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Clock size={15} className="text-slate-400" /> Envelhecimento do WIP
        </h3>
        <AgingBar data={data} />
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Layers size={15} className="text-slate-400" /> Gargalos por status
          <span className="text-xs font-normal text-slate-400">(barra vermelha = paradas)</span>
        </h3>
        <Bottlenecks data={data} />
      </section>

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <Hourglass size={15} className="text-slate-400" /> Mais paradas
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.agingList.length === 0 && <p className="text-sm text-slate-400 py-3">Nada parado. 🎉</p>}
            {data.agingList.map((i) => (
              <button
                key={i.id}
                onClick={() => onIssueClick(i.id)}
                className="w-full flex items-center gap-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 -mx-2 px-2 rounded-md transition-colors"
              >
                <DaysBadge days={i.days} watch={watch} stuck={stuck} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-700 dark:text-slate-200 truncate">
                    <span className="text-blue-600 dark:text-blue-400 font-medium">#{i.id}</span> {i.subject}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {i.status}
                    {i.assignee ? ` · ${i.assignee}` : ' · sem responsável'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <User size={15} className="text-slate-400" /> Paradas por responsável
          </h3>
          <div className="space-y-1.5">
            {data.stuckByAssignee.length === 0 && <p className="text-sm text-slate-400 py-2">—</p>}
            {data.stuckByAssignee.map((a) => (
              <div key={a.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300 truncate">{a.name}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums ml-2">{a.count}</span>
              </div>
            ))}
          </div>
          {data.cycle.count > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
              Ciclo (mediana): <b className="text-slate-700 dark:text-slate-300 tabular-nums">{data.cycle.median}d</b>{' '}
              · {data.cycle.count} fechada(s) em 30d
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
