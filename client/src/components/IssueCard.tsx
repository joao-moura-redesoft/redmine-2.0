import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarDays,
  Tag,
  Copy,
  Check,
  ArrowLeftRight,
  AlertTriangle,
  Bell,
  BellRing,
  Clock,
  Archive,
  ListTodo,
  ChevronDown,
  Play,
  Square,
  Loader2,
  Video,
} from 'lucide-react';
import { IssueAIPanel } from './IssueAIPanel';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Issue, IssueStatus, IssueChild } from '../types/redmine';
import { getMissingFields, getReviewAlert, getBranch, getPrevisaoRevisao } from '../utils/alerts';
import { useAllowedStatuses, useCurrentUser } from '../hooks/useRedmine';
import { useJitsiPresence } from '../hooks/useJitsiPresence';
import { useJitsi } from './jitsi/JitsiContext';
import { makeTaskRoom } from '../utils/jitsiConfig';

const PRIORITY_COLORS: Record<string, string> = {
  Baixa: 'bg-slate-100 text-slate-600',
  Normal: 'bg-blue-100 text-blue-700',
  Média: 'bg-blue-100 text-blue-700',
  Alta: 'bg-orange-100 text-orange-700',
  Urgente: 'bg-red-100 text-red-700',
  Imediata: 'bg-red-600 text-white',
};

const PRIORITY_DOTS: Record<string, string> = {
  Baixa: 'bg-slate-400',
  Normal: 'bg-blue-500',
  Média: 'bg-blue-500',
  Alta: 'bg-orange-500',
  Urgente: 'bg-red-500',
  Imediata: 'bg-red-700',
};

