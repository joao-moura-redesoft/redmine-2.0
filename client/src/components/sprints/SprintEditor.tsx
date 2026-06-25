import { Check } from 'lucide-react';
import { useUpdateSprint } from '../../hooks/useSprints';
import type { Board } from '../../api/boards';
import type { Sprint } from '../../api/sprints';
import { STATUS_META, STATUS_ORDER } from './constants';

/* Editor inline da sprint: nome, projeto pessoal, datas, meta e status.
   Salva campo a campo (onBlur / onChange) via mutação otimista. */
export function SprintEditor({ sprint, boards, onClose }: {
  sprint: Sprint;
  boards: Board[];
  onClose: () => void;
}) {
  const update = useUpdateSprint();
  const patch = (p: Partial<Sprint>) => update.mutate({ id: sprint.id, patch: p });
  return (
    <div className="mt-2 space-y-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
      <input
        defaultValue={sprint.name}
        autoFocus={!sprint.name}
        onBlur={e => patch({ name: e.target.value })}
        placeholder="Nome da sprint"
        className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
      />
      <label className="block text-[10px] text-slate-500 dark:text-slate-400">
        Projeto
        <select
          value={sprint.boardId ?? ''}
          onChange={e => patch({ boardId: e.target.value || null })}
          className="w-full text-xs px-1.5 py-1 mt-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
        >
          <option value="">Sem projeto</option>
          {boards.map(b => <option key={b.id} value={b.id}>{b.name || 'Projeto sem nome'}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <label className="flex-1 text-[10px] text-slate-500 dark:text-slate-400">
          Início
          <input type="date" defaultValue={sprint.startDate ?? ''} onBlur={e => patch({ startDate: e.target.value || null })}
            className="w-full text-xs px-1.5 py-1 mt-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200" />
        </label>
        <label className="flex-1 text-[10px] text-slate-500 dark:text-slate-400">
          Fim
          <input type="date" defaultValue={sprint.endDate ?? ''} onBlur={e => patch({ endDate: e.target.value || null })}
            className="w-full text-xs px-1.5 py-1 mt-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200" />
        </label>
      </div>
      <textarea
        defaultValue={sprint.goal}
        onBlur={e => patch({ goal: e.target.value })}
        placeholder="Meta da sprint (objetivo)"
        rows={2}
        className="w-full text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 resize-none"
      />
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {STATUS_ORDER.map(st => (
            <button key={st} onClick={() => patch({ status: st })}
              className={`text-[10px] px-2 py-1 rounded-md font-medium ${sprint.status === st ? STATUS_META[st].cls : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              {STATUS_META[st].label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700">
          <Check size={13} /> Pronto
        </button>
      </div>
    </div>
  );
}
