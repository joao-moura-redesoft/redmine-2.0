import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
import {
  Plus,
  RefreshCw,
  EyeOff,
  Search,
  AlertTriangle,
  Bell,
  BellRing,
  X,
  ArrowUpDown,
  Columns,
  ChevronDown,
  Archive,
  CheckSquare,
  Rows3,
  Flag,
  Milestone,
  CalendarClock,
  Play,
  Square,
  GripHorizontal,
  Palette,
  Layers,
  Gauge,
  User,
} from 'lucide-react';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useIssues,
  useStatuses,
  useUpdateIssueStatus,
  useProjectVersions,
  useVersionIssues,
} from '../hooks/useRedmine';
import { useTimer } from '../hooks/useTimer';
import type { Version } from '../types/redmine';
import { SavedFiltersBar } from './SavedFiltersBar';
import type { SavedFilter } from '../utils/savedFilters';
import { IssueCard } from './IssueCard';
import { CreateIssueModal } from './CreateIssueModal';
import type { Issue, IssueStatus } from '../types/redmine';
import { getMissingFields, getReviewAlert } from '../utils/alerts';

import { loadArchived, saveArchived } from '../utils/archive';

type SortBy = 'priority' | 'due_date' | 'updated';
type GroupBy = 'none' | 'assignee' | 'priority';

const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'Não agrupar',
  assignee: 'Responsável',
  priority: 'Prioridade',
};

