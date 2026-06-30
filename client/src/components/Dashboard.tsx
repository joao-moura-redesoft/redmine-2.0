import { useMemo, useState, useEffect } from 'react';
import {
  useIssues,
  useCompletedIssues,
  useToReviewIssues,
  useTimeEntries,
} from '../hooks/useRedmine';
import { useNewToday } from '../hooks/useNewToday';
import { getReviewAlert, getMissingFields } from '../utils/alerts';
import { loadArchived } from '../utils/archive';
import {
  CheckCircle2,
  Check,
  Clock,
  AlertTriangle,
  ListTodo,
  TrendingUp,
  Bell,
  Hourglass,
  Flag,
  Archive,
  Flame,
  PlayCircle,
  Sparkles,
  ArrowRight,
  X,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Timer,
} from 'lucide-react';
import type { Issue } from '../types/redmine';
import { ThroughputChart } from './ThroughputChart';

function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

const PRIORITY_ORDER = ['Imediata', 'Urgente', 'Alta', 'Normal', 'Média', 'Baixa'];
const PRIORITY_BAR: Record<string, string> = {
  Imediata: 'bg-red-600',
  Urgente: 'bg-red-500',
  Alta: 'bg-orange-500',
  Normal: 'bg-blue-500',
  Média: 'bg-blue-500',
  Baixa: 'bg-slate-400',
};

