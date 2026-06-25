import { ListTodo, Search } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Project } from '../../types/redmine';
import type { Issue } from '../../types/redmine';
import type { Sprint } from '../../api/sprints';
import { Checkbox } from './IssueRow';
import { SortableIssueRow } from './SortableIssueRow';
import { AddToSprintMenu } from './AddToSprintMenu';
import { C_BACKLOG, issueDragId } from './dnd';

/* Painel esquerdo: tarefas fora de sprint, com filtro/busca, multi-seleção,
   ação em massa e arraste (origem para as sprints / destino ao remover). */
export function BacklogPanel({
  backlog, projects, sprints, search, onSearch, projectFilter, onProjectFilter,
  selected, onToggleSelect, onClearSelection, onAddSingle, onAddSelected, onOpen,
}: {
  backlog: Issue[];
  projects: Project[];
  sprints: Sprint[];
  search: string;
  onSearch: (v: string) => void;
  projectFilter: number | 'all';
  onProjectFilter: (v: number | 'all') => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onAddSingle: (sprintId: string, issueId: number) => void;
  onAddSelected: (sprintId: string) => void;
  onOpen?: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: C_BACKLOG });

  return (
    <aside className="w-[340px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col">
      <div className="p-3 space-y-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          <ListTodo size={13} /> Backlog <span className="text-slate-300 dark:text-slate-600">({backlog.length})</span>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar tarefa…"
            className="w-full text-xs pl-7 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200" />
        </div>
        <select value={projectFilter} onChange={e => onProjectFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          <option value="all">Todos os projetos</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/40">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">{selected.size} selecionada{selected.size > 1 ? 's' : ''}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {sprints.length > 0
              ? <AddToSprintMenu sprints={sprints} label="Adicionar a…" onPick={onAddSelected} />
              : <span className="text-[10px] text-slate-400">Crie uma sprint primeiro</span>}
            <button onClick={onClearSelection} className="text-xs px-2 py-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Limpar</button>
          </div>
        </div>
      )}

      <div ref={setNodeRef} className={`flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin transition-colors ${isOver ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''}`}>
        {backlog.length === 0 && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">Nenhuma tarefa fora de sprint.</p>}
        <SortableContext items={backlog.map(i => issueDragId(i.id))} strategy={verticalListSortingStrategy}>
          {backlog.map(issue => (
            <SortableIssueRow key={issue.id} issue={issue} onOpen={onOpen}
              left={<Checkbox checked={selected.has(issue.id)} onToggle={() => onToggleSelect(issue.id)} />}
              right={<AddToSprintMenu sprints={sprints} onPick={sprintId => onAddSingle(sprintId, issue.id)} />} />
          ))}
        </SortableContext>
      </div>
    </aside>
  );
}
