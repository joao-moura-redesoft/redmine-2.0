import { useState } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import type { Sprint } from '../../api/sprints';
import { STATUS_RANK } from './constants';

/* Dropdown para jogar tarefa(s) numa sprint. Compacto (só ícone) por linha do
   backlog, ou rotulado quando usado na barra de ação em massa. */
export function AddToSprintMenu({
  sprints,
  onPick,
  label,
}: {
  sprints: Sprint[];
  onPick: (sprintId: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!sprints.length) return null;
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Adicionar à sprint"
        title="Adicionar à sprint"
        className={
          label
            ? 'flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700'
            : 'flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-1 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
        }
      >
        <Plus size={13} /> {label && <span>{label}</span>} <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-52 max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
            {[...sprints]
              .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    onPick(s.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-700"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.status === 'active' ? 'bg-blue-500' : s.status === 'closed' ? 'bg-green-500' : 'bg-slate-300'}`}
                  />
                  <span className="truncate">{s.name || 'Sprint sem nome'}</span>
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
