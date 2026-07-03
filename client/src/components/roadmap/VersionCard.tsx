import { CalendarClock, Package, X } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Issue, Version } from '../../types/redmine';
import { daysLeftFrom, isClosedStatus } from '../sprints/format';
import { SortableIssueRow } from '../sprints/SortableIssueRow';
import { issueDragId } from '../sprints/dnd';
import { cVersionBody } from './dnd';

const VERSION_STATUS: Record<Version['status'], { label: string; cls: string }> = {
  open: {
    label: 'Aberta',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  locked: {
    label: 'Bloqueada',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  closed: {
    label: 'Fechada',
    cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
};

/* Card de uma Versão do Redmine: espelha a Roadmap nativa (prazo, progresso,
   tarefas) e é um alvo droppable para atribuir tarefas (grava fixed_version). */
export function VersionCard({
  version,
  projectId,
  issues,
  onOpen,
  closedIds,
  hideClosedIssues,
  onRemoveIssue,
  accentColor,
}: {
  version: Version;
  projectId: number;
  issues: Issue[];
  onOpen?: (id: number) => void;
  closedIds?: Set<number>;
  hideClosedIssues?: boolean;
  onRemoveIssue?: (issue: Issue) => void;
  accentColor?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cVersionBody(projectId, version.id) });

  // Progresso reflete a versão inteira; a lista pode ocultar as concluídas.
  const total = issues.length;
  const closed = issues.filter((i) => isClosedStatus(i, closedIds)).length;
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  const visibleIssues = hideClosedIssues
    ? issues.filter((i) => !isClosedStatus(i, closedIds))
    : issues;
  const dleft = daysLeftFrom(version.due_date ?? null);
  const isClosedVersion = version.status === 'closed';

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-white dark:bg-slate-800 shadow-sm p-3 transition-shadow hover:shadow-md ${
        isClosedVersion
          ? 'border-slate-200 dark:border-slate-700 opacity-75'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      {accentColor && (
        <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accentColor }} />
      )}
      <div className="flex items-start gap-1.5">
        <Package size={14} className="flex-shrink-0 mt-0.5 text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {version.name}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${VERSION_STATUS[version.status].cls}`}
            >
              {VERSION_STATUS[version.status].label}
            </span>
          </div>
          {version.due_date && (
            <p className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              <CalendarClock size={11} /> Previsto para{' '}
              {new Date(version.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-blue-600'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">
          {closed}/{total}
        </span>
        {dleft !== null && !isClosedVersion && (
          <span
            className={`flex items-center gap-0.5 text-[10px] font-medium flex-shrink-0 ${
              dleft < 0
                ? 'text-red-600'
                : dleft <= 3
                  ? 'text-orange-600'
                  : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            <CalendarClock size={11} />
            {dleft < 0 ? `${-dleft}d atraso` : dleft === 0 ? 'hoje' : `${dleft}d`}
          </span>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`mt-2.5 space-y-1.5 min-h-[2rem] rounded-lg transition-colors ${isOver ? 'bg-blue-50 dark:bg-blue-900/15 outline-dashed outline-1 outline-blue-300' : ''}`}
      >
        {visibleIssues.length === 0 && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic py-2 text-center">
            {total > 0 && hideClosedIssues ? 'Todas as tarefas concluídas' : 'Arraste tarefas aqui'}
          </p>
        )}
        <SortableContext
          items={visibleIssues.map((i) => issueDragId(i.id))}
          strategy={verticalListSortingStrategy}
        >
          {visibleIssues.map((issue) => (
            <SortableIssueRow
              key={issue.id}
              issue={issue}
              onOpen={onOpen}
              closedIds={closedIds}
              right={
                onRemoveIssue && (
                  <button
                    onClick={() => onRemoveIssue(issue)}
                    aria-label="Remover da versão"
                    title="Remover da versão"
                    className="flex-shrink-0 p-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-40 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={13} />
                  </button>
                )
              }
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