/* ── Quick status dropdown ── */
function QuickStatusMenu({
  issue,
  statuses,
  onStatusChange,
}: {
  issue: Issue;
  statuses: IssueStatus[];
  onStatusChange: (issueId: number, statusId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: currentUser } = useCurrentUser();
  // Transições permitidas: buscadas sob demanda (só quando o menu abre), iguais
  // ao Redmine. Cacheadas por workflow, então cards no mesmo estado não refazem.
  const { data: lazyAllowed, isFetching } = useAllowedStatuses(
    {
      issueId: issue.id,
      projectId: issue.project.id,
      trackerId: issue.tracker.id,
      statusId: issue.status.id,
      isAuthor: !!currentUser && issue.author?.id === currentUser.id,
      isAssignee: !!currentUser && issue.assigned_to?.id === currentUser.id,
    },
    open && !issue.allowed_statuses,
  );
  const allowed = issue.allowed_statuses ?? lazyAllowed ?? undefined;
  const allowedIds = allowed?.map((s) => s.id);
  const loading = isFetching && allowedIds === undefined;
  // Espelha o Redmine: só os status permitidos (+ o atual). Sem dados, mostra tudo.
  const visibleStatuses = allowedIds
    ? statuses.filter((s) => allowedIds.includes(s.id) || s.id === issue.status.id)
    : statuses;

  return (
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Mudar status"
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-600 transition-colors"
      >
        <ArrowLeftRight size={11} />
        Status
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 w-52 py-1 max-h-52 overflow-y-auto scrollbar-thin">
            {loading && (
              <p className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> Carregando transições…
              </p>
            )}
            {!loading && allowedIds && allowedIds.length === 0 && (
              <p className="px-3 py-2 text-xs text-amber-600 border-b border-slate-100">
                Sem transições permitidas no workflow.
              </p>
            )}
            {!loading &&
              visibleStatuses.map((s) => (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(issue.id, s.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors
                  ${s.id === issue.status.id ? 'font-semibold text-blue-600 bg-blue-50' : 'hover:bg-blue-50 text-slate-700'}
                `}
                >
                  <span>{s.name}</span>
                  {s.id === issue.status.id && <Check size={11} />}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Copy branch button ── */
function CopyBranchButton({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);

  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(branch);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handle}
      title={`Copiar branch: ${branch}`}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
        copied
          ? 'bg-green-100 text-green-700'
          : 'bg-slate-100 hover:bg-green-100 hover:text-green-700 text-slate-600'
      }`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copiado!' : 'Branch'}
    </button>
  );
}

/* ── Missing fields tooltip ── */
function MissingFieldsBadge({ fields }: { fields: string[] }) {
  return (
    <div className="relative group/missing">
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
        <AlertTriangle size={10} />
        {fields.length}
      </div>
      {/* Tooltip */}
      <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/missing:block z-40 pointer-events-none">
        <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
          <p className="font-semibold mb-1 text-amber-300">Campos obrigatórios faltando:</p>
          {fields.map((f) => (
            <p key={f} className="text-slate-200">
              · {f}
            </p>
          ))}
          <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-900" />
        </div>
      </div>
    </div>
  );
}

/* ── Review date badge ── */
function ReviewBadge({ type }: { type: 'today' | 'overdue' }) {
  if (type === 'today') {
    return (
      <div className="relative group/review">
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium animate-pulse">
          <BellRing size={10} />
          Enviar hoje
        </div>
        <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/review:block z-40 pointer-events-none">
          <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
            <p>Hoje é a data prevista para envio à revisão.</p>
            <p className="text-green-300 mt-1">Mova para "Pendente Revisão" quando pronto.</p>
            <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-900" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group/review">
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
        <Bell size={10} />
        Revisão atrasada
      </div>
      <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/review:block z-40 pointer-events-none">
        <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
          <p>Data de envio à revisão já passou.</p>
          <p className="text-red-300 mt-1">Atualize o campo "Previsão Envio Revisão".</p>
          <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-900" />
        </div>
      </div>
    </div>
  );
}

/* ── Badge AO VIVO (sala de vídeo ativa nesta tarefa) ── */
function LiveBadge({ issue, compact }: { issue: Issue; compact?: boolean }) {
  const { isLive, liveRoom } = useJitsiPresence();
  const { startCall } = useJitsi();
  if (!isLive(issue.id)) return null;
  const info = liveRoom(issue.id);

  const join = (e: React.MouseEvent) => {
    e.stopPropagation();
    startCall({
      room: makeTaskRoom(issue.id),
      title: `#${issue.id} ${issue.subject}`,
      kind: 'task',
      issueId: issue.id,
    });
  };

  const dot = (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
    </span>
  );

  if (compact) {
    return (
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={join}
        title={`AO VIVO — ${info?.count} na sala. Clique para entrar.`}
        className="flex items-center gap-1 text-[10px] font-bold text-red-600 flex-shrink-0"
      >
        {dot} AO VIVO
      </button>
    );
  }

  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={join}
      title={`Entrar na sala — ${info?.participants.join(', ') || ''}`}
      className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition-colors"
    >
      {dot}
      <Video size={12} />
      AO VIVO
      {(info?.count ?? 0) > 1 && (
        <span className="font-medium opacity-70">· {info?.count} pessoas</span>
      )}
    </button>
  );
}

/* ── Subtask list ── */
function SubtaskList({
  children,
  statuses,
  onOpen,
  onDone,
}: {
  children: IssueChild[];
  statuses?: IssueStatus[];
  onOpen?: (id: number) => void;
  onDone?: (id: number, statusId: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const closedStatus = statuses?.find((s) => s.is_closed);

  const isClosed = (child: IssueChild) => {
    if (!child.status) return false;
    const matched = statuses?.find((s) => s.id === child.status!.id);
    if (matched) return matched.is_closed;
    const n = child.status.name.toLowerCase();
    return n.includes('fechad') || n.includes('cancelad');
  };

  const doneCount = children.filter(isClosed).length;
  const pct = children.length > 0 ? (doneCount / children.length) * 100 : 0;

  return (
    <div className="mt-2 pt-2 border-t border-slate-100" onPointerDown={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 w-full"
      >
        <ListTodo size={11} className="flex-shrink-0" />
        <span className="flex-shrink-0">
          {doneCount}/{children.length}
        </span>
        <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-blue-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <ChevronDown
          size={11}
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {children.map((child) => {
            const closed = isClosed(child);
            return (
              <div key={child.id} className="flex items-center gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!closed && closedStatus && onDone) onDone(child.id, closedStatus.id);
                  }}
                  disabled={closed || !closedStatus || !onDone}
                  title={closed ? 'Concluída' : 'Marcar como concluída'}
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    closed
                      ? 'bg-green-500 border-green-500'
                      : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-40'
                  }`}
                >
                  {closed && <Check size={9} className="text-white" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen?.(child.id);
                  }}
                  className={`text-xs flex-1 text-left truncate transition-colors ${
                    closed ? 'line-through text-slate-400' : 'text-slate-600 hover:text-blue-600'
                  }`}
                >
                  {child.subject}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main card ── */
interface Props {
  issue: Issue;
  onClick: (issue: Issue) => void;
  isDragOverlay?: boolean;
  statuses?: IssueStatus[];
  onQuickStatusChange?: (issueId: number, statusId: number) => void;
  onArchive?: (issueId: number) => void;
  selected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (issueId: number) => void;
  focused?: boolean;
  navigable?: boolean;
  compact?: boolean;
  onSubtaskOpen?: (id: number) => void;
  onSubtaskDone?: (id: number, statusId: number) => void;
  activeTimerIssueId?: number | null;
  timerFormatted?: string;
  onTimerStart?: (id: number) => void;
  onTimerStop?: () => void;
}

export function IssueCard({
  issue,
  onClick,
  isDragOverlay = false,
  statuses,
  onQuickStatusChange,
  onArchive,
  selected,
  selectionMode,
  onToggleSelect,
  focused,
  navigable = true,
  compact = false,
  onSubtaskOpen,
  onSubtaskDone,
  activeTimerIssueId,
  timerFormatted,
  onTimerStart,
  onTimerStop,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `issue-${issue.id}`,
    data: { issue },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  const missingFields = getMissingFields(issue);
  const reviewAlert = getReviewAlert(issue);
  const branch = getBranch(issue);
  const isTimerRunning = !isDragOverlay && activeTimerIssueId === issue.id;
  const otherTimerRunning =
    !isDragOverlay && !!activeTimerIssueId && activeTimerIssueId !== issue.id;

  const today = new Date().toISOString().split('T')[0];
  const isClosed =
    issue.status.name.toLowerCase().includes('fechad') ||
    issue.status.name.toLowerCase().includes('cancelad');
  const isDone = issue.done_ratio === 100 || isClosed;
  const previsao = getPrevisaoRevisao(issue);

  const dueBadge = (() => {
    const date = previsao || issue.due_date;
    if (!date) return null;
    const label = new Date(date + 'T00:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
    const prefix = previsao ? 'Rev.' : '';
    if (isDone) return { cls: 'bg-green-100 text-green-700', icon: '✓', label, prefix };
    if (date < today)
      return { cls: 'bg-red-100 text-red-700 font-semibold', icon: null, label, prefix };
    const diffDays = Math.ceil((new Date(date).getTime() - new Date(today).getTime()) / 86400000);
    if (diffDays <= 2)
      return { cls: 'bg-yellow-100 text-yellow-800 font-semibold', icon: null, label, prefix };
    return { cls: 'bg-slate-100 text-slate-600', icon: null, label, prefix };
  })();

  // ── Compact variant ──────────────────────────────────────────────────────
  if (compact && !isDragOverlay) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        {...(navigable ? { 'data-issue-id': issue.id } : {})}
        onClick={(e) => {
          e.stopPropagation();
          if (selectionMode && onToggleSelect) onToggleSelect(issue.id);
          else onClick(issue);
        }}
        className={`
          relative flex items-center gap-2 bg-white rounded border px-2 py-1 cursor-pointer select-none
          transition-all duration-150
          ${focused ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-1' : selected ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200'}
          ${isDragging ? 'opacity-40 scale-95' : 'hover:border-blue-300 hover:shadow-sm'}
        `}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOTS[issue.priority.name] ?? 'bg-slate-400'}`}
        />
        <span className="text-xs text-slate-400 flex-shrink-0">#{issue.id}</span>
        <span className="text-xs font-medium text-slate-800 truncate">{issue.subject}</span>
        <LiveBadge issue={issue} compact />
        {isTimerRunning && (
          <span className="flex items-center gap-0.5 text-[10px] font-mono text-green-600 bg-green-50 px-1.5 py-0.5 rounded flex-shrink-0 animate-pulse">
            <Square size={8} className="fill-green-600" />
            {timerFormatted}
          </span>
        )}
      </div>
    );
  }

  // ── Full variant ─────────────────────────────────────────────────────────
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      {...(navigable && !isDragOverlay ? { 'data-issue-id': issue.id } : {})}
      onClick={(e) => {
        e.stopPropagation();
        if (selectionMode && onToggleSelect) onToggleSelect(issue.id);
        else onClick(issue);
      }}
      className={`
        relative bg-white rounded-lg border p-3 cursor-pointer select-none group
        transition-all duration-150
        ${focused ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-1' : selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-200'}
        ${isDragging && !isDragOverlay ? 'opacity-40 scale-95' : ''}
        ${isDragOverlay ? 'shadow-2xl rotate-1 border-blue-300 scale-105' : 'shadow-sm hover:shadow-md hover:border-blue-300'}
      `}
    >
      {/* Checkbox inline — só no modo seleção */}
      {!isDragOverlay && selectionMode && (
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
              selected
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500 text-transparent'
            }`}
          >
            <Check size={11} />
          </span>
          <span className="text-xs text-slate-400">{selected ? 'Selecionada' : 'Selecionar'}</span>
        </div>
      )}

      {/* Badge de timer ativo */}
      {isTimerRunning && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs font-medium animate-pulse">
          <Square size={9} className="fill-green-600 flex-shrink-0" />
          <span className="font-mono">{timerFormatted}</span>
          <span className="font-normal opacity-70">em andamento</span>
        </div>
      )}

      {/* Badge AO VIVO — sala de vídeo ativa nesta tarefa */}
      {!isDragOverlay && <LiveBadge issue={issue} />}

      {/* Alertas de revisão e campos faltando */}
      {(reviewAlert || missingFields.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {reviewAlert && <ReviewBadge type={reviewAlert} />}
          {missingFields.length > 0 && <MissingFieldsBadge fields={missingFields} />}
        </div>
      )}

      {/* Tracker + Prioridade */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
          <Tag size={10} />
          {issue.tracker.name}
        </span>
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${PRIORITY_COLORS[issue.priority.name] ?? 'bg-slate-100 text-slate-600'}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOTS[issue.priority.name] ?? 'bg-slate-400'}`}
          />
          {issue.priority.name}
        </span>
      </div>

      {/* Título */}
      <p className="text-sm font-medium text-slate-800 leading-snug mb-1.5 line-clamp-2">
        #{issue.id} — {issue.subject}
      </p>

      {/* Projeto */}
      <p className="text-xs text-slate-400 mb-2 truncate">{issue.project.name}</p>

      {/* Footer: prazo estilo Trello + progresso + atualizado */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {dueBadge ? (
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${dueBadge.cls}`}
            >
              {dueBadge.icon ? <span>{dueBadge.icon}</span> : <CalendarDays size={11} />}
              {dueBadge.prefix && <span className="opacity-70">{dueBadge.prefix}</span>}
              {dueBadge.label}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-slate-300">
              <Clock size={11} />
              {formatDistanceToNow(new Date(issue.updated_on), { addSuffix: true, locale: ptBR })}
            </span>
          )}
        </div>

        {issue.done_ratio > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${issue.done_ratio === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${issue.done_ratio}%` }}
              />
            </div>
            <span className="text-xs text-slate-400">{issue.done_ratio}%</span>
          </div>
        )}
      </div>

      {dueBadge && (
        <p className="text-xs text-slate-300 mt-1 flex items-center gap-1">
          <Clock size={10} />
          {formatDistanceToNow(new Date(issue.updated_on), { addSuffix: true, locale: ptBR })}
        </p>
      )}

      {/* Subtarefas */}
      {!isDragOverlay && (issue.children?.length ?? 0) > 0 && (
        <SubtaskList
          children={issue.children!}
          statuses={statuses}
          onOpen={onSubtaskOpen}
          onDone={onSubtaskDone}
        />
      )}

      {/* Ações rápidas — aparecem no hover */}
      {!isDragOverlay && (statuses || branch || onArchive || onTimerStart) && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {statuses && onQuickStatusChange && (
            <QuickStatusMenu
              issue={issue}
              statuses={statuses}
              onStatusChange={onQuickStatusChange}
            />
          )}
          {branch && <CopyBranchButton branch={branch} />}
          <IssueAIPanel issue={issue} compact onOpen={() => onClick(issue)} />
          {/* Timer rápido — só ícone para não quebrar a linha */}
          {(onTimerStart || onTimerStop) &&
            (isTimerRunning ? (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onTimerStop?.();
                }}
                title={`Parar timer (${timerFormatted})`}
                className="flex items-center justify-center w-6 h-6 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors animate-pulse"
              >
                <Square size={10} className="fill-green-700" />
              </button>
            ) : (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onTimerStart?.(issue.id);
                }}
                disabled={otherTimerRunning}
                title={
                  otherTimerRunning
                    ? `Timer ativo em outra tarefa (#${activeTimerIssueId})`
                    : 'Iniciar timer'
                }
                className="flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Play size={10} className="fill-current" />
              </button>
            ))}
          {onArchive && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onArchive(issue.id);
              }}
              title="Arquivar localmente (ocultar sem alterar no Redmine)"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors ml-auto"
            >
              <Archive size={11} />
              Arquivar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
