import { Search, Inbox } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Issue, Project } from '../../types/redmine';
import { SortableIssueRow } from '../sprints/SortableIssueRow';
import { issueDragId } from '../sprints/dnd';
import { C_BACKLOG } from './dnd';

/* Painel esquerdo: tarefas minhas ainda SEM versão, para arrastar para dentro
   de uma versão. É também alvo droppable (soltar aqui remove a versão). */
export function RoadmapBacklog({
  issues,
  projects,
  search,
  onSearch,
  projectFilter,
  onProjectFilter,
  onOpen,
  closedIds,
}: {
  issues: Issue[];
  projects: Project[];
  search: string;
  onSearch: (v: string) => void;
  projectFilter: number | 'all';
  onProjectFilter: (v: number | 'all') => void;
  onOpen?: (id: number) => void;
  closedIds?: Set<number>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: C_BACKLOG });

  return (
    <div className="w-[340px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col min-h-0">
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 space-y-2">
        <div className="flex items-center gap-2">
          <Inbox size={15} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Sem versão
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{issues.length}</span>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar tarefa…"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-400"
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) =>
            onProjectFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-400"
        >
          <option value="all">Todos os projetos</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin transition-colors ${
          isOver ? 'bg-blue-50 dark:bg-blue-900/15' : ''
        }`}
      >
        {issues.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic py-6 text-center">
            Nenhuma tarefa sem versão.
          </p>
        ) : (
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
              />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
}
