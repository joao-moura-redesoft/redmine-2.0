import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { RefreshCw, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import type { Issue } from '../types/redmine';
import { QuickEditButton } from './inline/QuickEditButton';

/* ── Status badge color ── */
function statusColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('andamento')) return 'bg-blue-100 text-blue-700';
  if (n.includes('revisão') || n.includes('revisao')) return 'bg-purple-100 text-purple-700';
  if (n.includes('teste')) return 'bg-yellow-100 text-yellow-800';
  if (n.includes('integração') || n.includes('integracao')) return 'bg-indigo-100 text-indigo-700';
  if (n.includes('fechamento')) return 'bg-green-100 text-green-700';
  if (n.includes('impedido')) return 'bg-red-100 text-red-700';
  if (n.includes('cancelad') || n.includes('fechad')) return 'bg-slate-100 text-slate-500';
  if (n.includes('correção') || n.includes('correcao')) return 'bg-orange-100 text-orange-700';
  if (n.includes('pendente')) return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

const PRIORITY_DOT: Record<string, string> = {
  Imediata: 'bg-red-700',
  Urgente: 'bg-red-500',
  Alta: 'bg-orange-500',
  Normal: 'bg-blue-500',
  Baixa: 'bg-slate-400',
};

/* ── Single issue row ── */
function IssueRow({
  issue,
  onClick,
  showAssignee,
  focused,
}: {
  issue: Issue;
  onClick: (id: number) => void;
  showAssignee?: boolean;
  focused?: boolean;
}) {
  return (
    <div className="relative group border-b border-slate-100 last:border-0">
    <button
      data-issue-id={issue.id}
      onClick={() => onClick(issue.id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left ${focused ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : ''}`}
    >
      {/* Priority dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[issue.priority.name] ?? 'bg-slate-400'}`}
      />

      {/* Tracker */}
      <span className="text-xs font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
        {issue.tracker.name}
      </span>

      {/* ID + Subject */}
      <span className="text-xs text-slate-400 flex-shrink-0">#{issue.id}</span>
      <span className="text-sm text-slate-800 group-hover:text-blue-700 font-medium truncate flex-1 transition-colors">
        {issue.subject}
      </span>

      {/* Status */}
      <span
        className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor(issue.status.name)}`}
      >
        {issue.status.name}
      </span>

      {/* Responsável atual (quem tem a tarefa agora) */}
      {showAssignee && (
        <span className="text-xs text-slate-400 flex-shrink-0 w-28 truncate text-right">
          {issue.assigned_to?.name ?? '—'}
        </span>
      )}

      {/* Projeto (some no hover pra dar espaço ao ✎) */}
      <span className="text-xs text-slate-400 flex-shrink-0 w-32 truncate text-right hidden md:block transition-opacity group-hover:opacity-0">
        {issue.project.name}
      </span>

      {/* Atualizado (some no hover pra dar espaço ao ✎) */}
      <span className="text-xs text-slate-300 flex-shrink-0 w-24 text-right hidden lg:block transition-opacity group-hover:opacity-0">
        {formatDistanceToNow(new Date(issue.updated_on), { addSuffix: true, locale: ptBR })}
      </span>
    </button>

      {/* Edição rápida (aparece no hover) */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <QuickEditButton issue={issue} />
      </div>
    </div>
  );
}

/* ── Collapsible status group ── */
function StatusGroup({
  name,
  issues,
  onIssueClick,
  showAssignee,
  focusedIssueId,
}: {
  name: string;
  issues: Issue[];
  onIssueClick: (id: number) => void;
  showAssignee?: boolean;
  focusedIssueId?: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-3 border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        {open ? (
          <ChevronDown size={14} className="text-slate-400" />
        ) : (
          <ChevronRight size={14} className="text-slate-400" />
        )}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(name)}`}>
          {name}
        </span>
        <span className="text-xs text-slate-400 font-medium">
          {issues.length} tarefa{issues.length !== 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <div className="bg-white">
          {/* Header row */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-slate-50/50 border-b border-slate-100">
            <span className="w-2 flex-shrink-0" />
            <span className="text-xs text-slate-400 w-16 flex-shrink-0">Tracker</span>
            <span className="text-xs text-slate-400 w-10 flex-shrink-0">#ID</span>
            <span className="text-xs text-slate-400 flex-1">Título</span>
            <span className="text-xs text-slate-400 w-36 flex-shrink-0">Status</span>
            {showAssignee && (
              <span className="text-xs text-slate-400 w-28 flex-shrink-0 text-right">
                Responsável
              </span>
            )}
            <span className="text-xs text-slate-400 w-32 flex-shrink-0 text-right hidden md:block">
              Projeto
            </span>
            <span className="text-xs text-slate-400 w-24 flex-shrink-0 text-right hidden lg:block">
              Atualizado
            </span>
          </div>
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onClick={onIssueClick}
              showAssignee={showAssignee}
              focused={focusedIssueId === issue.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main list view ── */
interface Props {
  issues: Issue[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  onRefetch: () => void;
  onIssueClick: (id: number) => void;
  showAssignee?: boolean;
  emptyMessage?: string;
  focusedIssueId?: number;
}

export function IssueListView({
  issues,
  isLoading,
  isFetching,
  onRefetch,
  onIssueClick,
  showAssignee = false,
  emptyMessage = 'Nenhuma tarefa encontrada.',
  focusedIssueId,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = (issues ?? []).filter((i) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return i.subject.toLowerCase().includes(q) || String(i.id).includes(q);
  });

  // Agrupar por status, ordenar grupos por quantidade desc
  const groups = filtered.reduce<Record<string, Issue[]>>((acc, issue) => {
    const key = issue.status.name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(issue);
    return acc;
  }, {});

  // Ordem preferida de exibição dos grupos
  const STATUS_ORDER = [
    'Em andamento',
    'Pendente Correção',
    'Pendente Revisão',
    'Pendente Teste',
    'Pendente Integração',
    'Pendente Atualização',
    'Pendente Fechamento',
    'Pendente Desenvolvimento',
    'Pendente Análise',
    'Impedido',
  ];
  const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
    const ia = STATUS_ORDER.indexOf(a);
    const ib = STATUS_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 gap-2">
        <RefreshCw size={18} className="animate-spin" />
        <span>Carregando...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título ou #ID..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="text-sm text-slate-400">
          {filtered.length} tarefa{filtered.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onRefetch}
          disabled={isFetching}
          className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors text-slate-500"
          title="Atualizar"
        >
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Groups */}
      {sortedGroups.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          {emptyMessage}
        </div>
      ) : (
        sortedGroups.map(([status, statusIssues]) => (
          <StatusGroup
            key={status}
            name={status}
            issues={statusIssues}
            onIssueClick={onIssueClick}
            showAssignee={showAssignee}
            focusedIssueId={focusedIssueId}
          />
        ))
      )}
    </div>
  );
}