function StatCard({
  icon,
  label,
  color,
  issues,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  issues: Issue[];
  onSelect: (label: string, issues: Issue[]) => void;
}) {
  const clickable = issues.length > 0;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onSelect(label, issues)}
      className={`bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3 text-left w-full ${
        clickable
          ? 'hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all'
          : 'cursor-default'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-800 leading-none">{issues.length}</p>
        <p className="text-xs font-medium text-slate-500 mt-1">{label}</p>
      </div>
    </button>
  );
}

/* ── Painel de tarefas referenciadas por um KPI ── */
function KpiModal({
  label,
  issues,
  onClose,
  onIssueClick,
}: {
  label: string;
  issues: Issue[];
  onClose: () => void;
  onIssueClick: (id: number) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const today = new Date().toISOString().split('T')[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">
            {label} <span className="text-slate-400 font-normal">· {issues.length}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-2">
          {issues.map((issue) => {
            const overdue = issue.due_date && issue.due_date < today;
            return (
              <button
                key={issue.id}
                onClick={() => {
                  onIssueClick(issue.id);
                  onClose();
                }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors group"
              >
                <span className="text-xs font-medium text-slate-400 flex-shrink-0">
                  #{issue.id}
                </span>
                <span className="text-sm text-slate-700 group-hover:text-blue-700 truncate flex-1">
                  {issue.subject}
                </span>
                {issue.assigned_to && (
                  <span className="text-[10px] text-slate-400 flex-shrink-0 max-w-28 truncate">
                    {issue.assigned_to.name}
                  </span>
                )}
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                    overdue ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {issue.status.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Resumo do dia (standup) ── */
function StandupModal({
  open,
  completed,
  onClose,
  onIssueClick,
}: {
  open: Issue[];
  completed: Issue[];
  onClose: () => void;
  onIssueClick: (id: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const done = completed.filter(
    (i) => (i.closed_on || i.updated_on || '').split('T')[0] >= yesterday,
  );
  const doing = open.filter((i) => i.status.name.toLowerCase().includes('andamento'));
  const blocked = open.filter((i) => i.status.name.toLowerCase().includes('impedi'));

  const sections: { emoji: string; title: string; list: Issue[] }[] = [
    { emoji: '✅', title: 'Concluí', list: done },
    { emoji: '🔧', title: 'Em andamento', list: doing },
    { emoji: '🚧', title: 'Impedido', list: blocked },
  ];

  const text = sections
    .map(
      (s) =>
        `${s.emoji} ${s.title}:\n${s.list.length ? s.list.map((i) => `- #${i.id} ${i.subject}`).join('\n') : '- (nenhuma)'}`,
    )
    .join('\n\n');

  const copy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Resumo do dia</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-4 space-y-4">
          {sections.map((s) => (
            <div key={s.title}>
              <p className="text-xs font-semibold text-slate-700 mb-1.5">
                {s.emoji} {s.title}{' '}
                <span className="text-slate-400 font-normal">· {s.list.length}</span>
              </p>
              {s.list.length === 0 ? (
                <p className="text-xs text-slate-400 pl-1">(nenhuma)</p>
              ) : (
                <div className="space-y-0.5">
                  {s.list.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => {
                        onIssueClick(i.id);
                        onClose();
                      }}
                      className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 group"
                    >
                      <span className="text-xs font-medium text-slate-400 flex-shrink-0">
                        #{i.id}
                      </span>
                      <span className="text-xs text-slate-700 group-hover:text-blue-700 truncate">
                        {i.subject}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Props {
  onIssueClick: (id: number) => void;
}

function fmtH(h: number): string {
  if (h === 0) return '0h';
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

function TimeSummaryWidget() {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 8) + '01';
  const weekStart = (() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().split('T')[0];
  })();

  const { data: entries, isLoading } = useTimeEntries({ from: monthStart, to: today });

  const stats = useMemo(() => {
    if (!entries) return null;
    const todayH = entries.filter((e) => e.spent_on === today).reduce((s, e) => s + e.hours, 0);
    const weekH = entries.filter((e) => e.spent_on >= weekStart).reduce((s, e) => s + e.hours, 0);
    const monthH = entries.reduce((s, e) => s + e.hours, 0);

    const byProject = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.project.name] = (acc[e.project.name] ?? 0) + e.hours;
      return acc;
    }, {});
    const topProjects = Object.entries(byProject)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    const maxH = topProjects[0]?.[1] ?? 1;

    return { todayH, weekH, monthH, topProjects, maxH };
  }, [entries, today, weekStart]);

  if (isLoading)
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-2 text-slate-400 text-sm">
        <Timer size={15} className="animate-pulse" /> Carregando horas…
      </div>
    );
  if (!stats) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <Timer size={15} className="text-blue-500" /> Horas apontadas
      </h3>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Hoje', value: stats.todayH, color: 'text-blue-600 bg-blue-50' },
          { label: 'Semana', value: stats.weekH, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Mês', value: stats.monthH, color: 'text-violet-600 bg-violet-50' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-lg px-3 py-2.5 ${color.split(' ')[1]}`}>
            <p className={`text-xl font-bold ${color.split(' ')[0]}`}>{fmtH(value)}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
      {stats.topProjects.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
            Por projeto
          </p>
          {stats.topProjects.map(([name, hours]) => (
            <div key={name} className="flex items-center gap-3">
              <span className="text-xs text-slate-600 w-36 truncate flex-shrink-0 text-right">
                {name}
              </span>
              <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full flex items-center justify-end px-1.5"
                  style={{ width: `${Math.max((hours / stats.maxH) * 100, 10)}%` }}
                >
                  <span className="text-[10px] font-bold text-white">{fmtH(hours)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {entries?.length === 0 && (
        <p className="text-sm text-slate-400">Nenhuma hora apontada este mês.</p>
      )}
    </div>
  );
}

export function Dashboard({ onIssueClick }: Props) {
  const { data: openRaw } = useIssues();
  const { data: completed } = useCompletedIssues();
  const { data: toReview } = useToReviewIssues();
  const [hideArchived, setHideArchived] = useState(true);
  const [selectedKpi, setSelectedKpi] = useState<{ label: string; issues: Issue[] } | null>(null);
  const [showStandup, setShowStandup] = useState(false);
  const newToday = useNewToday(openRaw);

  const showKpi = (label: string, issues: Issue[]) => setSelectedKpi({ label, issues });

  // Aplica filtro de arquivadas
  const open = useMemo(() => {
    if (!openRaw) return openRaw;
    if (!hideArchived) return openRaw;
    const archived = loadArchived();
    return openRaw.filter((i) => !archived.has(i.id));
  }, [openRaw, hideArchived]);

  const archivedCount = useMemo(() => {
    if (!openRaw) return 0;
    const archived = loadArchived();
    return openRaw.filter((i) => archived.has(i.id)).length;
  }, [openRaw]);

  const stats = useMemo(() => {
    const isClosed = (i: Issue) => {
      const n = i.status.name.toLowerCase();
      return n.includes('fechad') || n.includes('cancelad');
    };
    const openIssues = (open ?? []).filter((i) => !isClosed(i));
    const today = new Date().toISOString().split('T')[0];
    const weekStart = startOfWeek().toISOString().split('T')[0];

    const overdue = openIssues.filter((i) => i.due_date && i.due_date < today);
    const reviewToday = openIssues.filter((i) => getReviewAlert(i) === 'today');
    const reviewOverdue = openIssues.filter((i) => getReviewAlert(i) === 'overdue');
    const missing = openIssues.filter((i) => getMissingFields(i).length > 0);

    const completedThisWeek = (completed ?? []).filter((i) => {
      const date = i.closed_on || i.updated_on;
      return date && date.split('T')[0] >= weekStart;
    });

    const byStatus = openIssues.reduce<Record<string, number>>((acc, i) => {
      acc[i.status.name] = (acc[i.status.name] || 0) + 1;
      return acc;
    }, {});

    const byPriority = openIssues.reduce<Record<string, number>>((acc, i) => {
      acc[i.priority.name] = (acc[i.priority.name] || 0) + 1;
      return acc;
    }, {});

    const ageBuckets = [
      { label: '0–2 dias', min: 0, max: 2, count: 0 },
      { label: '3–7 dias', min: 3, max: 7, count: 0 },
      { label: '1–2 sem', min: 8, max: 14, count: 0 },
      { label: '2–4 sem', min: 15, max: 30, count: 0 },
      { label: '+30 dias', min: 31, max: Infinity, count: 0 },
    ];
    openIssues.forEach((i) => {
      if (!i.created_on) return;
      const days = Math.floor((Date.now() - new Date(i.created_on).getTime()) / 86400000);
      const b = ageBuckets.find((b) => days >= b.min && days <= b.max);
      if (b) b.count++;
    });

    const emAndamento = openIssues.filter((i) => i.status.name.toLowerCase().includes('andamento'));
    // Paradas = sem atividade (updated_on) há mais de 30 dias
    const stale30 = openIssues.filter((i) => {
      if (!i.updated_on) return false;
      const days = (Date.now() - new Date(i.updated_on).getTime()) / 86400000;
      return days > 30;
    });

    return {
      openIssues,
      overdue,
      reviewToday,
      reviewOverdue,
      missing,
      completedThisWeek,
      byStatus,
      byPriority,
      ageBuckets,
      emAndamento,
      stale30,
    };
  }, [open, completed]);

  const maxStatus = Math.max(1, ...Object.values(stats.byStatus));
  const sortedStatus = Object.entries(stats.byStatus).sort(([, a], [, b]) => b - a);
  const totalPriority = Math.max(1, stats.openIssues.length);
  const sortedPriority = Object.entries(stats.byPriority).sort(([a], [b]) => {
    const ia = PRIORITY_ORDER.indexOf(a),
      ib = PRIORITY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  }) as [string, number][];

  const attention: Issue[] = [
    ...stats.reviewOverdue,
    ...stats.overdue.filter((i) => !stats.reviewOverdue.includes(i)),
    ...stats.reviewToday.filter((i) => !stats.overdue.includes(i)),
    ...stats.missing.filter(
      (i) =>
        !stats.overdue.includes(i) &&
        !stats.reviewOverdue.includes(i) &&
        !stats.reviewToday.includes(i),
    ),
  ].slice(0, 10);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-0.5">Visão geral das suas tarefas</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Resumo do dia (standup) */}
          <button
            onClick={() => setShowStandup(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            title="Gera um resumo pronto para a daily"
          >
            <ClipboardList size={13} />
            Resumo do dia
          </button>
          {/* Toggle arquivadas */}
          <button
            onClick={() => setHideArchived((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              hideArchived
                ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
            }`}
            title="Inclui ou não as tarefas arquivadas localmente"
          >
            <Archive size={13} />
            {hideArchived
              ? `Arquivadas ocultas (${archivedCount})`
              : `Mostrando arquivadas (${archivedCount})`}
          </button>
        </div>
      </div>

      {/* Novidades de hoje */}
      {newToday.length > 0 ? (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <Sparkles size={16} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-blue-800">
              {newToday.length} novidade{newToday.length !== 1 ? 's' : ''} hoje
            </h3>
            <span className="text-xs text-blue-500">
              — tarefas novas ou recém-atribuídas a você
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {newToday.slice(0, 6).map((issue) => (
              <button
                key={issue.id}
                onClick={() => onIssueClick(issue.id)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/70 hover:bg-white border border-blue-100 transition-colors text-left group"
              >
                <ArrowRight size={12} className="text-blue-400 flex-shrink-0" />
                <span className="text-xs font-medium text-slate-400 flex-shrink-0">
                  #{issue.id}
                </span>
                <span className="text-xs text-slate-700 group-hover:text-blue-700 truncate flex-1">
                  {issue.subject}
                </span>
                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                  {issue.status.name}
                </span>
              </button>
            ))}
          </div>
          {newToday.length > 6 && (
            <p className="text-xs text-blue-500 mt-1.5">e mais {newToday.length - 6}…</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2 text-slate-400">
          <Sparkles size={15} />
          <span className="text-sm">Nenhuma tarefa nova hoje.</span>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<ListTodo size={18} className="text-blue-600" />}
          color="bg-blue-50"
          label="Tarefas abertas"
          issues={stats.openIssues}
          onSelect={showKpi}
        />
        <StatCard
          icon={<PlayCircle size={18} className="text-cyan-600" />}
          color="bg-cyan-50"
          label="Em andamento agora"
          issues={stats.emAndamento}
          onSelect={showKpi}
        />
        <StatCard
          icon={<ClipboardCheck size={18} className="text-violet-600" />}
          color="bg-violet-50"
          label="Para eu revisar"
          issues={toReview ?? []}
          onSelect={showKpi}
        />
        <StatCard
          icon={<CheckCircle2 size={18} className="text-green-600" />}
          color="bg-green-50"
          label="Concluídas na semana"
          issues={stats.completedThisWeek}
          onSelect={showKpi}
        />
        <StatCard
          icon={<Flame size={18} className="text-rose-600" />}
          color="bg-rose-50"
          label="Paradas +30 dias"
          issues={stats.stale30}
          onSelect={showKpi}
        />
        <StatCard
          icon={<AlertTriangle size={18} className="text-red-600" />}
          color="bg-red-50"
          label="Prazo vencido"
          issues={stats.overdue}
          onSelect={showKpi}
        />
        <StatCard
          icon={<Bell size={18} className="text-orange-600" />}
          color="bg-orange-50"
          label="Revisão atrasada"
          issues={stats.reviewOverdue}
          onSelect={showKpi}
        />
        <StatCard
          icon={<Clock size={18} className="text-amber-600" />}
          color="bg-amber-50"
          label="Campos faltando"
          issues={stats.missing}
          onSelect={showKpi}
        />
      </div>

      {/* Throughput */}
      <ThroughputChart open={open} completed={completed} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Distribuição por status */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <TrendingUp size={15} /> Distribuição por status
          </h3>
          {sortedStatus.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma tarefa aberta.</p>
          ) : (
            <div className="space-y-2.5">
              {sortedStatus.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-40 truncate text-right flex-shrink-0">
                    {name}
                  </span>
                  <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full flex items-center justify-end px-2"
                      style={{ width: `${Math.max((count / maxStatus) * 100, 8)}%` }}
                    >
                      <span className="text-[10px] font-bold text-white">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Distribuição por prioridade */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Flag size={15} /> Por prioridade
          </h3>
          {sortedPriority.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma tarefa aberta.</p>
          ) : (
            <div className="space-y-2.5">
              {sortedPriority.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-20 text-right flex-shrink-0">
                    {name}
                  </span>
                  <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full flex items-center justify-end px-2 ${PRIORITY_BAR[name] ?? 'bg-slate-400'}`}
                      style={{ width: `${Math.max((count / totalPriority) * 100, 8)}%` }}
                    >
                      <span className="text-[10px] font-bold text-white">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Envelhecimento */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Hourglass size={15} /> Envelhecimento das abertas
          </h3>
          {stats.openIssues.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma tarefa aberta.</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3 h-32">
                {stats.ageBuckets.map((b) => {
                  const maxAge = Math.max(1, ...stats.ageBuckets.map((x) => x.count));
                  const old = b.min >= 15;
                  return (
                    <div
                      key={b.label}
                      className="flex-1 flex flex-col items-center gap-2 h-full justify-end"
                    >
                      <span className="text-xs font-bold text-slate-600">{b.count}</span>
                      <div
                        className={`w-full rounded-t transition-all ${old ? 'bg-gradient-to-t from-red-400 to-orange-400' : 'bg-gradient-to-t from-blue-400 to-blue-500'}`}
                        style={{
                          height: `${(b.count / maxAge) * 100}%`,
                          minHeight: b.count > 0 ? 8 : 0,
                        }}
                        title={`${b.count} tarefa(s) ${b.label}`}
                      />
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">
                        {b.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Vermelho/laranja = paradas há mais tempo.
              </p>
            </>
          )}
        </div>

        {/* Precisa de atenção */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" /> Precisa de atenção
          </h3>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <CheckCircle2 size={28} className="mb-2 opacity-30" />
              <p className="text-sm">Tudo sob controle!</p>
            </div>
          ) : (
            <div className="space-y-1">
              {attention.map((issue) => {
                const rev = getReviewAlert(issue);
                const miss = getMissingFields(issue);
                const tag =
                  rev === 'overdue'
                    ? 'revisão atrasada'
                    : rev === 'today'
                      ? 'revisar hoje'
                      : issue.due_date && issue.due_date < new Date().toISOString().split('T')[0]
                        ? 'prazo vencido'
                        : miss.length
                          ? `${miss.length} campo(s) faltando`
                          : '';
                return (
                  <button
                    key={issue.id}
                    onClick={() => onIssueClick(issue.id)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors group"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${rev === 'overdue' ? 'bg-orange-500' : rev === 'today' ? 'bg-green-500' : 'bg-red-500'}`}
                    />
                    <span className="text-xs text-slate-700 group-hover:text-blue-600 truncate flex-1">
                      #{issue.id} — {issue.subject}
                    </span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{tag}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Horas apontadas — complementar, fica no final */}
      <TimeSummaryWidget />

      {selectedKpi && (
        <KpiModal
          label={selectedKpi.label}
          issues={selectedKpi.issues}
          onClose={() => setSelectedKpi(null)}
          onIssueClick={onIssueClick}
        />
      )}

      {showStandup && (
        <StandupModal
          open={stats.openIssues}
          completed={completed ?? []}
          onClose={() => setShowStandup(false)}
          onIssueClick={onIssueClick}
        />
      )}
    </div>
  );
}
