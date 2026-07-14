import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  User,
  Loader2,
  RefreshCw,
  ListTodo,
  PlayCircle,
  AlarmClock,
  CheckCircle2,
  Timer,
  Target,
} from 'lucide-react';
import { getMeAnalytics, type MeAnalytics, type MeKpi } from '../api/analytics';
import { IssueListModal, type ModalIssue } from './IssueListModal';

interface Props {
  onIssueClick: (id: number) => void;
}

function weekLabel(key: string): string {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

// Converte um KPI pessoal em itens de modal, com etiqueta contextual.
function kpiToModal(kpi: MeKpi, kind: 'open' | 'overdue' | 'done'): ModalIssue[] {
  const today = new Date().toISOString().slice(0, 10);
  return kpi.issues.map((i) => {
    if (kind === 'overdue' && i.due_date) {
      const days = Math.round((Date.parse(today) - Date.parse(i.due_date)) / 86400000);
      return { id: i.id, subject: i.subject, tag: `${days}d`, tone: 'red' as const };
    }
    return { id: i.id, subject: i.subject, meta: i.status };
  });
}

function StatCard({
  icon,
  label,
  color,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  count: number;
  onClick?: () => void;
}) {
  const clickable = !!onClick && count > 0;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-start gap-3 text-left w-full ${
        clickable
          ? 'hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm cursor-pointer transition-all'
          : 'cursor-default'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-none tabular-nums">
          {count}
        </p>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{label}</p>
      </div>
    </button>
  );
}

function Throughput({ weeks }: { weeks: MeAnalytics['weeks'] }) {
  const max = Math.max(1, ...weeks.map((w) => w.closed));
  const total = weeks.reduce((s, w) => s + w.closed, 0);
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Minha entrega por semana
        </h3>
        <span className="text-xs text-slate-400">{total} concluídas no período</span>
      </div>
      <div className="flex items-end justify-between gap-2 h-36">
        {weeks.map((w) => (
          <div key={w.key} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums leading-none">
              {w.closed > 0 ? w.closed : ''}
            </span>
            <div className="w-full flex items-end justify-center h-28">
              <div
                className="w-full max-w-8 bg-emerald-500 rounded-t transition-all hover:bg-emerald-600"
                style={{ height: `${(w.closed / max) * 100}%`, minHeight: w.closed > 0 ? 4 : 0 }}
                title={`Semana de ${weekLabel(w.key)}: ${w.closed} concluída(s)`}
              />
            </div>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">{weekLabel(w.key)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function OnTimeAndCycle({ data }: { data: MeAnalytics }) {
  const { rate, onTime, late, closedWithDue, avgLateDays } = data.onTime;
  const meta =
    rate == null
      ? { label: 'sem dados', text: 'text-slate-400' }
      : rate >= 90
        ? { label: 'ótimo', text: 'text-emerald-600 dark:text-emerald-400' }
        : rate >= 70
          ? { label: 'atenção', text: 'text-amber-600 dark:text-amber-400' }
          : { label: 'crítico', text: 'text-red-600 dark:text-red-400' };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Target size={15} className="text-slate-400" /> Meu cumprimento de prazo
        </h3>
        {rate == null ? (
          <p className="text-sm text-slate-400">Nenhuma fechada com prazo na janela.</p>
        ) : (
          <div className="flex items-center gap-4">
            <span className={`text-4xl font-bold tabular-nums ${meta.text}`}>{rate}%</span>
            <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <div className={`font-semibold ${meta.text}`}>{meta.label}</div>
              <div>
                {onTime} no prazo · {late} atrasadas
                {late > 0 && ` (média ${avgLateDays}d)`}
              </div>
              <div className="text-slate-400">de {closedWithDue} com prazo</div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Timer size={15} className="text-slate-400" /> Meu tempo de ciclo
        </h3>
        {data.cycle.count === 0 ? (
          <p className="text-sm text-slate-400">Sem fechadas suficientes na janela.</p>
        ) : (
          <div className="flex items-center gap-6">
            <div>
              <span className="text-4xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                {data.cycle.avg}
              </span>
              <span className="text-sm text-slate-400 ml-1">d médio</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <div>
                mediana{' '}
                <b className="text-slate-700 dark:text-slate-300 tabular-nums">
                  {data.cycle.median}d
                </b>
              </div>
              <div className="text-slate-400">{data.cycle.count} fechadas</div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MeContent({
  data,
  onIssueClick,
}: {
  data: MeAnalytics;
  onIssueClick: (id: number) => void;
}) {
  const [modal, setModal] = useState<{ title: string; items: ModalIssue[] } | null>(null);
  const openModal = (title: string, items: ModalIssue[]) => setModal({ title, items });

  return (
    <div className="space-y-6">
      {data.capped && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Atingiu o teto de 2000 tarefas — os números mostram as primeiras 2000.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<ListTodo size={18} className="text-blue-600 dark:text-blue-400" />}
          color="bg-blue-50 dark:bg-blue-900/30"
          label="Minhas abertas"
          count={data.kpis.open.count}
          onClick={() => openModal('Minhas abertas', kpiToModal(data.kpis.open, 'open'))}
        />
        <StatCard
          icon={<PlayCircle size={18} className="text-cyan-600 dark:text-cyan-400" />}
          color="bg-cyan-50 dark:bg-cyan-900/30"
          label="Em andamento"
          count={data.kpis.inProgress.count}
          onClick={() => openModal('Em andamento', kpiToModal(data.kpis.inProgress, 'open'))}
        />
        <StatCard
          icon={<AlarmClock size={18} className="text-red-600 dark:text-red-400" />}
          color="bg-red-50 dark:bg-red-900/30"
          label="Minhas vencidas"
          count={data.kpis.overdue.count}
          onClick={() => openModal('Minhas vencidas', kpiToModal(data.kpis.overdue, 'overdue'))}
        />
        <StatCard
          icon={<CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />}
          color="bg-emerald-50 dark:bg-emerald-900/30"
          label={`Concluídas (${data.days}d)`}
          count={data.kpis.completed.count}
          onClick={() =>
            openModal(
              `Concluídas nos últimos ${data.days} dias`,
              kpiToModal(data.kpis.completed, 'done'),
            )
          }
        />
      </div>

      <Throughput weeks={data.weeks} />
      <OnTimeAndCycle data={data} />

      {modal && (
        <IssueListModal
          title={modal.title}
          items={modal.items}
          onClose={() => setModal(null)}
          onIssueClick={onIssueClick}
        />
      )}
    </div>
  );
}

export function MeView({ onIssueClick }: Props) {
  const q = useQuery({
    queryKey: ['analytics', 'me'],
    queryFn: () => getMeAnalytics(),
    staleTime: 60_000,
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <User size={18} className="text-blue-500" /> Meu desempenho
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Sua entrega ao longo do tempo: throughput, tempo de ciclo e cumprimento de prazo.
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
          Não consegui carregar seu desempenho. Tente atualizar.
        </div>
      ) : (
        <MeContent data={q.data} onIssueClick={onIssueClick} />
      )}
    </div>
  );
}
