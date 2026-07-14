import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FolderKanban,
  Loader2,
  RefreshCw,
  ListTodo,
  CheckCircle2,
  CircleDot,
  Layers,
  Flag,
  Users,
  Milestone,
  AlertTriangle,
} from 'lucide-react';
import { useProjects } from '../hooks/useRedmine';
import {
  getProjectAnalytics,
  type ProjectAnalytics,
  type NameCount,
  type ProjectVersion,
} from '../api/analytics';
import { IssueListModal, type ModalIssue } from './IssueListModal';

interface Props {
  projectId?: number;
  onIssueClick: (id: number) => void;
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

function Tile({
  icon,
  label,
  value,
  suffix,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  suffix?: string;
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
      </div>
    </button>
  );
}

// Barras horizontais simples (status, prioridade, responsável).
function BarList({
  items,
  colorFor,
  emptyLabel,
  labelWidth = 'w-32',
  onItemClick,
}: {
  items: NameCount[];
  colorFor?: (name: string) => string;
  emptyLabel: string;
  labelWidth?: string;
  onItemClick?: (name: string) => void;
}) {
  if (items.length === 0) return <p className="text-sm text-slate-400">{emptyLabel}</p>;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="space-y-2.5">
      {items.map((it) => {
        const Row = onItemClick ? 'button' : 'div';
        return (
          <Row
            key={it.name}
            {...(onItemClick
              ? {
                  type: 'button' as const,
                  onClick: () => onItemClick(it.name),
                  className:
                    'flex items-center gap-3 w-full text-left group rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 -mx-1 px-1 py-0.5 transition-colors',
                }
              : { className: 'flex items-center gap-3' })}
          >
            <span
              className={`${labelWidth} flex-shrink-0 text-xs text-slate-600 dark:text-slate-300 truncate text-right ${
                onItemClick ? 'group-hover:text-blue-600 dark:group-hover:text-blue-400' : ''
              }`}
              title={it.name}
            >
              {it.name}
            </span>
            <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full flex items-center justify-end px-2 ${
                  colorFor?.(it.name) ?? 'bg-gradient-to-r from-blue-400 to-blue-600'
                }`}
                style={{ width: `${Math.max((it.count / max) * 100, 8)}%` }}
              >
                <span className="text-[10px] font-bold text-white">{it.count}</span>
              </div>
            </div>
          </Row>
        );
      })}
    </div>
  );
}

// Barras empilhadas aberto/fechado por tipo. Clicar abre as abertas do tipo.
function TrackerBars({
  data,
  onItemClick,
}: {
  data: ProjectAnalytics;
  onItemClick: (name: string) => void;
}) {
  if (data.byTracker.length === 0) return <p className="text-sm text-slate-400">Sem tipos.</p>;
  const max = Math.max(1, ...data.byTracker.map((t) => t.total));
  return (
    <div className="space-y-2.5">
      {data.byTracker.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => onItemClick(t.name)}
          className="flex items-center gap-3 w-full text-left group rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 -mx-1 px-1 py-0.5 transition-colors"
        >
          <span
            className="w-32 flex-shrink-0 text-xs text-slate-600 dark:text-slate-300 truncate text-right group-hover:text-blue-600 dark:group-hover:text-blue-400"
            title={t.name}
          >
            {t.name}
          </span>
          <div className="flex-1 h-5 flex rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
            {t.open > 0 && (
              <div
                className="bg-blue-500 h-full flex items-center justify-center"
                style={{ width: `${(t.open / max) * 100}%` }}
                title={`${t.open} aberta(s)`}
              >
                {t.open / max > 0.08 && (
                  <span className="text-[10px] font-bold text-white">{t.open}</span>
                )}
              </div>
            )}
            {t.closed > 0 && (
              <div
                className="bg-emerald-500 h-full flex items-center justify-center"
                style={{ width: `${(t.closed / max) * 100}%` }}
                title={`${t.closed} fechada(s)`}
              >
                {t.closed / max > 0.08 && (
                  <span className="text-[10px] font-bold text-white">{t.closed}</span>
                )}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function VersionRow({ v }: { v: ProjectVersion }) {
  const barColor = v.overdue
    ? 'bg-red-500'
    : v.pct === 100
      ? 'bg-emerald-500'
      : 'bg-gradient-to-r from-blue-400 to-blue-600';
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
          {v.name}
        </span>
        {v.status !== 'open' && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 flex-shrink-0">
            {v.status === 'closed' ? 'fechada' : 'travada'}
          </span>
        )}
        {v.overdue && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 flex items-center gap-1 flex-shrink-0">
            <AlertTriangle size={10} /> vencida
          </span>
        )}
        {v.due_date && (
          <span className="text-[11px] text-slate-400 flex-shrink-0 ml-auto">
            prazo {v.due_date.split('-').reverse().slice(0, 2).join('/')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${v.pct}%` }} />
        </div>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums w-9 text-right flex-shrink-0">
          {v.pct}%
        </span>
        <span className="text-[11px] text-slate-400 tabular-nums w-16 text-right flex-shrink-0">
          {v.closed}/{v.total}
        </span>
      </div>
    </div>
  );
}

function ProjectContent({
  data,
  onIssueClick,
}: {
  data: ProjectAnalytics;
  onIssueClick: (id: number) => void;
}) {
  const priority = [...data.byPriority].sort((a, b) => {
    const ia = PRIORITY_ORDER.indexOf(a.name),
      ib = PRIORITY_ORDER.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const { total, open, closed, completion } = data.totals;

  const [modal, setModal] = useState<{ title: string; items: ModalIssue[] } | null>(null);

  // Drill-down: filtra as abertas (openList) por uma dimensão e abre o modal.
  const drill = (
    title: string,
    field: 'status' | 'priority' | 'assignee' | 'tracker' | null,
    value?: string,
  ) => {
    const items: ModalIssue[] = data.openList
      .filter((i) => field == null || i[field] === value)
      .map((i) => ({ id: i.id, subject: i.subject, meta: i.status }));
    setModal({ title, items });
  };

  return (
    <div className="space-y-6">
      {data.capped && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Projeto com mais de 2000 tarefas — os números mostram as primeiras 2000.
        </div>
      )}

      {/* Conclusão + totais */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Conclusão
          </span>
          <span className="text-xs text-slate-400">
            · {closed} de {total} fechadas
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-4xl font-bold text-slate-800 dark:text-slate-100 tabular-nums flex-shrink-0">
            {completion}%
          </span>
          <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full"
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <Tile
          icon={<ListTodo size={22} />}
          tone="text-slate-400"
          label="tarefas no total"
          value={total}
        />
        <Tile
          icon={<CircleDot size={22} />}
          tone="text-blue-500"
          label="abertas"
          value={open}
          onClick={() => drill('Abertas', null)}
        />
        <Tile
          icon={<CheckCircle2 size={22} />}
          tone="text-emerald-500"
          label="fechadas"
          value={closed}
        />
      </div>

      {/* Por tipo */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Layers size={15} className="text-slate-400" /> Por tipo
          </h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Abertas
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Fechadas
            </span>
          </div>
        </div>
        <TrackerBars
          data={data}
          onItemClick={(name) => drill(`Tipo: ${name} · abertas`, 'tracker', name)}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
            <CircleDot size={15} className="text-slate-400" /> Abertas por status
          </h3>
          <BarList
            items={data.byStatus}
            emptyLabel="Nenhuma tarefa aberta."
            labelWidth="w-40"
            onItemClick={(name) => drill(`Status: ${name}`, 'status', name)}
          />
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
            <Flag size={15} className="text-slate-400" /> Por prioridade
          </h3>
          <BarList
            items={priority}
            colorFor={(n) => PRIORITY_BAR[n] ?? 'bg-slate-400'}
            emptyLabel="Nenhuma tarefa aberta."
            labelWidth="w-20"
            onItemClick={(name) => drill(`Prioridade: ${name}`, 'priority', name)}
          />
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Users size={15} className="text-slate-400" /> Carga por responsável (abertas)
        </h3>
        <BarList
          items={data.byAssignee}
          emptyLabel="Nenhuma tarefa aberta."
          labelWidth="w-40"
          onItemClick={(name) => drill(name, 'assignee', name)}
        />
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 flex items-center gap-2">
          <Milestone size={15} className="text-slate-400" /> Versões
        </h3>
        {data.versions.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Este projeto não tem versões.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.versions.map((v) => (
              <VersionRow key={v.id} v={v} />
            ))}
          </div>
        )}
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

export function ProjectView({ projectId, onIssueClick }: Props) {
  const { data: projects } = useProjects();
  const [selected, setSelected] = useState<number | undefined>(projectId);

  // Seed inicial: prop → primeiro projeto disponível.
  useEffect(() => {
    if (selected == null && projectId != null) setSelected(projectId);
  }, [projectId, selected]);
  useEffect(() => {
    if (selected == null && projects && projects.length > 0) setSelected(projects[0].id);
  }, [projects, selected]);

  const q = useQuery({
    queryKey: ['analytics', 'project', selected],
    queryFn: () => getProjectAnalytics(selected!),
    enabled: selected != null,
    staleTime: 60_000,
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FolderKanban size={18} className="text-blue-500" /> Projeto
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Visão completa de um projeto: tipos, status, carga do time e versões.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 max-w-56"
          >
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching || selected == null}
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

      {selected == null ? (
        <div className="text-center py-16 text-slate-500">Selecione um projeto acima.</div>
      ) : q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : q.isError || !q.data ? (
        <div className="text-center py-16 text-slate-500">
          Não consegui carregar o projeto. Tente atualizar.
        </div>
      ) : (
        <ProjectContent data={q.data} onIssueClick={onIssueClick} />
      )}
    </div>
  );
}
