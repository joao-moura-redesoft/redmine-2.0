import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { Issue } from '../../types/redmine';
import { IssueRow } from './IssueRow';
import { issueDragId } from './dnd';

/* Envolve a IssueRow num item ordenável do dnd-kit. O arraste sai apenas da
   alça (grip) — assim cliques em abrir/adicionar/remover continuam funcionando. */
export function SortableIssueRow({
  issue,
  onOpen,
  left,
  right,
  closedIds,
}: {
  issue: Issue;
  onOpen?: (id: number) => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  closedIds?: Set<number>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issueDragId(issue.id),
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      aria-label="Arrastar tarefa"
      title="Arrastar"
      className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none p-0.5 -ml-0.5 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400"
    >
      <GripVertical size={13} />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      <IssueRow
        issue={issue}
        onOpen={onOpen}
        closedIds={closedIds}
        left={
          <>
            {handle}
            {left}
          </>
        }
        right={right}
      />
    </div>
  );
}
