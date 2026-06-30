import { useState } from 'react';
import { Trash2, X, CalendarClock, Flag, Pencil, GripVertical } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDeleteSprint, useRemoveIssueFromSprint } from '../../hooks/useSprints';
import type { Board } from '../../api/boards';
import type { Sprint } from '../../api/sprints';
import type { Issue } from '../../types/redmine';
import { STATUS_META } from './constants';
import { daysLeftFrom, fmtRange, isClosedStatus } from './format';
import { SortableIssueRow } from './SortableIssueRow';
import { SprintEditor } from './SprintEditor';
import { ConfirmButton } from './ConfirmButton';
import { cSprintBody, issueDragId } from './dnd';

export function SprintCard({
  sprint,
  issues,
  boards,
  onOpen,
  autoEdit = false,
  accentColor,
  closedIds,
  dragHandleProps,
}: {
  sprint: Sprint;
  issues: Issue[];
  boards: Board[];
  onOpen?: (id: number) => void;
  autoEdit?: boolean;
  accentColor?: string;
  closedIds?: Set<number>;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const del = useDeleteSprint();
  const removeIssue = useRemoveIssueFromSprint();
  const { setNodeRef, isOver } = useDroppable({ id: cSprintBody(sprint.id) });

  const total = issues.length;
  const closed = issues.filter((i) => isClosedStatus(i, closedIds)).length;
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  const dleft = daysLeftFrom(sprint.endDate);
  const range = fmtRange(sprint.startDate, sprint.endDate);
  const isActive = sprint.status === 'active';
  const isClosed = sprint.status === 'closed';

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-white dark:bg-slate-800 shadow-sm p-3 transition-shadow hover:shadow-md ${
        isActive
          ? 'border-blue-300 dark:border-blue-700 ring-1 ring-blue-200 dark:ring-blue-900/50'
          : 'border-slate-200 dark:border-slate-700'
      } ${isClosed ? 'opacity-75' : ''}`}
    >
      {accentColor && (
        <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accentColor }} />
      )}
      <div className="flex items-start gap-1.5">
        {dragHandleProps && (
          <button
            {...dragHandleProps}
            aria-label="Arrastar sprint"
            title="Arrastar sprint"
            className="flex-shrink-0 mt-0.5 cursor-grab active:cursor-grabbing touch-none text-slate-300 dark:text-slate-600 hover:text-slate-500"
          >
            <GripVertical size={14} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {sprint.name || 'Sprint sem nome'}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_META[sprint.status].cls}`}
            >
              {STATUS_META[sprint.status].label}
            </span>
          </div>
          {range && (
            <p className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              <CalendarClock size={11} /> {range}
            </p>
          )}
          {sprint.goal && !editing && (
            <p className="flex items-start gap-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              <Flag size={11} className="mt-0.5 flex-shrink-0" />{' '}
              <span className="line-clamp-2">{sprint.goal}</span>
            </p>
          )}
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          aria-label="Editar sprint"
          title="Editar sprint"
          className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <Pencil size={13} />
        </button>
        <ConfirmButton
          onConfirm={() => del.mutate(sprint.id)}
          icon={<Trash2 size={13} />}
          title="Excluir sprint"
          confirmLabel="Excluir sprint"
        />
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
        {dleft !== null && !isClosed && (
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

      {editing && (
        <SprintEditor sprint={sprint} boards={boards} onClose={() => setEditing(false)} />
      )}

      <div
        ref={setNodeRef}
        className={`mt-2.5 space-y-1.5 min-h-[2rem] rounded-lg transition-colors ${isOver ? 'bg-blue-50 dark:bg-blue-900/15 outline-dashed outline-1 outline-blue-300' : ''}`}
      >
        {issues.length === 0 && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic py-2 text-center">
            Arraste tarefas aqui
          </p>
        )}
        <SortableContext
          items={issues.map((i) => issueDragId(i.id))}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <SortableIssueRow
              key={issue.id}
              issue={issue}
              onOpen={onOpen}
              closedIds={closedIds}
              right={
                <button
                  onClick={() => removeIssue.mutate({ sprintId: sprint.id, issueId: issue.id })}
                  aria-label="Remover da sprint"
                  title="Remover da sprint"
                  className="flex-shrink-0 p-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-40 group-hover:opacity-100 transition-opacity"
                >
                  <X size={13} />
                </button>
              }
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

/* Preview leve usado no DragOverlay ao arrastar a sprint. */
export function SprintCardOverlay({ sprint }: { sprint: Sprint }) {
  return (
    <div className="w-[300px] rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 shadow-lg p-3 opacity-90">
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        {sprint.name || 'Sprint sem nome'}
      </span>
    </div>
  );
}
