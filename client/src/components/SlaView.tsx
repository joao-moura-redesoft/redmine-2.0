import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Target,
  AlarmClock,
  CalendarClock,
  CalendarDays,
  Loader2,
  RefreshCw,
  User,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  getSlaAnalytics,
  type SlaAnalytics,
  type SlaOverdueIssue,
  type SlaUpcomingGroup,
} from '../api/analytics';
import { IssueListModal, type ModalIssue } from './IssueListModal';

interface Props {
  projectId?: number;
  onIssueClick: (id: number) => void;
}

const HORIZONS = [7, 14, 30];

// 'YYYY-MM-DD' -> 'dd/mm'
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function Tile({
  icon,
  label,
  value,
  suffix,
  hint,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  suffix?: string;
  hint?: string;
  tone: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick && Number(value) > 0;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-left w-full ${
        clickable
          ? 'hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm cursor-pointer transition-all'
          : 'cursor-default'
      }`}
    >
      <span className={`flex-shrink-0 ${tone}`}>{icon}</span>
      <div className="leading-tight min-w-0">
        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
          {value}
          {suffix && <span className="text-sm font-medium text-slate-400 ml-1">{suffix}</span>}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</div>
        {hint && <div className="text-[11px] text-slate-400 truncate">{hint}</div>}
      </div>
    </button>
  );
}

// Medidor do cumprimento de prazo. Cor por faixa (status), sempre com rótulo.
function DeliveryMeter({ data }: { data: SlaAnalytics }) {
  const { rate, onTime, late, closedWithDue, avgLateDays } = data.delivery;
  const meta =
    rate == null
      ? { label: 'sem dados', bar: 'bg-slate-300', text: 'text-slate-400' }
      : rate >= 90
        ? { label: 'ótimo', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
        : rate >= 70
          ? { label: 'atenção', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
          : { label: 'crítico', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <Target size={15} className="text-slate-400" /> Cumprimento de prazo
          <span className="text-xs font-normal text-slate-400">
            · fechadas nos últimos {data.window.days}d
          </span>
        </h3>
      </div>

      {rate == null ? (
        <p className="text-sm text-slate-400 py-4">
          Nenhuma tarefa com prazo foi fechada na janela.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex items-baseline gap-2 flex-shrink-0">
            <span className={`text-5xl font-bold tabular-nums ${meta.text}`}>{rate}%</span>
            <div className="leading-tight">
              <div className={`text-xs font-semibold ${meta.text}`}>{meta.label}</div>
              <div className="text-xs text-slate-400">no prazo</div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {/* barra empilhada no prazo × atrasadas */}
            <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
              {onTime > 0 && (
                <div
                  className="bg-emerald-500"
                  style={{ width: `${(onTime / closedWithDue) * 100}%` }}
                  title={`${onTime} no prazo`}
                />
              )}
              {late > 0 && (
                <div
                  className="bg-red-500"
                  style={{ width: `${(late / closedWithDue) * 100}%` }}
                  title={`${late} atrasadas`}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <CheckCircle2 size={13} className="text-emerald-500" /> No prazo
                <b className="text-slate-800 dark:text-slate-200 tabular-nums">{onTime}</b>
              </span>
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <AlertTriangle size={13} className="text-red-500" /> Atrasadas
                <b className="text-slate-800 dark:text-slate-200 tabular-nums">{late}</b>
              </span>
              {late > 0 && <span className="text-slate-400">atraso médio {avgLateDays}d</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function OverdueList({
  list,
  onIssueClick,
}: {
  list: SlaOverdueIssue[];
  onIssueClick: (id: number) => void;
}) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {list.length === 0 && <p className="text-sm text-slate-400 py-3">Nada vencido. 🎉</p>}
      {list.map((i) => (
        <button
          key={i.id}
          onClick={() => onIssueClick(i.id)}
          className="w-full flex items-center gap-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 -mx-2 px-2 rounded-md transition-colors"
        >
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums flex-shrink-0 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
            {i.daysOverdue}d
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-slate-700 dark:text-slate-200 truncate">
              <span className="text-blue-600 dark:text-blue-400 font-medium">#{i.id}</span>{' '}
              {i.subject}
            </div>
            <div className="text-xs text-slate-400 truncate">
              venceu {shortDate(i.due_date)}
              {i.assignee ? ` · ${i.assignee}` : ' · sem responsável'}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function UpcomingByAssignee({
  groups,
  horizon,
  onIssueClick,
}: {
  groups: SlaUpcomingGroup[];
  horizon: number;
  onIssueClick: (id: number) => void;
}) {
  if (groups.length === 0)
    return (
      <p className="text-sm text-slate-400 py-3">Nada com prazo nos próximos {horizon} dias.</p>
    );
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="flex items-center gap-2 mb-1.5">
            <User size={13} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{g.name}</span>
            <span className="text-xs text-slate-400 tabular-nums">· {g.count}</span>
          </div>
          <div className="space-y-0.5 pl-5">
            {g.issues.map((i) => (
              <button
                key={i.id}
                onClick={() => onIssueClick(i.id)}
                className="w-full flex items-center gap-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 -mx-2 px-2 rounded-md transition-colors group"
              >
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums flex-shrink-0 ${
                    i.daysUntil <= 0
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {i.daysUntil <= 0 ? 'hoje' : `${i.daysUntil}d`}
                </span>
                <span className="text-sm text-slate-600 dark:text-slate-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  <span className="text-blue-600 dark:text-blue-400 font-medium">#{i.id}</span>{' '}
                  {i.subject}
                </span>
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {shortDate(i.due_date)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlaContent({
  data,
  onIssueClick,
}: {
  data: SlaAnalytics;
  onIssueClick: (id: number) => void;
}) {
  const maxOverdue = Math.max(1, ...data.byAssigneeOverdue.map((a) => a.count));
  const [modal, setModal] = useState<{ title: string; items: ModalIssue[] } | null>(null);

  const upcomingFlat = data.upcoming.flatMap((g) =>
    g.issues.map((i) => ({ ...i, assignee: g.name })),
  );
  const overdueItems: ModalIssue[] = data.overdueList.map((i) => ({
    id: i.id,
    subject: i.subject,
    meta: i.assignee ?? 'sem responsável',
    tag: `${i.daysOverdue}d`,
    tone: 'red',
  }));
  const dueTodayItems: ModalIssue[] = upcomingFlat
    .filter((i) => i.daysUntil <= 0)
    .map((i) => ({ id: i.id, subject: i.subject, meta: i.assignee, tag: 'hoje', tone: 'amber' }));
  const dueSoonItems: ModalIssue[] = upcomingFlat
    .filter((i) => i.daysUntil > 0)
    .map((i) => ({
      id: i.id,
      subject: i.subject,
      meta: i.assignee,
      tag: `${i.daysUntil}d`,
      tone: 'blue',
    }));

  return (
    <div className="space-y-6">
      {data.capped && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Atingiu o teto de 2000 tarefas em alguma consulta — filtre por projeto para números
          exatos.
        </div>
      )}

      <DeliveryMeter data={data} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          icon={<AlarmClock size={22} />}
          tone="text-red-500"
          label="vencidas agora"
          value={data.open.overdue}
          hint={data.open.overdue > 0 ? `atraso médio ${data.open.avgOverdueDays}d` : undefined}
          onClick={() => setModal({ title: 'Vencidas agora', items: overdueItems })}
        />
        <Tile
          icon={<CalendarClock size={22} />}
          tone="text-amber-500"
          label="vencem hoje"
          value={data.open.dueToday}
          onClick={() => setModal({ title: 'Vencem hoje', items: dueTodayItems })}
        />
        <Tile
          icon={<CalendarDays size={22} />}
          tone="text-blue-500"
          label={`vencem em ${data.horizon}d`}
          value={data.open.dueSoon}
          onClick={() =>
            setModal({ title: `Vencem em até ${data.horizon} dias`, items: dueSoonItems })
          }
        />
        <Tile
          icon={<Target size={22} />}
          tone="text-slate-400"
          label="abertas com prazo"
          value={data.open.withDue}
          suffix={`/ ${data.open.total}`}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <AlarmClock size={15} className="text-red-400" /> Vencidas
          </h3>
          <OverdueList list={data.overdueList} onIssueClick={onIssueClick} />
        </section>

        <section className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <User size={15} className="text-slate-400" /> Vencidas por responsável
          </h3>
          <div className="space-y-2">
            {data.byAssigneeOverdue.length === 0 && (
              <p className="text-sm text-slate-400 py-2">—</p>
            )}
            {data.byAssigneeOverdue.map((a) => (
              <div key={a.name} className="flex items-center gap-3">
                <span
                  className="w-28 flex-shrink-0 text-xs text-slate-600 dark:text-slate-300 truncate text-right"
                  title={a.name}
                >
                  {a.name}
                </span>
                <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500/80 rounded-full flex items-center justify-end px-2"
                    style={{ width: `${Math.max((a.count / maxOverdue) * 100, 10)}%` }}
                  >
                    <span className="text-[10px] font-bold text-white">{a.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <CalendarDays size={15} className="text-blue-400" /> Vencendo nos próximos {data.horizon}{' '}
          dias
        </h3>
        <UpcomingByAssignee
          groups={data.upcoming}
          horizon={data.horizon}
          onIssueClick={onIssueClick}
        />
      </section>

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

export function SlaView({ projectId, onIssueClick }: Props) {
  const [horizon, setHorizon] = useState<number>(7);
  const q = useQuery({
    queryKey: ['analytics', 'sla', projectId, horizon],
    queryFn: () => getSlaAnalytics(projectId, { horizon }),
    staleTime: 60_000,
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Target size={18} className="text-blue-500" /> Prazos & SLA
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Estamos entregando no prazo? Vencidas, o que vence a seguir e cumprimento de prazo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {HORIZONS.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`text-xs font-medium px-3 py-1.5 transition-colors ${
                  horizon === h
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={`Horizonte de ${h} dias`}
              >
                {h}d
              </button>
            ))}
          </div>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {q.isFetching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Atualizar
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : q.isError || !q.data ? (
        <div className="text-center py-16 text-slate-500">
          Não consegui carregar os prazos. Tente atualizar.
        </div>
      ) : (
        <SlaContent data={q.data} onIssueClick={onIssueClick} />
      )}
    </div>
  );
}
