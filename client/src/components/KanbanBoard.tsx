import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import { Plus, RefreshCw, EyeOff, Search, AlertTriangle, Bell, BellRing, X, ArrowUpDown, Columns, ChevronDown, Archive, CheckSquare } from 'lucide-react';
import { useIssues, useStatuses, useUpdateIssueStatus } from '../hooks/useRedmine';
import { IssueCard } from './IssueCard';
import { CreateIssueModal } from './CreateIssueModal';
import type { Issue, IssueStatus } from '../types/redmine';
import { getMissingFields, getReviewAlert } from '../utils/alerts';

import { loadArchived, saveArchived } from '../utils/archive';

type SortBy = 'priority' | 'due_date' | 'updated';

const PRIORITY_ORDER: Record<string, number> = {
  Imediata: 0, Urgente: 1, Alta: 2, Normal: 3, Baixa: 4,
};

function sortIssues(issues: Issue[], by: SortBy): Issue[] {
  return [...issues].sort((a, b) => {
    if (by === 'priority') {
      return (PRIORITY_ORDER[a.priority.name] ?? 5) - (PRIORITY_ORDER[b.priority.name] ?? 5);
    }
    if (by === 'due_date') {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    }
    // updated — mais recente primeiro
    return new Date(b.updated_on).getTime() - new Date(a.updated_on).getTime();
  });
}

