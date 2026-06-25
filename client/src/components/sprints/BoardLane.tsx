import { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUpdateBoard, useDeleteBoard } from '../../hooks/useBoards';
import type { Board } from '../../api/boards';
import type { Sprint } from '../../api/sprints';
import type { Issue } from '../../types/redmine';
import { NONE } from './constants';
import { SprintCard } from './SprintCard';
import { ConfirmButton } from './ConfirmButton';
import { isClosedStatus } from './format';
import { cLane, sprintDragId } from './dnd';

const PALETTE = ['#64748b', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#14b8a6'];

/* Card de sprint ordenável (arraste pela alça no header). */
function SortableSprintCard(props: {
  sprint: Sprint; issues: Issue[]; boards: Board[]; onOpen?: (id: number) => void;
  autoEdit: boolean; accentColor?: string; closedIds?: Set<number>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sprintDragId(props.sprint.id) });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="w-[300px] flex-shrink-0">
      <SprintCard {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

/* Raia de um "projeto" pessoal (ou "Sem projeto" quando board é null). */
export function BoardLane({
  board, sprints, issuesBySprintId, boards, collapsed, onToggleCollapse, onNewSprint, onOpen, editingId, autoEditBoard, closedIds,
}: {
  board: Board | null;
  sprints: Sprint[];
  issuesBySprintId: Map<string, Issue[]>;
  boards: Board[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewSprint: () => void;
  onOpen?: (id: number) => void;
  editingId: string | null;
  autoEditBoard: boolean;
  closedIds?: Set<number>;
}) {
  const updateBoard = useUpdateBoard();
  const delBoard = useDeleteBoard();
  const [colorOpen, setColorOpen] = useState(false);
  const laneKey = board?.id ?? NONE;
  const { setNodeRef: setLaneRef } = useDroppable({ id: cLane(laneKey) });

  const accent = board?.color ?? undefined;
  const laneBorder = board ? (board.color ?? '#cbd5e1') : 'transparent';

  const agg = useMemo(() => {
    let total = 0, closed = 0;
    for (const s of sprints) {
      const iss = issuesBySprintId.get(s.id) ?? [];
      total += iss.length;
      closed += iss.filter(i => isClosedStatus(i, closedIds)).length;
    }
    return { total, closed };
  }, [sprints, issuesBySprintId, closedIds]);
  const aggPct = agg.total > 0 ? Math.round((agg.closed / agg.total) * 100) : 0;

  return (
    <section className="mb-4 border-l-2 pl-2 rounded-l" style={{ borderLeftColor: laneBorder }}>
      <header className="flex items-center gap-2 px-1 py-1.5 group">
        <button onClick={onToggleCollapse} aria-label={collapsed ? 'Expandir' : 'Recolher'} className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>

        <div className="relative flex-shrink-0">
          <button onClick={() => board && setColorOpen(o => !o)} disabled={!board} title={board ? 'Cor do projeto' : undefined}
            className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:hover:bg-transparent">
            <Folder size={14} className="text-slate-400" style={accent ? { color: accent } : undefined} />
          </button>
          {colorOpen && board && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setColorOpen(false)} />
              <div className="absolute left-0 mt-1 z-20 grid grid-cols-4 gap-1.5 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
                {PALETTE.map(c => (
                  <button key={c} onClick={() => { updateBoard.mutate({ id: board.id, patch: { color: c } }); setColorOpen(false); }}
                    aria-label={`Cor ${c}`}
                    className={`w-5 h-5 rounded-full ${board.color === c ? 'ring-2 ring-offset-1 ring-slate-400 dark:ring-offset-slate-800' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </>
          )}
        </div>

        {board ? (
          <input
            defaultValue={board.name}
            autoFocus={autoEditBoard}
            onBlur={e => updateBoard.mutate({ id: board.id, patch: { name: e.target.value } })}
            placeholder="Nome do projeto"
            className="text-sm font-semibold bg-transparent text-slate-800 dark:text-slate-100 border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none px-0.5 max-w-[240px]"
          />
        ) : (
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Sem projeto</span>
        )}

        <span className="text-xs text-slate-400 dark:text-slate-500">
          {sprints.length} sprint{sprints.length !== 1 ? 's' : ''}{agg.total > 0 && ` · ${agg.closed}/${agg.total} tarefas`}
        </span>
        {agg.total > 0 && (
          <div className="hidden sm:block w-16 h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden" title={`${aggPct}% concluído`}>
            <div className="h-full rounded-full" style={{ width: `${aggPct}%`, backgroundColor: accent ?? '#3b82f6' }} />
          </div>
        )}

        <div className="ml-auto flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          <button onClick={onNewSprint} title="Nova sprint neste projeto"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30">
            <Plus size={13} /> Sprint
          </button>
          {board && (
            <ConfirmButton onConfirm={() => delBoard.mutate(board.id)} icon={<Trash2 size={13} />} title="Excluir projeto" confirmLabel="Excluir projeto" />
          )}
        </div>
      </header>

      {!collapsed && (
        <div ref={setLaneRef} className="flex gap-3 overflow-x-auto pb-1 pl-4 scrollbar-thin">
          {sprints.length === 0 ? (
            <button onClick={onNewSprint} className="text-xs text-slate-400 dark:text-slate-500 italic px-3 py-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:text-blue-500 w-full">
              Nenhuma sprint. Clique para criar a primeira.
            </button>
          ) : (
            <SortableContext items={sprints.map(s => sprintDragId(s.id))} strategy={horizontalListSortingStrategy}>
              {sprints.map(s => (
                <SortableSprintCard
                  key={s.id}
                  sprint={s}
                  issues={issuesBySprintId.get(s.id) ?? []}
                  boards={boards}
                  onOpen={onOpen}
                  autoEdit={s.id === editingId}
                  accentColor={accent}
                  closedIds={closedIds}
                />
              ))}
            </SortableContext>
          )}
        </div>
      )}
    </section>
  );
}