const PRIORITY_ORDER: Record<string, number> = {
  Imediata: 0,
  Urgente: 1,
  Alta: 2,
  Normal: 3,
  Baixa: 4,
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

/* ── Sprint summary ── */
function CircleProgress({ pct, size = 44 }: { pct: number; size?: number }) {
  const r = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90 flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#dbeafe" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={pct >= 100 ? '#16a34a' : '#2563eb'}
        strokeWidth={6}
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
}

function SprintSummary({
  version,
  total,
  closed,
  myTotal,
}: {
  version: Version;
  total: number;
  closed: number;
  myTotal: number;
}) {
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  const remaining = total - closed;

  const daysLeft = (() => {
    if (!version.due_date) return null;
    const diff = Math.ceil(
      (new Date(version.due_date + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000,
    );
    return diff;
  })();

  const statusBadge =
    version.status === 'locked' ? (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
        Bloqueada
      </span>
    ) : version.status === 'closed' ? (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
        Encerrada
      </span>
    ) : null;

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 mb-3 bg-blue-50 border border-blue-200 rounded-xl">
      {/* Donut de progresso */}
      <div className="relative flex-shrink-0">
        <CircleProgress pct={pct} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-blue-700">
          {pct}%
        </span>
      </div>

      {/* Nome + status */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-blue-900 truncate">{version.name}</span>
          {statusBadge}
        </div>
        <p className="text-xs text-blue-600 mt-0.5">
          {closed} de {total} tarefa{total !== 1 ? 's' : ''} concluída{closed !== 1 ? 's' : ''}
          {myTotal > 0 && (
            <span className="ml-1 text-blue-400">
              · {myTotal} sua{myTotal !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      {/* Barra de progresso linear */}
      <div className="flex-1 hidden sm:block">
        <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : 'bg-blue-600'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5 text-[10px] text-blue-500">
          <span>{closed} fechadas</span>
          {remaining > 0 && <span>{remaining} abertas</span>}
        </div>
      </div>

      {/* Prazo */}
      {daysLeft !== null && (
        <div
          className={`flex items-center gap-1 text-xs font-medium flex-shrink-0 ${
            daysLeft < 0 ? 'text-red-600' : daysLeft <= 3 ? 'text-orange-600' : 'text-blue-600'
          }`}
        >
          <CalendarClock size={13} />
          {daysLeft < 0
            ? `Venceu há ${Math.abs(daysLeft)}d`
            : daysLeft === 0
              ? 'Vence hoje'
              : `${daysLeft}d restantes`}
        </div>
      )}
    </div>
  );
}

/* ── Stats bar ── */
function StatsBar({
  issues,
  activeFilter,
  onFilter,
}: {
  issues: Issue[];
  activeFilter: string | null;
  onFilter: (f: string | null) => void;
}) {
  const today = new Date().toISOString().split('T')[0];

  const overdue = issues.filter(
    (i) =>
      i.due_date &&
      i.due_date < today &&
      !i.status.name.toLowerCase().includes('fechad') &&
      !i.status.name.toLowerCase().includes('cancelad'),
  );
  const reviewToday = issues.filter((i) => getReviewAlert(i) === 'today');
  const reviewOverdue = issues.filter((i) => getReviewAlert(i) === 'overdue');
  const withMissing = issues.filter((i) => getMissingFields(i).length > 0);

  const chip = (id: string, icon: React.ReactNode, label: string, count: number, color: string) => {
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
      {chip(
        'overdue',
        <AlertTriangle size={11} />,
        'Prazo vencido',
        overdue.length,
        'bg-red-50 text-red-600 border-red-300',
      )}
      {chip(
        'reviewToday',
        <BellRing size={11} />,
        'Enviar revisão hoje',
        reviewToday.length,
        'bg-green-50 text-green-700 border-green-300',
      )}
      {chip(
        'reviewOverdue',
        <Bell size={11} />,
        'Revisão atrasada',
        reviewOverdue.length,
        'bg-orange-50 text-orange-600 border-orange-300',
      )}
      {chip(
        'missing',
        <AlertTriangle size={11} />,
        'Campos faltando',
        withMissing.length,
        'bg-amber-50 text-amber-700 border-amber-300',
      )}
      {activeFilter && (
        <button
          onClick={() => onFilter(null)}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
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
  focusedIssueId?: number;
  compactMode?: boolean;
  onSubtaskOpen?: (id: number) => void;
  onSubtaskDone?: (id: number, statusId: number) => void;
  activeTimerIssueId?: number | null;
  timerFormatted?: string;
  onTimerStart?: (id: number) => void;
  onTimerStop?: () => void;
  customColorKey?: string;
  onColorChange?: (statusId: number, colorKey: string | null) => void;
  wipLimit?: number;
  onWipChange?: (statusId: number, limit: number | null) => void;
  dndId?: string;
  draggableColumn?: boolean;
}

const CUSTOM_COLORS: Record<
  string,
  { borderT: string; bg: string; border: string; dot: string; hex: string }
> = {
  red: {
    borderT: 'border-t-red-500',
    bg: 'bg-red-50',
    border: 'border-red-300',
    dot: 'bg-red-500',
    hex: '#ef4444',
  },
  orange: {
    borderT: 'border-t-orange-500',
    bg: 'bg-orange-50',
    border: 'border-orange-300',
    dot: 'bg-orange-500',
    hex: '#f97316',
  },
  amber: {
    borderT: 'border-t-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    dot: 'bg-amber-500',
    hex: '#f59e0b',
  },
  green: {
    borderT: 'border-t-green-500',
    bg: 'bg-green-50',
    border: 'border-green-300',
    dot: 'bg-green-500',
    hex: '#22c55e',
  },
  cyan: {
    borderT: 'border-t-cyan-500',
    bg: 'bg-cyan-50',
    border: 'border-cyan-300',
    dot: 'bg-cyan-500',
    hex: '#06b6d4',
  },
  blue: {
    borderT: 'border-t-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    dot: 'bg-blue-500',
    hex: '#3b82f6',
  },
  indigo: {
    borderT: 'border-t-indigo-500',
    bg: 'bg-indigo-50',
    border: 'border-indigo-300',
    dot: 'bg-indigo-500',
    hex: '#6366f1',
  },
  violet: {
    borderT: 'border-t-violet-500',
    bg: 'bg-violet-50',
    border: 'border-violet-300',
    dot: 'bg-violet-500',
    hex: '#8b5cf6',
  },
  fuchsia: {
    borderT: 'border-t-fuchsia-500',
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-300',
    dot: 'bg-fuchsia-500',
    hex: '#d946ef',
  },
  rose: {
    borderT: 'border-t-rose-500',
    bg: 'bg-rose-50',
    border: 'border-rose-300',
    dot: 'bg-rose-500',
    hex: '#f43f5e',
  },
  slate: {
    borderT: 'border-t-slate-500',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    dot: 'bg-slate-500',
    hex: '#64748b',
  },
};

const COL_COLORS: Record<string, string> = {
  'Em andamento': 'border-t-blue-500',
  Fechado: 'border-t-slate-300',
  Cancelado: 'border-t-red-300',
  'Pendente Revisão': 'border-t-purple-400',
  'Pendente Teste': 'border-t-yellow-400',
  'Pendente Correção': 'border-t-orange-400',
  'Pendente Desenvolvimento': 'border-t-cyan-400',
  'Pendente Integração': 'border-t-indigo-400',
  'Pendente Fechamento': 'border-t-green-400',
  Impedido: 'border-t-red-500',
};

function KanbanColumn({
  status,
  issues,
  archivedIssues,
  onIssueClick,
  statuses,
  onQuickStatusChange,
  onArchive,
  onUnarchive,
  selectedIds,
  selectionMode,
  onToggleSelect,
  pinned,
  onUnpin,
  focusedIssueId,
  compactMode,
  onSubtaskOpen,
  onSubtaskDone,
  activeTimerIssueId,
  timerFormatted,
  onTimerStart,
  onTimerStop,
  customColorKey,
  onColorChange,
  wipLimit,
  onWipChange,
  dndId,
  draggableColumn = true,
}: ColumnProps) {
  const { isOver, setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({
      id: dndId ?? `col-${status.id}`,
      data: { type: 'Column', status },
    });

  // WIP: conta só os cards ativos (não arquivados) desta coluna.
  const wipCount = issues.length;
  const overWip = wipLimit != null && wipCount > wipLimit;
  const atWip = wipLimit != null && wipCount === wipLimit;
  const [wipOpen, setWipOpen] = useState(false);
  const wipBtnRef = useRef<HTMLButtonElement>(null);
  const [wipCoords, setWipCoords] = useState({ top: 0, left: 0 });

  const toggleWip = () => {
    if (!wipOpen && wipBtnRef.current) {
      const r = wipBtnRef.current.getBoundingClientRect();
      setWipCoords({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 184) });
    }
    setWipOpen((v) => !v);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.3 : 1,
  };

  const customTheme = customColorKey ? CUSTOM_COLORS[customColorKey] : null;
  const fallbackBorder = COL_COLORS[status.name] ?? 'border-t-slate-400';
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(status.is_closed);
  const [colorOpen, setColorOpen] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const [colorCoords, setColorCoords] = useState({ top: 0, left: 0 });

  const toggleColor = () => {
    if (!colorOpen && colorBtnRef.current) {
      const r = colorBtnRef.current.getBoundingClientRect();
      // Popover de 192px (w-48), alinhado à direita do botão.
      setColorCoords({ top: r.bottom + 4, left: Math.min(r.right - 192, window.innerWidth - 200) });
    }
    setColorOpen((v) => !v);
  };

  const headerStyle = customTheme
    ? {
        borderTop: `4px solid ${customTheme.hex}`,
        backgroundColor: isOver ? customTheme.hex + '26' : customTheme.hex + '0f', // 15% opacidade no drag over, 5% normal
        borderColor: customTheme.hex + '40', // 25% opacidade na borda
      }
    : {};

  const bodyStyle = customTheme
    ? {
        backgroundColor: isOver ? customTheme.hex + '1a' : customTheme.hex + '08', // 10% opacidade no drag over, 3% normal
        borderColor: customTheme.hex + '40',
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col w-72 flex-shrink-0 rounded-xl ${customTheme ? `theme-${customColorKey}` : ''} ${isOver ? 'is-over' : ''} ${overWip ? 'ring-2 ring-red-400 ring-offset-2 dark:ring-offset-slate-950' : ''}`}
    >
      {/* Header */}
      <div
        className={`col-header px-4 py-3 border-x border-b transition-colors duration-150
          ${collapsed ? 'rounded-xl' : 'rounded-t-xl'}
          ${!customTheme ? `bg-white border-slate-200 border-t-4 ${fallbackBorder}` : ''}
          ${isOver && !customTheme ? 'bg-blue-50 border-blue-300' : ''}`}
        style={headerStyle}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {draggableColumn && (
              <div
                {...attributes}
                {...listeners}
                className="cursor-grab hover:bg-slate-100 p-1 rounded transition-colors text-slate-400 hover:text-slate-600"
                title="Arrastar coluna"
              >
                <GripHorizontal size={14} />
              </div>
            )}
            <h3 className="text-sm font-semibold text-slate-700 truncate">{status.name}</h3>

            {/* Contador / limite WIP — clique para definir o limite */}
            <div className="flex-shrink-0">
              <button
                ref={wipBtnRef}
                onClick={onWipChange ? toggleWip : undefined}
                title={onWipChange ? 'Definir limite WIP' : undefined}
                className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                  overWip
                    ? 'bg-red-100 text-red-700'
                    : atWip
                      ? 'bg-amber-100 text-amber-700'
                      : 'text-slate-400 bg-slate-100'
                } ${onWipChange ? 'hover:bg-slate-200 cursor-pointer' : 'cursor-default'}`}
              >
                {wipLimit != null
                  ? `${wipCount}/${wipLimit}`
                  : issues.length + archivedIssues.length}
              </button>
              {wipOpen &&
                onWipChange &&
                createPortal(
                  <>
                    <div className="fixed inset-0 z-[100]" onClick={() => setWipOpen(false)} />
                    <div
                      className="fixed z-[101] bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-44"
                      style={{ top: wipCoords.top, left: wipCoords.left }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                        Limite WIP — {status.name}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Gauge size={13} className="text-slate-400 flex-shrink-0" />
                        <input
                          type="number"
                          min={0}
                          autoFocus
                          defaultValue={wipLimit ?? ''}
                          placeholder="—"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = parseInt((e.target as HTMLInputElement).value);
                              onWipChange(status.id, isNaN(v) ? null : v);
                              setWipOpen(false);
                            }
                            if (e.key === 'Escape') setWipOpen(false);
                          }}
                          className="w-full text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <button
                          onClick={() => {
                            onWipChange(status.id, null);
                            setWipOpen(false);
                          }}
                          className="text-[11px] text-slate-400 hover:text-red-600"
                        >
                          Remover
                        </button>
                        <span className="text-[10px] text-slate-400">Enter p/ salvar</span>
                      </div>
                    </div>
                  </>,
                  document.body,
                )}
            </div>

            {overWip && (
              <span
                className="flex items-center gap-1 text-[10px] font-bold text-red-600 flex-shrink-0"
                title={`Acima do limite WIP (${wipLimit})`}
              >
                <AlertTriangle size={11} /> Gargalo
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onColorChange && (
              <div>
                <button
                  ref={colorBtnRef}
                  onClick={toggleColor}
                  title="Mudar cor da coluna"
                  className="text-slate-300 hover:text-slate-500 transition-colors p-0.5 rounded"
                >
                  <Palette size={13} />
                </button>
                {colorOpen &&
                  createPortal(
                    <>
                      <div className="fixed inset-0 z-[100]" onClick={() => setColorOpen(false)} />
                      <div
                        className="fixed z-[101] bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-48 flex flex-wrap gap-1.5 cursor-default"
                        style={{ top: colorCoords.top, left: colorCoords.left }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {Object.entries(CUSTOM_COLORS).map(([key, c]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onColorChange(status.id, key);
                              setColorOpen(false);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            title={`Cor ${key}`}
                            className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${customColorKey === key ? 'border-slate-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: c.hex }}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onColorChange(status.id, null);
                            setColorOpen(false);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          title="Cor padrão"
                          className={`w-6 h-6 rounded-full border-2 border-slate-200 flex items-center justify-center transition-transform hover:scale-110 hover:bg-slate-50 ${!customColorKey ? 'border-slate-800 scale-110' : ''}`}
                        >
                          <X size={12} className="text-slate-400" />
                        </button>
                      </div>
                    </>,
                    document.body,
                  )}
              </div>
            )}
            {pinned && issues.length === 0 && onUnpin && (
              <button
                onClick={onUnpin}
                title="Remover coluna"
                className="text-slate-300 hover:text-slate-500 transition-colors p-0.5 rounded"
              >
                <X size={13} />
              </button>
            )}
            <button
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'Expandir coluna' : 'Recolher coluna'}
              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 rounded"
            >
              <ChevronDown
                size={15}
                className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
              />
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
          className={`col-body flex-1 min-h-[200px] p-2 rounded-b-xl border border-t-0 space-y-2 transition-colors duration-150 ${
            isOver && !customTheme
              ? 'bg-blue-50 border-blue-300'
              : !isOver && !customTheme
                ? 'bg-slate-50 border-slate-200'
                : ''
          }`}
        >
          {issues.map((issue) => (
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
              focused={focusedIssueId === issue.id}
              compact={compactMode}
              onSubtaskOpen={onSubtaskOpen}
              onSubtaskDone={onSubtaskDone}
              activeTimerIssueId={activeTimerIssueId}
              timerFormatted={timerFormatted}
              onTimerStart={onTimerStart}
              onTimerStop={onTimerStop}
            />
          ))}
          {issues.length === 0 && (
            <div
              className={`flex items-center justify-center h-20 rounded-lg border-2 border-dashed transition-colors ${isOver && !customTheme ? 'border-blue-300 bg-blue-50/50' : !isOver && !customTheme ? 'border-slate-200' : ''} ${customTheme ? 'col-empty-state' : ''}`}
            >
              <p className="text-xs text-slate-400">Solte aqui</p>
            </div>
          )}

          {/* Arquivadas */}
          {archivedIssues.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200">
              <button
                onClick={() => setArchivedOpen((v) => !v)}
                className="w-full flex items-center gap-1.5 px-1 py-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Archive size={11} />
                <span>Arquivadas ({archivedIssues.length})</span>
                <ChevronDown
                  size={11}
                  className={`ml-auto transition-transform ${archivedOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {archivedOpen && (
                <div className="space-y-1.5 mt-1.5">
                  {archivedIssues.map((issue) => (
                    <div key={issue.id} className="relative group/arch">
                      <div className="opacity-50 pointer-events-none">
                        <IssueCard issue={issue} onClick={() => {}} navigable={false} />
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

const PRIORITY_DOTS: Record<string, string> = {
  Imediata: 'bg-red-700',
  Urgente: 'bg-red-500',
  Alta: 'bg-orange-500',
  Normal: 'bg-blue-500',
  Baixa: 'bg-slate-400',
};

/* ── Board ── */
interface Props {
  projectId?: number;
  userName?: string;
  onIssueClick: (id: number) => void;
  focusedIssueId?: number;
  onProjectChange?: (id: number | undefined) => void;
}

export function KanbanBoard({
  projectId,
  userName,
  onIssueClick,
  focusedIssueId,
  onProjectChange,
}: Props) {
  const { data: allStatuses } = useStatuses();
  const { data: issues, isLoading, refetch, isFetching } = useIssues(projectId);
  const updateStatus = useUpdateIssueStatus();
  const timer = useTimer();

  const [showCreate, setShowCreate] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<number>>(new Set());
  const [columnColors, setColumnColors] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem('kanban-column-colors');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  useEffect(() => {
    localStorage.setItem('kanban-column-colors', JSON.stringify(columnColors));
  }, [columnColors]);

  const [pinnedStatuses, setPinnedStatuses] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('kanban-pinned-statuses');
      if (saved) return new Set(JSON.parse(saved));
    } catch (e) {}
    return new Set();
  });
  const [archivedIds, setArchivedIds] = useState<Set<number>>(loadArchived);
  const [localIssueStatuses, setLocalIssueStatuses] = useState<Map<number, number>>(new Map());
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [columnOrder, setColumnOrder] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('kanban-column-order');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(
    () => localStorage.getItem('kanban-compact') === 'true',
  );
  const [wipLimits, setWipLimits] = useState<Record<number, number>>(() => {
    try {
      const s = localStorage.getItem('kanban-wip-limits');
      if (s) return JSON.parse(s);
    } catch (e) {}
    return {};
  });
  const [groupBy, setGroupBy] = useState<GroupBy>(
    () => (localStorage.getItem('kanban-group-by') as GroupBy) || 'none',
  );
  const [groupOpen, setGroupOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<number | undefined>(undefined);
  const [versionOpen, setVersionOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Arrastar com o botão direito para rolar o board horizontalmente
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    let startX = 0;
    let startScroll = 0;
    let moved = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      e.preventDefault(); // impede o menu de contexto de abrir durante o arraste
      startX = e.clientX;
      startScroll = el.scrollLeft;
      moved = false;
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = startScroll - dx;
    };

    const onMouseUp = () => {
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    // Suprime o contextmenu só se houve movimento real
    const suppressCtx = (e: Event) => e.preventDefault();

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', suppressCtx);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', suppressCtx);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const { data: versions } = useProjectVersions(projectId);
  const { data: versionIssues } = useVersionIssues(projectId, selectedVersionId);

  const toggleCompact = () =>
    setCompactMode((v) => {
      const next = !v;
      localStorage.setItem('kanban-compact', String(next));
      return next;
    });

  // Reseta versão quando o projeto muda
  const prevProjectRef = useRef(projectId);
  if (prevProjectRef.current !== projectId) {
    prevProjectRef.current = projectId;
    if (selectedVersionId !== undefined) setSelectedVersionId(undefined);
  }

  const handleSubtaskDone = useCallback(
    (subtaskId: number, statusId: number) => {
      updateStatus.mutate({ id: subtaskId, statusId });
    },
    [updateStatus],
  );

  useEffect(() => {
    localStorage.setItem('kanban-wip-limits', JSON.stringify(wipLimits));
  }, [wipLimits]);

  const handleWipChange = useCallback((statusId: number, limit: number | null) => {
    setWipLimits((prev) => {
      const next = { ...prev };
      if (limit && limit > 0) next[statusId] = limit;
      else delete next[statusId];
      return next;
    });
  }, []);

  const changeGroupBy = useCallback((g: GroupBy) => {
    setGroupBy(g);
    localStorage.setItem('kanban-group-by', g);
    setGroupOpen(false);
  }, []);

  const handleColorChange = useCallback((statusId: number, colorKey: string | null) => {
    setColumnColors((prev) => {
      const next = { ...prev };
      if (colorKey) {
        next[statusId] = colorKey;
      } else {
        delete next[statusId];
      }
      return next;
    });
  }, []);

  const togglePinnedStatus = useCallback((id: number) => {
    setPinnedStatuses((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem('kanban-pinned-statuses', JSON.stringify(Array.from(n)));
      return n;
    });
  }, []);

  const applyFilter = (f: SavedFilter) => {
    setSortBy(f.sortBy);
    setPriorityFilter(f.priorityFilter);
    setActiveFilter(f.alertFilter);
    if (onProjectChange) onProjectChange(f.projectId);
  };

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const clearSelection = () => setSelectedIds(new Set());

  const bulkChangeStatus = (statusId: number) => {
    selectedIds.forEach((id) => {
      const issue = issues?.find((i) => i.id === id);
      if (!issue || issue.status.id === statusId) return;
      setLocalIssueStatuses((prev) => new Map(prev).set(id, statusId));
      updateStatus.mutate(
        { id, statusId },
        {
          onError: () =>
            setLocalIssueStatuses((prev) => {
              const m = new Map(prev);
              m.delete(id);
              return m;
            }),
        },
      );
    });
    setBulkStatusOpen(false);
    clearSelection();
  };

  const bulkArchive = () => {
    selectedIds.forEach((id) => archiveIssue(id));
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const today = new Date().toISOString().split('T')[0];

  // Aplica busca textual + filtro rápido de alertas + filtro de prioridade
  const filteredIssues = useMemo(() => {
    if (!issues) return [];
    let list = issues;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.subject.toLowerCase().includes(q) || String(i.id).includes(q));
    }

    if (priorityFilter) {
      list = list.filter((i) => i.priority.name === priorityFilter);
    }

    if (selectedVersionId) {
      list = list.filter((i) => i.fixed_version?.id === selectedVersionId);
    }

    if (activeFilter === 'overdue') {
      list = list.filter(
        (i) =>
          i.due_date &&
          i.due_date < today &&
          !i.status.name.toLowerCase().includes('fechad') &&
          !i.status.name.toLowerCase().includes('cancelad'),
      );
    } else if (activeFilter === 'reviewToday') {
      list = list.filter((i) => getReviewAlert(i) === 'today');
    } else if (activeFilter === 'reviewOverdue') {
      list = list.filter((i) => getReviewAlert(i) === 'overdue');
    } else if (activeFilter === 'missing') {
      list = list.filter((i) => getMissingFields(i).length > 0);
    }

    return list;
  }, [issues, search, activeFilter, priorityFilter, selectedVersionId, today]);

  const visibleStatuses = useMemo(() => {
    if (!allStatuses || !filteredIssues) return [];
    const usedIds = new Set(filteredIssues.map((i) => i.status.id));
    const baseIds =
      activeFilter || search ? new Set(issues?.map((i) => i.status.id) ?? []) : usedIds;

    const visible = allStatuses.filter(
      (s) => !hiddenStatuses.has(s.id) && (baseIds.has(s.id) || pinnedStatuses.has(s.id)),
    );

    // Ordenar de acordo com columnOrder
    if (columnOrder.length > 0) {
      visible.sort((a, b) => {
        const idxA = columnOrder.indexOf(a.id);
        const idxB = columnOrder.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }
    return visible;
  }, [
    allStatuses,
    filteredIssues,
    issues,
    hiddenStatuses,
    pinnedStatuses,
    activeFilter,
    search,
    columnOrder,
  ]);

  const issuesByStatus = useMemo(() => {
    const map = new Map<number, Issue[]>();
    visibleStatuses.forEach((s) => map.set(s.id, []));
    filteredIssues
      .filter((i) => !archivedIds.has(i.id))
      .forEach((issue) => {
        const statusId = localIssueStatuses.get(issue.id) ?? issue.status.id;
        if (map.has(statusId)) map.get(statusId)!.push(issue);
      });
    map.forEach((list, key) => map.set(key, sortIssues(list, sortBy)));
    return map;
  }, [filteredIssues, visibleStatuses, localIssueStatuses, sortBy, archivedIds]);

  // Swimlanes: agrupa as tarefas ativas por responsável ou prioridade, mantendo
  // as mesmas colunas de status dentro de cada raia. null = visão normal.
  const laneKeyOf = useCallback(
    (i: Issue) => {
      if (groupBy === 'assignee') return i.assigned_to?.name ?? 'Sem responsável';
      if (groupBy === 'priority') return i.priority.name;
      return '';
    },
    [groupBy],
  );

  const lanes = useMemo(() => {
    if (groupBy === 'none') return null;
    const active = filteredIssues.filter((i) => !archivedIds.has(i.id));
    const keys = Array.from(new Set(active.map(laneKeyOf)));
    if (groupBy === 'priority') {
      keys.sort((a, b) => (PRIORITY_ORDER[a] ?? 5) - (PRIORITY_ORDER[b] ?? 5));
    } else {
      keys.sort((a, b) =>
        a === 'Sem responsável' ? 1 : b === 'Sem responsável' ? -1 : a.localeCompare(b),
      );
    }
    return keys.map((key) => {
      const byStatus = new Map<number, Issue[]>();
      visibleStatuses.forEach((s) => byStatus.set(s.id, []));
      let count = 0;
      active.forEach((i) => {
        if (laneKeyOf(i) !== key) return;
        count++;
        const sid = localIssueStatuses.get(i.id) ?? i.status.id;
        if (byStatus.has(sid)) byStatus.get(sid)!.push(i);
      });
      byStatus.forEach((list, k) => byStatus.set(k, sortIssues(list, sortBy)));
      return { key, label: key, byStatus, count };
    });
  }, [
    groupBy,
    filteredIssues,
    archivedIds,
    visibleStatuses,
    localIssueStatuses,
    sortBy,
    laneKeyOf,
  ]);

  // Issues arquivadas agrupadas por status (para mostrar no rodapé de cada coluna)
  const archivedByStatus = useMemo(() => {
    const map = new Map<number, Issue[]>();
    visibleStatuses.forEach((s) => map.set(s.id, []));
    (issues ?? [])
      .filter((i) => archivedIds.has(i.id))
      .forEach((issue) => {
        const statusId = localIssueStatuses.get(issue.id) ?? issue.status.id;
        if (map.has(statusId)) map.get(statusId)!.push(issue);
      });
    return map;
  }, [issues, visibleStatuses, localIssueStatuses, archivedIds]);

  const archiveIssue = useCallback((id: number) => {
    setArchivedIds((prev) => {
      const n = new Set(prev);
      n.add(id);
      saveArchived(n);
      return n;
    });
  }, []);

  const unarchiveIssue = useCallback((id: number) => {
    setArchivedIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      saveArchived(n);
      return n;
    });
  }, []);

  const handleQuickStatusChange = (issueId: number, statusId: number) => {
    const issue = issues?.find((i) => i.id === issueId);
    if (!issue) return;
    const current = localIssueStatuses.get(issueId) ?? issue.status.id;
    if (current === statusId) return;
    setLocalIssueStatuses((prev) => new Map(prev).set(issueId, statusId));
    updateStatus.mutate(
      { id: issueId, statusId },
      {
        onError: () =>
          setLocalIssueStatuses((prev) => {
            const m = new Map(prev);
            m.delete(issueId);
            return m;
          }),
      },
    );
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (String(active.id).startsWith('issue-')) {
      setActiveIssue(issues?.find((i) => `issue-${i.id}` === active.id) ?? null);
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveIssue(null);
    if (!over) return;

    // Se estiver arrastando uma COLUNA (só na visão normal; em swimlanes as
    // colunas não são reordenáveis)
    if (
      groupBy === 'none' &&
      active.data.current?.type === 'Column' &&
      over.data.current?.type === 'Column'
    ) {
      if (active.id !== over.id) {
        const oldIndex = visibleStatuses.findIndex((s) => `col-${s.id}` === active.id);
        const newIndex = visibleStatuses.findIndex((s) => `col-${s.id}` === over.id);

        const newOrder = arrayMove(
          visibleStatuses.map((s) => s.id),
          oldIndex,
          newIndex,
        );
        setColumnOrder(newOrder);
        localStorage.setItem('kanban-column-order', JSON.stringify(newOrder));
      }
      return;
    }

    // Se estiver arrastando uma TAREFA
    const issueId = parseInt(String(active.id).replace('issue-', ''));
    const overId = String(over.id);
    if (!overId.startsWith('col-')) return;

    // Em swimlanes o id da coluna é "col-<statusId>__<laneKey>"; extrai o status.
    const targetStatusId = parseInt(overId.replace('col-', '').split('__')[0]);
    const issue = issues?.find((i) => i.id === issueId);
    if (!issue) return;

    const current = localIssueStatuses.get(issueId) ?? issue.status.id;
    if (current === targetStatusId) return;

    setLocalIssueStatuses((prev) => new Map(prev).set(issueId, targetStatusId));
    updateStatus.mutate(
      { id: issueId, statusId: targetStatusId },
      {
        onError: (err: any) => {
          setLocalIssueStatuses((prev) => {
            const m = new Map(prev);
            m.delete(issueId);
            return m;
          });
          const detail = err?.response?.data?.errors?.join(', ');
          setDragError(
            detail ||
              'Não foi possível mover a tarefa. Verifique as permissões de workflow no Redmine.',
          );
          setTimeout(() => setDragError(null), 5000);
        },
      },
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
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 min-w-0">
      <style>{`
        ${Object.entries(CUSTOM_COLORS)
          .map(
            ([key, c]) => `
          .theme-${key} {
            --col-bg: ${c.hex}0f;
            --col-bg-hover: ${c.hex}1a;
            --col-border: ${c.hex}40;
            --col-border-top: ${c.hex};
          }
          html.dark .theme-${key} {
            --col-bg: ${c.hex}26;
            --col-bg-hover: ${c.hex}40;
            --col-border: ${c.hex}66;
          }
          
          /* Especificidade altíssima para esmagar as regras do index.css (html.dark .border-b) */
          body .theme-${key} .col-header,
          html.dark body .theme-${key} .col-header {
            border-top-color: var(--col-border-top) !important;
            border-top-width: 4px !important;
            border-top-style: solid !important;
            background-color: var(--col-bg) !important;
          }
          body .theme-${key} .col-body,
          html.dark body .theme-${key} .col-body {
            background-color: var(--col-bg) !important;
            border-color: var(--col-border) !important;
          }
          body .theme-${key}.is-over .col-header,
          html.dark body .theme-${key}.is-over .col-header,
          body .theme-${key}.is-over .col-body,
          html.dark body .theme-${key}.is-over .col-body {
            background-color: var(--col-bg-hover) !important;
            border-color: var(--col-border) !important;
          }
          body .theme-${key} .col-empty-state,
          html.dark body .theme-${key} .col-empty-state {
            background-color: var(--col-bg) !important;
            border-color: var(--col-border) !important;
          }
          body .theme-${key}.is-over .col-empty-state,
          html.dark body .theme-${key}.is-over .col-empty-state {
            background-color: var(--col-bg-hover) !important;
          }
        `,
          )
          .join('\n')}
      `}</style>
      {/* HEADER */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-semibold text-slate-800 whitespace-nowrap">
            Minhas Tarefas
            {userName && (
              <span className="text-slate-400 font-normal ml-1 text-base">— {userName}</span>
            )}
          </h1>
          <span className="text-sm text-slate-400 whitespace-nowrap">
            ({filteredIssues.length}
            {filteredIssues.length !== (issues?.length ?? 0) ? `/${issues?.length}` : ''})
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Busca */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar… (/ para focar)"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-52 bg-white"
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

          {/* Sort */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <ArrowUpDown size={12} className="text-slate-400 ml-1.5" />
            {(['priority', 'due_date', 'updated'] as SortBy[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className={`px-2 py-1 rounded-md transition-all ${
                  sortBy === opt
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {{ priority: 'Prioridade', due_date: 'Prazo', updated: 'Atualizado' }[opt]}
              </button>
            ))}
          </div>

          {/* Ocultar colunas fechadas visíveis */}
          {visibleStatuses
            .filter((s) => allStatuses?.find((a) => a.id === s.id)?.is_closed)
            .map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  setHiddenStatuses((prev) => {
                    const n = new Set(prev);
                    n.add(s.id);
                    return n;
                  })
                }
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
              onClick={() => setShowAddColumn((v) => !v)}
              title="Fixar coluna vazia no board"
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 text-sm font-medium rounded-lg transition-colors"
            >
              <Columns size={15} />+ Coluna
            </button>
            {showAddColumn && allStatuses && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddColumn(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 w-56 py-1 max-h-72 overflow-y-auto scrollbar-thin">
                  <p className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100">
                    Fixar coluna vazia no board
                  </p>
                  {allStatuses
                    .filter((s) => !s.is_closed)
                    .map((s) => {
                      const pinned = pinnedStatuses.has(s.id);
                      const hasIssues = visibleStatuses.some((v) => v.id === s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => togglePinnedStatus(s.id)}
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
            onClick={() => {
              setSelectionMode((v) => !v);
              clearSelection();
            }}
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

          {/* Filtro por versão/sprint (só aparece quando um projeto está selecionado) */}
          {projectId && versions && versions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setVersionOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  selectedVersionId
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                title="Filtrar por versão/sprint"
              >
                <Milestone size={13} />
                {selectedVersionId
                  ? (versions.find((v) => v.id === selectedVersionId)?.name ?? 'Versão')
                  : 'Versão'}
                {selectedVersionId && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedVersionId(undefined);
                    }}
                    className="text-indigo-400 hover:text-indigo-700"
                  >
                    <X size={11} />
                  </span>
                )}
              </button>
              {versionOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setVersionOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 w-56 max-h-64 overflow-y-auto scrollbar-thin">
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      Versões do projeto
                    </p>
                    {versions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setSelectedVersionId(v.id);
                          setVersionOpen(false);
                        }}
                        className={`w-full text-left flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-indigo-50 transition-colors ${
                          selectedVersionId === v.id
                            ? 'text-indigo-700 font-semibold bg-indigo-50'
                            : 'text-slate-700'
                        }`}
                      >
                        <span className="truncate">{v.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                            v.status === 'open'
                              ? 'bg-green-100 text-green-700'
                              : v.status === 'locked'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {v.status === 'open'
                            ? 'Aberta'
                            : v.status === 'locked'
                              ? 'Bloqueada'
                              : 'Encerrada'}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Filtro por prioridade */}
          <div className="relative">
            <button
              onClick={() => setPriorityOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                priorityFilter
                  ? 'bg-orange-50 border-orange-300 text-orange-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
              title="Filtrar por prioridade"
            >
              <Flag size={13} />
              {priorityFilter || 'Prioridade'}
              {priorityFilter && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPriorityFilter('');
                  }}
                  className="text-orange-400 hover:text-orange-700"
                >
                  <X size={11} />
                </span>
              )}
            </button>
            {priorityOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPriorityOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 w-44">
                  {['', 'Imediata', 'Urgente', 'Alta', 'Normal', 'Baixa'].map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setPriorityFilter(p);
                        setPriorityOpen(false);
                      }}
                      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-blue-50 transition-colors ${priorityFilter === p ? 'text-blue-600 font-semibold' : 'text-slate-700'}`}
                    >
                      {p ? (
                        <>
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOTS[p] ?? 'bg-slate-400'}`}
                          />
                          {p}
                        </>
                      ) : (
                        <span className="text-slate-500">Todas as prioridades</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Agrupar por (swimlanes) */}
          <div className="relative">
            <button
              onClick={() => setGroupOpen((v) => !v)}
              title="Agrupar tarefas em raias (swimlanes)"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                groupBy !== 'none'
                  ? 'bg-violet-50 border-violet-300 text-violet-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Layers size={13} />
              {groupBy === 'none' ? 'Agrupar' : `Agrupar: ${GROUP_LABELS[groupBy]}`}
              {groupBy !== 'none' && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    changeGroupBy('none');
                  }}
                  className="text-violet-400 hover:text-violet-700"
                >
                  <X size={11} />
                </span>
              )}
            </button>
            {groupOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setGroupOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 w-48">
                  {(['none', 'assignee', 'priority'] as GroupBy[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => changeGroupBy(g)}
                      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-blue-50 transition-colors ${groupBy === g ? 'text-blue-600 font-semibold' : 'text-slate-700'}`}
                    >
                      {g === 'assignee' ? (
                        <User size={13} />
                      ) : g === 'priority' ? (
                        <Flag size={13} />
                      ) : (
                        <Rows3 size={13} />
                      )}
                      {GROUP_LABELS[g]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={toggleCompact}
            title={compactMode ? 'Desativar modo compacto' : 'Ativar modo compacto'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
              compactMode
                ? 'bg-blue-100 border-blue-300 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Rows3 size={15} />
            Compacto
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

      {/* Filtros salvos */}
      <SavedFiltersBar
        currentFilter={{ projectId, sortBy, priorityFilter, alertFilter: activeFilter }}
        onApply={applyFilter}
      />

      {/* Banner de sprint (só quando versão está selecionada) */}
      {selectedVersionId &&
        versions &&
        (() => {
          const version = versions.find((v) => v.id === selectedVersionId);
          if (!version) return null;
          const total = versionIssues?.length ?? 0;
          const closed = versionIssues?.filter((i) => i.status.is_closed).length ?? 0;
          const myTotal = filteredIssues.length;
          return (
            <SprintSummary version={version} total={total} closed={closed} myTotal={myTotal} />
          );
        })()}

      {/* Stats / alertas clicáveis */}
      {issues && (
        <StatsBar issues={issues} activeFilter={activeFilter} onFilter={setActiveFilter} />
      )}

      {/* Erro de drag */}
      {dragError && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span>{dragError}</span>
          <button
            onClick={() => setDragError(null)}
            className="ml-auto text-red-400 hover:text-red-600"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {lanes ? (
          /* ── Visão em swimlanes (raias) ── */
          <div
            ref={boardRef}
            className="flex flex-col gap-5 overflow-auto pb-4 flex-1 scrollbar-thin"
          >
            {lanes.map((lane) => (
              <div key={lane.key} className="flex-shrink-0">
                <div className="flex items-center gap-2 mb-2 sticky left-0">
                  {groupBy === 'assignee' ? (
                    <User size={14} className="text-violet-500" />
                  ) : (
                    <Flag size={14} className="text-violet-500" />
                  )}
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {lane.label}
                  </h3>
                  <span className="text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {lane.count}
                  </span>
                </div>
                <SortableContext
                  items={visibleStatuses.map((s) => `col-${s.id}__${lane.key}`)}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="flex gap-4 items-start overflow-x-auto pb-2 scrollbar-thin">
                    {visibleStatuses.map((status) => (
                      <KanbanColumn
                        key={`${status.id}__${lane.key}`}
                        dndId={`col-${status.id}__${lane.key}`}
                        draggableColumn={false}
                        status={status}
                        issues={lane.byStatus.get(status.id) ?? []}
                        archivedIssues={[]}
                        onIssueClick={(issue) => onIssueClick(issue.id)}
                        statuses={allStatuses ?? []}
                        onQuickStatusChange={handleQuickStatusChange}
                        onArchive={archiveIssue}
                        onUnarchive={unarchiveIssue}
                        selectedIds={selectedIds}
                        selectionMode={selectionMode}
                        onToggleSelect={toggleSelect}
                        focusedIssueId={focusedIssueId}
                        compactMode={compactMode}
                        onSubtaskOpen={onIssueClick}
                        onSubtaskDone={handleSubtaskDone}
                        activeTimerIssueId={timer.activeIssueId}
                        timerFormatted={timer.formatted}
                        onTimerStart={timer.start}
                        onTimerStop={() => timer.stop()}
                        customColorKey={columnColors[status.id]}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ))}
          </div>
        ) : (
          /* ── Visão normal (colunas) ── */
          <div
            ref={boardRef}
            className="flex gap-4 overflow-x-auto pb-4 flex-1 items-start scrollbar-thin"
          >
            <SortableContext
              items={visibleStatuses.map((s) => `col-${s.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              {visibleStatuses.map((status) => (
                <KanbanColumn
                  key={status.id}
                  status={status}
                  issues={issuesByStatus.get(status.id) ?? []}
                  archivedIssues={archivedByStatus.get(status.id) ?? []}
                  onIssueClick={(issue) => onIssueClick(issue.id)}
                  statuses={allStatuses ?? []}
                  onQuickStatusChange={handleQuickStatusChange}
                  onArchive={archiveIssue}
                  onUnarchive={unarchiveIssue}
                  selectedIds={selectedIds}
                  selectionMode={selectionMode}
                  onToggleSelect={toggleSelect}
                  pinned={pinnedStatuses.has(status.id)}
                  onUnpin={() => togglePinnedStatus(status.id)}
                  focusedIssueId={focusedIssueId}
                  compactMode={compactMode}
                  onSubtaskOpen={onIssueClick}
                  onSubtaskDone={handleSubtaskDone}
                  activeTimerIssueId={timer.activeIssueId}
                  timerFormatted={timer.formatted}
                  onTimerStart={timer.start}
                  onTimerStop={() => timer.stop()}
                  customColorKey={columnColors[status.id]}
                  onColorChange={handleColorChange}
                  wipLimit={wipLimits[status.id]}
                  onWipChange={handleWipChange}
                />
              ))}
            </SortableContext>
          </div>
        )}

        <DragOverlay
          dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}
        >
          {activeIssue && (
            <IssueCard issue={activeIssue} onClick={() => {}} isDragOverlay navigable={false} />
          )}
        </DragOverlay>
      </DndContext>

      {/* Barra de ações em massa */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-2.5">
          <span className="text-sm font-medium">
            {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="w-px h-5 bg-slate-700" />

          {/* Mudar status */}
          <div className="relative">
            <button
              onClick={() => setBulkStatusOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm hover:bg-slate-700 px-2.5 py-1 rounded-lg transition-colors"
            >
              <ArrowUpDown size={14} /> Mudar status
            </button>
            {bulkStatusOpen && allStatuses && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkStatusOpen(false)} />
                <div className="absolute bottom-full left-0 mb-1 bg-white text-slate-700 border border-slate-200 rounded-lg shadow-xl z-20 w-52 py-1 max-h-60 overflow-y-auto scrollbar-thin">
                  {allStatuses
                    .filter((s) => !s.is_closed)
                    .map((s) => (
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

          <button
            onClick={clearSelection}
            className="text-sm text-slate-400 hover:text-white px-2 py-1 transition-colors"
          >
            Limpar
          </button>
        </div>
      )}

      {showCreate && <CreateIssueModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