/* ── Stats bar ── */
function StatsBar({ issues, activeFilter, onFilter }: {
  issues: Issue[];
  activeFilter: string | null;
  onFilter: (f: string | null) => void;
}) {
  const today = new Date().toISOString().split('T')[0];

  const overdue = issues.filter(i =>
    i.due_date && i.due_date < today &&
    !i.status.name.toLowerCase().includes('fechad') &&
    !i.status.name.toLowerCase().includes('cancelad')
  );
  const reviewToday = issues.filter(i => getReviewAlert(i) === 'today');
  const reviewOverdue = issues.filter(i => getReviewAlert(i) === 'overdue');
  const withMissing = issues.filter(i => getMissingFields(i).length > 0);

  const chip = (
    id: string,
    icon: React.ReactNode,
    label: string,
    count: number,
    color: string,
  ) => {
    if (count === 0) return null;
    const active = activeFilter === id;
    return (
      <button
        onClick={() => onFilter(active ? null : id)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
          active
            ? `${color} border-current shadow-sm`
            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:shadow-sm'
        }`}
      >
        {icon}
        {label}
        <span className={`font-bold ${active ? '' : 'text-slate-800'}`}>{count}</span>
      </button>
    );
  };

  const hasAny = overdue.length || reviewToday.length || reviewOverdue.length || withMissing.length;
  if (!hasAny) return null;

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <span className="text-xs text-slate-400 font-medium">Alertas:</span>
      {chip('overdue',       <AlertTriangle size={11} />, 'Prazo vencido',      overdue.length,       'bg-red-50 text-red-600 border-red-300')}
      {chip('reviewToday',   <BellRing size={11} />,      'Enviar revisão hoje', reviewToday.length,  'bg-green-50 text-green-700 border-green-300')}
      {chip('reviewOverdue', <Bell size={11} />,           'Revisão atrasada',   reviewOverdue.length, 'bg-orange-50 text-orange-600 border-orange-300')}
      {chip('missing',       <AlertTriangle size={11} />, 'Campos faltando',    withMissing.length,   'bg-amber-50 text-amber-700 border-amber-300')}
      {activeFilter && (
        <button onClick={() => onFilter(null)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <X size={11} /> Limpar filtro
        </button>
      )}
    </div>
  );
}

/* ── Column ── */
interface ColumnProps {
  status: IssueStatus;
  issues: Issue[];
  archivedIssues: Issue[];
  onIssueClick: (issue: Issue) => void;
  statuses: IssueStatus[];
  onQuickStatusChange: (issueId: number, statusId: number) => void;
  onArchive: (id: number) => void;
  onUnarchive: (id: number) => void;
  selectedIds: Set<number>;
  selectionMode: boolean;
  onToggleSelect: (id: number) => void;
  pinned?: boolean;
  onUnpin?: () => void;
}

const COL_COLORS: Record<string, string> = {
  'Em andamento': 'border-t-blue-500',
  'Fechado': 'border-t-slate-300',
  'Cancelado': 'border-t-red-300',
  'Pendente Revisão': 'border-t-purple-400',
  'Pendente Teste': 'border-t-yellow-400',
  'Pendente Correção': 'border-t-orange-400',
  'Pendente Desenvolvimento': 'border-t-cyan-400',
  'Pendente Integração': 'border-t-indigo-400',
  'Pendente Fechamento': 'border-t-green-400',
  'Impedido': 'border-t-red-500',
};

function KanbanColumn({ status, issues, archivedIssues, onIssueClick, statuses, onQuickStatusChange, onArchive, onUnarchive, selectedIds, selectionMode, onToggleSelect, pinned, onUnpin }: ColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `col-${status.id}` });
  const borderColor = COL_COLORS[status.name] ?? 'border-t-slate-400';
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(status.is_closed);

  return (
    <div ref={setNodeRef} className="flex flex-col w-72 flex-shrink-0">
      {/* Header */}
      <div className={`bg-white border-t-4 ${borderColor} px-4 py-3 border border-slate-200 transition-colors duration-150
        ${collapsed ? 'rounded-xl' : 'rounded-t-xl border-b-0'}
        ${isOver ? 'bg-blue-50 border-blue-300' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-700">{status.name}</h3>
            <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {issues.length + archivedIssues.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {pinned && issues.length === 0 && onUnpin && (
              <button onClick={onUnpin} title="Remover coluna" className="text-slate-300 hover:text-slate-500 transition-colors">
                <X size={13} />
              </button>
            )}
            <button
              onClick={() => setCollapsed(v => !v)}
              title={collapsed ? 'Expandir coluna' : 'Recolher coluna'}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <ChevronDown size={15} className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
            </button>
          </div>
        </div>
        {collapsed && issues.length > 0 && (
          <button
            onClick={() => setCollapsed(false)}
            className="mt-2 w-full text-xs text-slate-400 hover:text-blue-600 transition-colors text-left"
          >
            Ver {issues.length} tarefa{issues.length !== 1 ? 's' : ''} →
          </button>
        )}
      </div>

      {/* Body — oculto quando recolhido */}
      {!collapsed && (
      <div
        className={`flex-1 min-h-[200px] p-2 rounded-b-xl border border-t-0 border-slate-200 space-y-2 transition-colors duration-150 ${
          isOver ? 'bg-blue-50 border-blue-300' : 'bg-slate-50'
        }`}
      >
        {issues.map(issue => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onClick={onIssueClick}
            statuses={statuses}
            onQuickStatusChange={onQuickStatusChange}
            onArchive={onArchive}
            selected={selectedIds.has(issue.id)}
            selectionMode={selectionMode}
            onToggleSelect={onToggleSelect}
          />
        ))}
        {issues.length === 0 && (
          <div className={`flex items-center justify-center h-20 rounded-lg border-2 border-dashed transition-colors ${isOver ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200'}`}>
            <p className="text-xs text-slate-400">Solte aqui</p>
          </div>
        )}

        {/* Arquivadas */}
        {archivedIssues.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-200">
            <button
              onClick={() => setArchivedOpen(v => !v)}
              className="w-full flex items-center gap-1.5 px-1 py-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <Archive size={11} />
              <span>Arquivadas ({archivedIssues.length})</span>
              <ChevronDown size={11} className={`ml-auto transition-transform ${archivedOpen ? 'rotate-180' : ''}`} />
            </button>
            {archivedOpen && (
              <div className="space-y-1.5 mt-1.5">
                {archivedIssues.map(issue => (
                  <div key={issue.id} className="relative group/arch">
                    <div className="opacity-50 pointer-events-none">
                      <IssueCard issue={issue} onClick={() => {}} />
                    </div>
                    {/* Overlay com ações sobre a área archivada */}
                    <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/arch:opacity-100 transition-opacity bg-white/70 dark:bg-slate-900/80 rounded-lg">
                      <button
                        onClick={() => onIssueClick(issue)}
                        className="text-xs px-2 py-1 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 text-slate-700 font-medium"
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => onUnarchive(issue.id)}
                        className="text-xs px-2 py-1 bg-white border border-blue-300 rounded-md shadow-sm hover:bg-blue-50 text-blue-600 font-medium flex items-center gap-1"
                      >
                        <Archive size={11} /> Restaurar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/* ── Board ── */
interface Props {
  projectId?: number;
  userName?: string;
  onIssueClick: (id: number) => void;
}

export function KanbanBoard({ projectId, userName, onIssueClick }: Props) {
  const { data: allStatuses } = useStatuses();
  const { data: issues, isLoading, refetch, isFetching } = useIssues(projectId);
  const updateStatus = useUpdateIssueStatus();

  const [showCreate, setShowCreate] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<number>>(new Set());
  const [pinnedStatuses, setPinnedStatuses] = useState<Set<number>>(new Set());
  const [archivedIds, setArchivedIds] = useState<Set<number>>(loadArchived);
  const [localIssueStatuses, setLocalIssueStatuses] = useState<Map<number, number>>(new Map());
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const clearSelection = () => setSelectedIds(new Set());

  const bulkChangeStatus = (statusId: number) => {
    selectedIds.forEach(id => {
      const issue = issues?.find(i => i.id === id);
      if (!issue || issue.status.id === statusId) return;
      setLocalIssueStatuses(prev => new Map(prev).set(id, statusId));
      updateStatus.mutate({ id, statusId }, {
        onError: () => setLocalIssueStatuses(prev => { const m = new Map(prev); m.delete(id); return m; })
      });
    });
    setBulkStatusOpen(false);
    clearSelection();
  };

  const bulkArchive = () => {
    selectedIds.forEach(id => archiveIssue(id));
    clearSelection();
  };

  // Atalhos de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'n' && !isTyping && !showCreate) {
        setShowCreate(true);
      }
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showCreate]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const today = new Date().toISOString().split('T')[0];

  // Aplica busca textual + filtro rápido de alertas
  const filteredIssues = useMemo(() => {
    if (!issues) return [];
    let list = issues;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i =>
        i.subject.toLowerCase().includes(q) ||
        String(i.id).includes(q)
      );
    }

    if (activeFilter === 'overdue') {
      list = list.filter(i =>
        i.due_date && i.due_date < today &&
        !i.status.name.toLowerCase().includes('fechad') &&
        !i.status.name.toLowerCase().includes('cancelad')
      );
    } else if (activeFilter === 'reviewToday') {
      list = list.filter(i => getReviewAlert(i) === 'today');
    } else if (activeFilter === 'reviewOverdue') {
      list = list.filter(i => getReviewAlert(i) === 'overdue');
    } else if (activeFilter === 'missing') {
      list = list.filter(i => getMissingFields(i).length > 0);
    }

    return list;
  }, [issues, search, activeFilter, today]);

  const visibleStatuses = useMemo(() => {
    if (!allStatuses || !filteredIssues) return [];
    const usedIds = new Set(filteredIssues.map(i => i.status.id));
    const baseIds = activeFilter || search
      ? new Set(issues?.map(i => i.status.id) ?? [])
      : usedIds;
    return allStatuses.filter(s =>
      !hiddenStatuses.has(s.id) && (baseIds.has(s.id) || pinnedStatuses.has(s.id))
    );
  }, [allStatuses, filteredIssues, issues, hiddenStatuses, pinnedStatuses, activeFilter, search]);

  const issuesByStatus = useMemo(() => {
    const map = new Map<number, Issue[]>();
    visibleStatuses.forEach(s => map.set(s.id, []));
    filteredIssues
      .filter(i => !archivedIds.has(i.id))
      .forEach(issue => {
        const statusId = localIssueStatuses.get(issue.id) ?? issue.status.id;
        if (map.has(statusId)) map.get(statusId)!.push(issue);
      });
    map.forEach((list, key) => map.set(key, sortIssues(list, sortBy)));
    return map;
  }, [filteredIssues, visibleStatuses, localIssueStatuses, sortBy, archivedIds]);

  // Issues arquivadas agrupadas por status (para mostrar no rodapé de cada coluna)
  const archivedByStatus = useMemo(() => {
    const map = new Map<number, Issue[]>();
    visibleStatuses.forEach(s => map.set(s.id, []));
    (issues ?? []).filter(i => archivedIds.has(i.id)).forEach(issue => {
      const statusId = localIssueStatuses.get(issue.id) ?? issue.status.id;
      if (map.has(statusId)) map.get(statusId)!.push(issue);
    });
    return map;
  }, [issues, visibleStatuses, localIssueStatuses, archivedIds]);

  const archiveIssue = useCallback((id: number) => {
    setArchivedIds(prev => { const n = new Set(prev); n.add(id); saveArchived(n); return n; });
  }, []);

  const unarchiveIssue = useCallback((id: number) => {
    setArchivedIds(prev => { const n = new Set(prev); n.delete(id); saveArchived(n); return n; });
  }, []);

  const handleQuickStatusChange = (issueId: number, statusId: number) => {
    const issue = issues?.find(i => i.id === issueId);
    if (!issue) return;
    const current = localIssueStatuses.get(issueId) ?? issue.status.id;
    if (current === statusId) return;
    setLocalIssueStatuses(prev => new Map(prev).set(issueId, statusId));
    updateStatus.mutate(
      { id: issueId, statusId },
      { onError: () => setLocalIssueStatuses(prev => { const m = new Map(prev); m.delete(issueId); return m; }) }
    );
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveIssue(issues?.find(i => `issue-${i.id}` === active.id) ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveIssue(null);
    if (!over) return;
    const issueId = parseInt(String(active.id).replace('issue-', ''));
    const overId = String(over.id);
    if (!overId.startsWith('col-')) return;
    const targetStatusId = parseInt(overId.replace('col-', ''));
    const issue = issues?.find(i => i.id === issueId);
    if (!issue) return;
    const current = localIssueStatuses.get(issueId) ?? issue.status.id;
    if (current === targetStatusId) return;
    setLocalIssueStatuses(prev => new Map(prev).set(issueId, targetStatusId));
    updateStatus.mutate(
      { id: issueId, statusId: targetStatusId },
      {
        onError: (err: any) => {
          setLocalIssueStatuses(prev => { const m = new Map(prev); m.delete(issueId); return m; });
          const detail = err?.response?.data?.errors?.join(', ');
          setDragError(detail || 'Não foi possível mover a tarefa. Verifique as permissões de workflow no Redmine.');
          setTimeout(() => setDragError(null), 5000);
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <RefreshCw size={20} className="animate-spin" />
          <span>Carregando tarefas...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-semibold text-slate-800 whitespace-nowrap">
            Minhas Tarefas
            {userName && <span className="text-slate-400 font-normal ml-1 text-base">— {userName}</span>}
          </h1>
          <span className="text-sm text-slate-400 whitespace-nowrap">
            ({filteredIssues.length}{filteredIssues.length !== (issues?.length ?? 0) ? `/${issues?.length}` : ''})
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Busca */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar… (/ para focar)"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-52 bg-white"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <ArrowUpDown size={12} className="text-slate-400 ml-1.5" />
            {(['priority', 'due_date', 'updated'] as SortBy[]).map(opt => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className={`px-2 py-1 rounded-md transition-all ${
                  sortBy === opt ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {{ priority: 'Prioridade', due_date: 'Prazo', updated: 'Atualizado' }[opt]}
              </button>
            ))}
          </div>

          {/* Ocultar colunas fechadas visíveis */}
          {visibleStatuses.filter(s => allStatuses?.find(a => a.id === s.id)?.is_closed).map(s => (
            <button
              key={s.id}
              onClick={() => setHiddenStatuses(prev => { const n = new Set(prev); n.add(s.id); return n; })}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <EyeOff size={12} />
              Ocultar "{s.name}"
            </button>
          ))}

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-slate-500 hover:text-slate-700"
            title="Atualizar"
          >
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>

          {/* Adicionar coluna vazia */}
          <div className="relative">
            <button
              onClick={() => setShowAddColumn(v => !v)}
              title="Fixar coluna vazia no board"
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 text-sm font-medium rounded-lg transition-colors"
            >
              <Columns size={15} />
              + Coluna
            </button>
            {showAddColumn && allStatuses && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddColumn(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 w-56 py-1 max-h-72 overflow-y-auto scrollbar-thin">
                  <p className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100">Fixar coluna vazia no board</p>
                  {allStatuses.filter(s => !s.is_closed).map(s => {
                    const pinned = pinnedStatuses.has(s.id);
                    const hasIssues = visibleStatuses.some(v => v.id === s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setPinnedStatuses(prev => {
                            const n = new Set(prev);
                            pinned ? n.delete(s.id) : n.add(s.id);
                            return n;
                          });
                        }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 transition-colors ${pinned ? 'text-blue-600 font-medium' : 'text-slate-700'}`}
                      >
                        <span>{s.name}</span>
                        <span className="text-xs text-slate-400">
                          {pinned ? '✓ fixada' : hasIssues ? 'visível' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Modo seleção */}
          <button
            onClick={() => { setSelectionMode(v => !v); clearSelection(); }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
              selectionMode
                ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
            title="Selecionar várias tarefas"
          >
            <CheckSquare size={15} />
            {selectionMode ? 'Concluir' : 'Selecionar'}
          </button>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Nova Tarefa
          </button>
        </div>
      </div>

      {/* Stats / alertas clicáveis */}
      {issues && (
        <StatsBar issues={issues} activeFilter={activeFilter} onFilter={setActiveFilter} />
      )}

      {/* Erro de drag */}
      {dragError && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span>{dragError}</span>
          <button onClick={() => setDragError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1 items-start scrollbar-thin">
          {visibleStatuses.map(status => (
            <KanbanColumn
              key={status.id}
              status={status}
              issues={issuesByStatus.get(status.id) ?? []}
              archivedIssues={archivedByStatus.get(status.id) ?? []}
              onIssueClick={issue => onIssueClick(issue.id)}
              statuses={allStatuses ?? []}
              onQuickStatusChange={handleQuickStatusChange}
              onArchive={archiveIssue}
              onUnarchive={unarchiveIssue}
              selectedIds={selectedIds}
              selectionMode={selectionMode}
              onToggleSelect={toggleSelect}
              pinned={pinnedStatuses.has(status.id)}
              onUnpin={() => setPinnedStatuses(prev => { const n = new Set(prev); n.delete(status.id); return n; })}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeIssue && <IssueCard issue={activeIssue} onClick={() => {}} isDragOverlay />}
        </DragOverlay>
      </DndContext>

      {/* Barra de ações em massa */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-2.5">
          <span className="text-sm font-medium">{selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}</span>
          <div className="w-px h-5 bg-slate-700" />

          {/* Mudar status */}
          <div className="relative">
            <button
              onClick={() => setBulkStatusOpen(v => !v)}
              className="flex items-center gap-1.5 text-sm hover:bg-slate-700 px-2.5 py-1 rounded-lg transition-colors"
            >
              <ArrowUpDown size={14} /> Mudar status
            </button>
            {bulkStatusOpen && allStatuses && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkStatusOpen(false)} />
                <div className="absolute bottom-full left-0 mb-1 bg-white text-slate-700 border border-slate-200 rounded-lg shadow-xl z-20 w-52 py-1 max-h-60 overflow-y-auto scrollbar-thin">
                  {allStatuses.filter(s => !s.is_closed).map(s => (
                    <button
                      key={s.id}
                      onClick={() => bulkChangeStatus(s.id)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={bulkArchive}
            className="flex items-center gap-1.5 text-sm hover:bg-slate-700 px-2.5 py-1 rounded-lg transition-colors"
          >
            <Archive size={14} /> Arquivar
          </button>

          <button onClick={clearSelection} className="text-sm text-slate-400 hover:text-white px-2 py-1 transition-colors">
            Limpar
          </button>
        </div>
      )}

      {showCreate && (
        <CreateIssueModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
