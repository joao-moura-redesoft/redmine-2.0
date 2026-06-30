import { Check, CheckCircle2 } from 'lucide-react';
import type { Issue } from '../../types/redmine';
import { PRIORITY_DOTS } from './constants';
import { isClosedStatus } from './format';

/* Caixa de seleção (usada no backlog para multi-seleção). */
export function Checkbox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'Desmarcar tarefa' : 'Selecionar tarefa'}
      className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
        checked
          ? 'bg-blue-600 border-blue-600 text-white'
          : 'border-slate-300 dark:border-slate-600 hover:border-blue-400'
      }`}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

/* Linha compacta de issue: usada no backlog e dentro das sprints. Tarefas
   concluídas aparecem riscadas, esmaecidas e com check verde. */
export function IssueRow({
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
  const done = isClosedStatus(issue, closedIds);
  return (
    <div
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
        done
          ? 'border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
      }`}
    >
      {left}
      {done ? (
        <CheckCircle2 size={13} className="flex-shrink-0 text-green-500" />
      ) : (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOTS[issue.priority?.name] ?? 'bg-slate-400'}`}
          title={issue.priority?.name}
        />
      )}
      <button
        onClick={() => onOpen?.(issue.id)}
        className="min-w-0 flex-1 text-left"
        title={issue.subject}
      >
        <div
          className={`text-xs font-medium truncate ${done ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200'}`}
        >
          <span className="text-slate-400 dark:text-slate-500">#{issue.id}</span> {issue.subject}
        </div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
          {issue.project?.name}
        </div>
      </button>
      {right}
    </div>
  );
}
