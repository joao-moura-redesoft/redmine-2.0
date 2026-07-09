import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  addWeeks,
  isSameMonth,
  isSameDay,
  format,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  CalendarDays,
  Loader2,
  User,
  Users,
  Search,
  Check,
  Clock,
  MapPin,
  X,
  Flag,
  Eye,
  Filter,
  Inbox,
  Plus,
  Video,
  Trash2,
} from 'lucide-react';
import { useIssues, useUserIssues, useAllMembers, useUpdateIssue } from '../hooks/useRedmine';
import { useZimbraEvents, useReplyToInvite, useEventAttendees } from '../hooks/useZimbraEvents';
import { useLocalEvents, useDeleteLocalEvent } from '../hooks/useLocalEvents';
import type { LocalEvent } from '../api/events';
import { isMailAvailable } from '../utils/mailConfig';
import { NewEventModal } from './NewEventModal';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getPrevisaoRevisao, CF_IDS } from '../utils/alerts';
import type { Issue } from '../types/redmine';
import type { CalendarEvent, InviteVerb, EventAttendees } from '../api/mail';

type DateField = 'due_date' | 'review';
type FieldMode = 'all' | DateField; // "Tudo" = prazo + previsão juntos
type ViewMode = 'month' | 'week';

// Uma ocorrência no calendário: uma tarefa numa data, por um campo específico.
// No modo "Tudo" a mesma tarefa pode gerar duas ocorrências (prazo e revisão).
type DayEntry = { issue: Issue; type: DateField };

const TYPE_META: Record<DateField, { label: string; icon: typeof Flag }> = {
  due_date: { label: 'Prazo', icon: Flag },
  review: { label: 'Previsão Revisão', icon: Eye },
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PRIORITY_DOT: Record<string, string> = {
  Imediata: 'bg-red-500',
  Urgente: 'bg-orange-500',
  Alta: 'bg-amber-500',
  Normal: 'bg-blue-400',
  Baixa: 'bg-slate-300',
};

const PRIORITY_ORDER: Record<string, number> = {
  Imediata: 0,
  Urgente: 1,
  Alta: 2,
  Normal: 3,
  Baixa: 4,
};

function isClosed(issue: Issue): boolean {
  const n = issue.status.name.toLowerCase();
  return n.includes('fechad') || n.includes('cancelad');
}

// Tarefas que não devem aparecer no backlog (nada acionável p/ agendar):
// fechadas, canceladas ou em "pendente fechamento".
function isBacklogExcluded(issue: Issue): boolean {
  return isClosed(issue) || issue.status.name.toLowerCase().includes('fechament');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}

// Abertas antes de concluídas; depois por prioridade
function compareIssues(a: Issue, b: Issue): number {
  const ca = isClosed(a) ? 1 : 0;
  const cb = isClosed(b) ? 1 : 0;
  if (ca !== cb) return ca - cb;
  return (PRIORITY_ORDER[a.priority.name] ?? 5) - (PRIORITY_ORDER[b.priority.name] ?? 5);
}

// Data escolhida da tarefa ('YYYY-MM-DD') ou '' se não tiver
function issueDate(issue: Issue, field: DateField): string {
  if (field === 'due_date') return issue.due_date ?? '';
  return getPrevisaoRevisao(issue);
}

// Aplica a nova data ao campo certo (para a atualização otimista do cache)
function withDate(issue: Issue, field: DateField, date: string): Issue {
  if (field === 'due_date') return { ...issue, due_date: date };
  const others = (issue.custom_fields ?? []).filter((cf) => cf.id !== CF_IDS.PREVISAO_REVISAO);
  return {
    ...issue,
    custom_fields: [
      ...others,
      { id: CF_IDS.PREVISAO_REVISAO, name: 'Previsão Revisão', value: date },
    ],
  };
}

/* ── Chip arrastável ── */
function IssueChip({
  issue,
  type,
  overdue,
  closed,
  showAssignee,
  showType,
  onIssueClick,
}: {
  issue: Issue;
  type: DateField;
  overdue: boolean;
  closed: boolean;
  showAssignee: boolean;
  showType: boolean;
  onIssueClick: (id: number) => void;
}) {
  // O id do arrastável carrega o tipo p/ que o drop atualize o campo certo.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${type}-${issue.id}`,
  });
  const TypeIcon = TYPE_META[type].icon;
  // Cor de fundo: atraso domina (vermelho); senão, tom por tipo (revisão = violeta).
  const bg = overdue
    ? 'bg-red-50 hover:bg-red-100'
    : type === 'review'
      ? 'bg-violet-50 hover:bg-violet-100'
      : 'bg-slate-50 hover:bg-blue-50';
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onIssueClick(issue.id)}
      title={`${TYPE_META[type].label} · #${issue.id} ${issue.subject} — ${issue.status.name}${issue.assigned_to ? ` · ${issue.assigned_to.name}` : ''}`}
      className={`group flex items-center gap-1 text-left rounded px-1 py-0.5 text-[11px] transition-colors cursor-grab active:cursor-grabbing touch-none select-none ${
        isDragging ? 'opacity-30' : ''
      } ${bg}`}
    >
      {showType && (
        <TypeIcon
          size={10}
          className={`flex-shrink-0 ${type === 'review' ? 'text-violet-500' : 'text-slate-400'}`}
        />
      )}
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${closed ? 'bg-slate-300' : (PRIORITY_DOT[issue.priority.name] ?? 'bg-slate-300')}`}
      />
      {showAssignee && issue.assigned_to && (
        <span
          className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[8px] font-bold flex items-center justify-center flex-shrink-0"
          title={issue.assigned_to.name}
        >
          {initials(issue.assigned_to.name)}
        </span>
      )}
      <span
        className={`truncate ${
          closed
            ? 'text-slate-400 line-through'
            : overdue
              ? 'text-red-600'
              : type === 'review'
                ? 'text-violet-700 group-hover:text-violet-800'
                : 'text-slate-600 group-hover:text-blue-700'
        }`}
      >
        {issue.subject}
      </span>
    </button>
  );
}

/* ── Chip de compromisso do Zimbra (read-only + responder convite) ── */
const PTST_BORDER: Record<string, string> = {
  AC: 'border-l-emerald-500', // aceito
  DE: 'border-l-red-400', // recusado
  TE: 'border-l-amber-400', // talvez
};

// Resposta de cada convidado (ptst do Zimbra) → rótulo + estilo do badge.
const PTST_BADGE: Record<string, { label: string; cls: string }> = {
  AC: {
    label: 'Aceitou',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  DE: { label: 'Recusou', cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
  TE: {
    label: 'Talvez',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  DG: {
    label: 'Delegou',
    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  },
  NE: {
    label: 'Sem resposta',
    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  },
};

const POPOVER_W = 288; // largura fixa do popover (w-72)

// Adapta um evento local ao formato CalendarEvent para reusar o EventChip.
function localToCalendarEvent(le: LocalEvent): CalendarEvent {
  return {
    id: le.id,
    invId: null,
    uid: null,
    compNum: 0,
    subject: le.subject,
    start: le.start,
    end: le.end,
    durationMs: le.end - le.start,
    allDay: le.allDay,
    location: le.location,
    status: 'CONF',
    ptst: 'AC',
    organizer: null,
    isOrganizer: true,
    snippet: le.description,
    local: true,
  };
}

function EventChip({ ev }: { ev: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const reply = useReplyToInvite();
  const del = useDeleteLocalEvent();
  // Eventos locais não têm convite/participantes no Zimbra: não busca attendees.
  const attendees = useEventAttendees(ev.id, open && !ev.local);

  // Posição fixa ancorada no chip — o popover vai no portal (document.body) para
  // escapar do overflow-hidden do card do calendário, e vira pra cima se faltar
  // espaço embaixo.
  const [coords, setCoords] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const m = 8; // margem da viewport
    const left = Math.min(Math.max(r.left, m), window.innerWidth - POPOVER_W - m);
    const below = window.innerHeight - r.bottom - m;
    const above = r.top - m;
    if (below >= 260 || below >= above) {
      setCoords({ left, top: r.bottom + 4, maxHeight: below - 4 });
    } else {
      setCoords({ left, bottom: window.innerHeight - r.top + 4, maxHeight: above - 4 });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const time = ev.allDay || ev.start == null ? 'Dia todo' : format(new Date(ev.start), 'HH:mm');
  const range =
    ev.start != null && ev.end != null && !ev.allDay
      ? `${format(new Date(ev.start), 'HH:mm')} – ${format(new Date(ev.end), 'HH:mm')}`
      : 'Dia todo';
  const canceled = ev.status === 'CANC';
  const verbToPtst: Record<InviteVerb, string> = { ACCEPT: 'AC', TENTATIVE: 'TE', DECLINE: 'DE' };

  // SendInviteReply do Zimbra usa o id da MENSAGEM do convite (invId), não o id do
  // item de calendário (ev.id) — usar ev.id dá "no such message" (mail.NO_SUCH_MSG).
  const doReply = (verb: InviteVerb) => {
    // Otimista: reflete a SUA resposta na lista de participantes na hora; o
    // refetch (invalidação no onSuccess) reconcilia com o servidor depois.
    qc.setQueryData<EventAttendees>(['zimbra-attendees', ev.id], (old) =>
      old
        ? {
            ...old,
            attendees: old.attendees.map((a) => (a.isMe ? { ...a, ptst: verbToPtst[verb] } : a)),
          }
        : old,
    );
    reply.mutate({ id: ev.invId ?? ev.id, verb, compNum: ev.compNum });
  };

  // Resposta atual: a do servidor (ev.ptst), mas reflete na hora a recém-enviada
  // (reply.variables) enquanto o refetch não chega; em caso de erro, volta para ev.ptst.
  const sentVerb = reply.variables?.verb;
  const currentPtst = !reply.isError && sentVerb ? verbToPtst[sentVerb] : ev.ptst;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title={`${time} · ${ev.subject}`}
        className={
          ev.local
            ? 'w-full flex items-center gap-1 text-left rounded px-1 py-0.5 text-[11px] bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border-l-2 border-l-indigo-400 transition-colors'
            : `w-full flex items-center gap-1 text-left rounded px-1 py-0.5 text-[11px] bg-teal-50 dark:bg-teal-900/30 hover:bg-teal-100 dark:hover:bg-teal-900/50 border-l-2 ${PTST_BORDER[ev.ptst] ?? 'border-l-teal-400'} transition-colors`
        }
      >
        {ev.local ? (
          <Video size={9} className="text-indigo-500 flex-shrink-0" />
        ) : (
          <Clock size={9} className="text-teal-500 flex-shrink-0" />
        )}
        {!ev.allDay && (
          <span
            className={`font-medium flex-shrink-0 ${ev.local ? 'text-indigo-600 dark:text-indigo-400' : 'text-teal-600 dark:text-teal-400'}`}
          >
            {time}
          </span>
        )}
        <span
          className={`truncate ${ev.local ? 'text-indigo-800 dark:text-indigo-200' : 'text-teal-800 dark:text-teal-200'} ${canceled ? 'line-through opacity-60' : ''}`}
        >
          {ev.subject}
        </span>
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              bottom: coords.bottom,
              width: POPOVER_W,
              maxHeight: coords.maxHeight,
            }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 p-3 text-left cursor-default overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">
                {ev.subject}
              </p>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-300 hover:text-slate-500 flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
            <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <p className="flex items-center gap-1.5">
                <Clock size={11} /> {range}
              </p>
              {ev.location && (
                <p className="flex items-center gap-1.5">
                  <MapPin size={11} /> {ev.location}
                </p>
              )}
              {ev.organizer && (
                <p className="flex items-center gap-1.5">
                  <User size={11} /> {ev.organizer.name}
                </p>
              )}
              {canceled && <p className="text-red-500 font-medium">Cancelado</p>}
            </div>

            {/* Participantes e a resposta de cada um (buscado sob demanda) — só Zimbra */}
            {!ev.local && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Users size={11} /> Participantes
                  {attendees.isLoading && <Loader2 size={10} className="animate-spin" />}
                </p>
                {attendees.data && attendees.data.attendees.length > 0 ? (
                  <ul className="space-y-1 max-h-44 overflow-y-auto scrollbar-thin">
                    {attendees.data.attendees.map((a) => {
                      const badge = PTST_BADGE[a.ptst] ?? PTST_BADGE.NE;
                      return (
                        <li key={a.address} className="flex items-center justify-between gap-2">
                          <span
                            className="truncate text-xs text-slate-600 dark:text-slate-300"
                            title={a.address}
                          >
                            {a.name}
                            {a.role === 'OPT' && (
                              <span className="text-slate-400"> · opcional</span>
                            )}
                          </span>
                          <span
                            className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : attendees.isLoading ? (
                  <p className="text-[11px] text-slate-400">Carregando…</p>
                ) : attendees.isError ? (
                  <p className="text-[11px] text-red-400">
                    Não foi possível carregar os participantes.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">Sem outros participantes.</p>
                )}
              </div>
            )}

            {/* Evento local: link da sala (se vídeo) + excluir */}
            {ev.local && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-2">
                {/^https?:\/\//.test(ev.location) && (
                  <a
                    href={ev.location}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white"
                  >
                    <Video size={12} /> Entrar na sala
                  </a>
                )}
                <button
                  onClick={() => del.mutate(ev.id, { onSuccess: () => setOpen(false) })}
                  disabled={del.isPending}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md border border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-60"
                >
                  {del.isPending ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                  Excluir
                </button>
              </div>
            )}

            {!ev.local && !ev.isOrganizer && !canceled && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                  {currentPtst === 'AC'
                    ? 'Você aceitou — clique para alterar'
                    : currentPtst === 'DE'
                      ? 'Você recusou — clique para alterar'
                      : currentPtst === 'TE'
                        ? 'Você respondeu talvez — clique para alterar'
                        : 'Responder convite'}
                </p>
                <div className="flex gap-1.5">
                  {(
                    [
                      ['ACCEPT', 'Aceitar', 'emerald'],
                      ['TENTATIVE', 'Talvez', 'amber'],
                      ['DECLINE', 'Recusar', 'red'],
                    ] as const
                  ).map(([verb, label, color]) => {
                    const selected = verbToPtst[verb] === currentPtst;
                    const sending = reply.isPending && sentVerb === verb;
                    const palette =
                      color === 'emerald'
                        ? {
                            sel: 'bg-emerald-500 border-emerald-500 text-white',
                            out: 'border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30',
                          }
                        : color === 'amber'
                          ? {
                              sel: 'bg-amber-500 border-amber-500 text-white',
                              out: 'border-amber-200 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30',
                            }
                          : {
                              sel: 'bg-red-500 border-red-500 text-white',
                              out: 'border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30',
                            };
                    return (
                      <button
                        key={verb}
                        onClick={() => doReply(verb)}
                        disabled={reply.isPending || selected}
                        className={`flex-1 flex items-center justify-center gap-1 text-xs font-medium px-2 py-1 rounded-md border transition-colors disabled:opacity-60
                        ${selected ? palette.sel : palette.out}`}
                      >
                        {sending ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : selected ? (
                          <Check size={11} />
                        ) : null}
                        {label}
                      </button>
                    );
                  })}
                </div>
                {reply.isError && (
                  <p className="text-[11px] text-red-500 mt-1.5">
                    Falha ao responder. Tente novamente.
                  </p>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ── Célula do dia (droppable) ── */
function DayCell({
  dayStr,
  className,
  children,
}: {
  dayStr: string;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayStr}` });
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isOver ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/70' : ''}`}
    >
      {children}
    </div>
  );
}

/* ── Seletor de pessoa (Eu + qualquer membro) ── */
function PersonSelect({
  members,
  value,
  onChange,
}: {
  members: { id: number; name: string }[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = value == null ? null : members.find((m) => m.id === value);
  const filtered = members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setSearch('');
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 min-w-40 max-w-56"
      >
        <User size={13} className="text-slate-400 flex-shrink-0" />
        <span className="truncate flex-1 text-left">
          {current ? current.name : 'Minhas tarefas'}
        </span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 w-60 flex flex-col"
          style={{ maxHeight: 320 }}
        >
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pessoa..."
                className="w-full text-xs border border-slate-200 rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin py-1">
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${value == null ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
            >
              <span>Minhas tarefas</span>
              {value == null && <Check size={12} className="flex-shrink-0" />}
            </button>
            <div className="border-t border-slate-100 my-1" />
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${m.id === value ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
              >
                <span className="truncate">{m.name}</span>
                {m.id === value && <Check size={12} className="flex-shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">Nenhuma pessoa</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Chip do backlog (sem data) ── */
function BacklogChip({
  issue,
  type,
  showAssignee,
  onIssueClick,
}: {
  issue: Issue;
  type: DateField;
  showAssignee: boolean;
  onIssueClick: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `backlog-${type}-${issue.id}`,
  });
  const closed = isClosed(issue);
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onIssueClick(issue.id)}
      title={`#${issue.id} ${issue.subject} — ${issue.status.name}${issue.assigned_to ? ` · ${issue.assigned_to.name}` : ''}`}
      className={`group w-full flex items-center gap-1.5 text-left rounded-md px-2 py-1 text-[11px] bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-grab active:cursor-grabbing touch-none select-none ${
        isDragging ? 'opacity-30' : ''
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${closed ? 'bg-slate-300' : (PRIORITY_DOT[issue.priority.name] ?? 'bg-slate-300')}`}
      />
      {showAssignee && issue.assigned_to && (
        <span
          className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[8px] font-bold flex items-center justify-center flex-shrink-0"
          title={issue.assigned_to.name}
        >
          {initials(issue.assigned_to.name)}
        </span>
      )}
      <span
        className={`truncate ${closed ? 'text-slate-400 line-through' : 'text-slate-600 group-hover:text-blue-700'}`}
      >
        {issue.subject}
      </span>
    </button>
  );
}

/* ── Painel de backlog (tarefas sem data) — arraste p/ um dia para agendar ── */
function BacklogPanel({
  issues,
  mode,
  scheduleAs,
  onScheduleAs,
  backlogType,
  showAssignee,
  onIssueClick,
  onClose,
}: {
  issues: Issue[];
  mode: FieldMode;
  scheduleAs: DateField;
  onScheduleAs: (f: DateField) => void;
  backlogType: DateField;
  showAssignee: boolean;
  onIssueClick: (id: number) => void;
  onClose: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'backlog-drop' });
  return (
    <div className="w-full h-full min-h-0 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          Sem data <span className="text-slate-400 dark:text-slate-500">({issues.length})</span>
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          title="Ocultar backlog"
        >
          <X size={13} />
        </button>
      </div>

      {/* No modo "Tudo", escolha o campo que o item recebe ao ser agendado */}
      {mode === 'all' && (
        <div className="px-2.5 py-2 border-b border-slate-100">
          <p className="text-[10px] text-slate-400 mb-1">Agendar como</p>
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-[11px] font-medium">
            <button
              onClick={() => onScheduleAs('due_date')}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md transition-all ${scheduleAs === 'due_date' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
            >
              <Flag size={10} /> Prazo
            </button>
            <button
              onClick={() => onScheduleAs('review')}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md transition-all ${scheduleAs === 'review' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
            >
              <Eye size={10} /> Revisão
            </button>
          </div>
        </div>
      )}

      <div
        ref={setNodeRef}
        className={`flex-1 min-h-0 overflow-y-auto scrollbar-thin p-1.5 flex flex-col gap-1 transition-colors ${isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''}`}
      >
        {issues.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 py-8 px-2">
            <CalendarDays size={22} className="mb-1.5 opacity-30" />
            <p className="text-[11px]">
              Tudo agendado!{isOver ? '' : ' Arraste um cartão aqui para remover a data.'}
            </p>
          </div>
        ) : (
          issues.map((i) => (
            <BacklogChip
              key={i.id}
              issue={i}
              type={backlogType}
              showAssignee={showAssignee}
              onIssueClick={onIssueClick}
            />
          ))
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-slate-100 text-[10px] text-slate-400 leading-snug">
        Arraste para um dia para agendar · de volta aqui para remover a data.
      </div>
    </div>
  );
}

/* ── Menu de filtros ── */
function FilterMenu({
  projectOptions,
  priorityOptions,
  hideClosed,
  setHideClosed,
  priorityFilter,
  setPriorityFilter,
  projectFilter,
  setProjectFilter,
  activeCount,
}: {
  projectOptions: { id: number; name: string }[];
  priorityOptions: string[];
  hideClosed: boolean;
  setHideClosed: (v: boolean) => void;
  priorityFilter: Set<string>;
  setPriorityFilter: (s: Set<string>) => void;
  projectFilter: number | null;
  setProjectFilter: (v: number | null) => void;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const togglePriority = (p: string) => {
    const next = new Set(priorityFilter);
    next.has(p) ? next.delete(p) : next.add(p);
    setPriorityFilter(next);
  };
  const clearAll = () => {
    setHideClosed(false);
    setPriorityFilter(new Set());
    setProjectFilter(null);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
          activeCount > 0
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        <Filter size={13} /> Filtros
        {activeCount > 0 && (
          <span className="bg-blue-600 text-white rounded-full text-[9px] font-bold w-4 h-4 flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-30 p-3 space-y-3">
          {projectOptions.length > 1 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">Projeto</p>
              <select
                value={projectFilter ?? ''}
                onChange={(e) => setProjectFilter(e.target.value ? Number(e.target.value) : null)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              >
                <option value="">Todos os projetos</option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {priorityOptions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Prioridade</p>
              <div className="flex flex-wrap gap-1.5">
                {priorityOptions.map((p) => {
                  const on = priorityFilter.has(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePriority(p)}
                      className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-colors ${
                        on
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[p] ?? 'bg-slate-300'}`}
                      />
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-400"
            />
            Ocultar concluídas
          </label>

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="w-full text-xs text-slate-500 hover:text-red-600 border-t border-slate-100 pt-2 mt-1"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  projectId?: number;
  onIssueClick: (id: number) => void;
}

export function CalendarView({ projectId, onIssueClick }: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [field, setField] = useState<FieldMode>('all'); // visão unificada por padrão
  const [view, setView] = useState<ViewMode>('month');
  const [personId, setPersonId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{ issue: Issue; type: DateField } | null>(null);
  const [showEvents, setShowEvents] = useState(true);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const mailOn = isMailAvailable();

  // Backlog (tarefas sem data) — arraste para um dia para agendar.
  const [showBacklog, setShowBacklog] = useState(true);
  // No modo "Tudo", define qual campo o item do backlog recebe ao ser agendado.
  const [scheduleAs, setScheduleAs] = useState<DateField>('due_date');

  // Filtros
  const [hideClosed, setHideClosed] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<number | null>(null);

  const updateIssue = useUpdateIssue();
  const qc = useQueryClient();
  const { data: members } = useAllMembers(true);

  // Fonte de dados: minhas tarefas (status *) ou as de uma pessoa (abertas)
  const myQuery = useIssues(projectId);
  const personQuery = useUserIssues(personId ?? undefined);
  const active = personId == null ? myQuery : personQuery;
  const issues = active.data;
  const { isLoading, isFetching, refetch } = active;
  const activeKey: QueryKey = personId == null ? ['issues', projectId] : ['issues-user', personId];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const toggleExpand = (d: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  // Dias do grid
  const days = useMemo(() => {
    if (view === 'week') {
      return eachDayOfInterval({
        start: startOfWeek(cursor, { weekStartsOn: 0 }),
        end: endOfWeek(cursor, { weekStartsOn: 0 }),
      });
    }
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }),
    });
  }, [cursor, view]);

  const rangeStart = format(days[0], 'yyyy-MM-dd');
  const rangeEnd = format(days[days.length - 1], 'yyyy-MM-dd');

  // Agenda Zimbra na janela visível (epoch ms: início do 1º dia → fim do último).
  const winStart = days[0].getTime();
  const winEnd = days[days.length - 1].getTime() + 86_400_000;
  const eventsQuery = useZimbraEvents(winStart, winEnd);
  // Eventos/reuniões locais (store por-usuário, independem do Zimbra).
  const localEventsQuery = useLocalEvents(winStart, winEnd);
  const byEvent = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const push = (ev: CalendarEvent) => {
      if (ev.start == null) return;
      const d = format(new Date(ev.start), 'yyyy-MM-dd');
      const arr = map.get(d);
      if (arr) arr.push(ev);
      else map.set(d, [ev]);
    };
    // Agenda Zimbra respeita o toggle "Agenda"; eventos locais sempre aparecem.
    if (showEvents) (eventsQuery.data ?? []).forEach(push);
    (localEventsQuery.data ?? []).forEach((le) => push(localToCalendarEvent(le)));
    return map;
  }, [eventsQuery.data, localEventsQuery.data, showEvents]);

  // Campos ativos: "Tudo" → prazo + revisão; senão só o escolhido.
  const activeFields: DateField[] = useMemo(
    () => (field === 'all' ? ['due_date', 'review'] : [field]),
    [field],
  );

  // Campo que um item do backlog recebe ao ser agendado.
  const backlogType: DateField = field === 'all' ? scheduleAs : field;

  // Opções de filtro derivadas das tarefas carregadas
  const projectOptions = useMemo(() => {
    const m = new Map<number, string>();
    (issues ?? []).forEach((i) => m.set(i.project.id, i.project.name));
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);
  const priorityOptions = useMemo(() => {
    const present = new Set((issues ?? []).map((i) => i.priority.name));
    return Object.keys(PRIORITY_ORDER).filter((p) => present.has(p));
  }, [issues]);
  const activeFilterCount =
    (hideClosed ? 1 : 0) + (priorityFilter.size > 0 ? 1 : 0) + (projectFilter != null ? 1 : 0);

  // Aplica os filtros (somente visual — não afeta o cache)
  const filteredIssues = useMemo(
    () =>
      (issues ?? []).filter((i) => {
        if (hideClosed && isClosed(i)) return false;
        if (priorityFilter.size > 0 && !priorityFilter.has(i.priority.name)) return false;
        if (projectFilter != null && i.project.id !== projectFilter) return false;
        return true;
      }),
    [issues, hideClosed, priorityFilter, projectFilter],
  );

  // Agrupa ocorrências (tarefa × campo) por dia, ordenadas dentro do dia
  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    filteredIssues.forEach((i) => {
      activeFields.forEach((f) => {
        const d = issueDate(i, f);
        if (!d) return;
        const entry: DayEntry = { issue: i, type: f };
        const arr = map.get(d);
        if (arr) arr.push(entry);
        else map.set(d, [entry]);
      });
    });
    map.forEach((arr) => arr.sort((a, b) => compareIssues(a.issue, b.issue)));
    return map;
  }, [filteredIssues, activeFields]);

  // Backlog: tarefas (filtradas) sem nenhuma das datas ativas, exceto as
  // fechadas/canceladas/"pendente fechamento" (não há o que agendar nelas).
  const backlogIssues = useMemo(
    () =>
      filteredIssues
        .filter((i) => !isBacklogExcluded(i) && activeFields.every((f) => !issueDate(i, f)))
        .sort(compareIssues),
    [filteredIssues, activeFields],
  );

  const scheduledCount = useMemo(
    () => filteredIssues.filter((i) => activeFields.some((f) => issueDate(i, f))).length,
    [filteredIssues, activeFields],
  );
  // Ocorrências no período visível (mês ou semana)
  const periodCount = useMemo(() => {
    let n = 0;
    byDay.forEach((arr, d) => {
      if (d >= rangeStart && d <= rangeEnd) n += arr.length;
    });
    return n;
  }, [byDay, rangeStart, rangeEnd]);

  // Grava a nova data no campo correto (type), com atualização otimista do cache
  const reschedule = (issue: Issue, newDate: string, type: DateField) => {
    qc.setQueryData<Issue[]>(activeKey, (old) =>
      old ? old.map((i) => (i.id === issue.id ? withDate(i, type, newDate) : i)) : old,
    );

    const fields =
      type === 'due_date'
        ? { due_date: newDate }
        : { custom_fields: [{ id: CF_IDS.PREVISAO_REVISAO, value: newDate }] };

    updateIssue.mutate(
      { id: issue.id, fields },
      {
        onSettled: () => qc.invalidateQueries({ queryKey: activeKey }),
      },
    );
  };

  // id arrastável: `chip-<tipo>-<id>` (já agendado) ou `backlog-<tipo>-<id>` (sem data)
  const parseDragId = (raw: string): { id: number; type: DateField } | null => {
    const m = raw.match(/^(?:chip|backlog)-(due_date|review)-(\d+)$/);
    return m ? { type: m[1] as DateField, id: parseInt(m[2]) } : null;
  };

  const handleDragStart = ({ active: a }: DragStartEvent) => {
    const parsed = parseDragId(String(a.id));
    const issue = parsed && issues?.find((i) => i.id === parsed.id);
    setDragging(issue && parsed ? { issue, type: parsed.type } : null);
  };

  const handleDragEnd = ({ active: a, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const parsed = parseDragId(String(a.id));
    if (!parsed) return;
    const overId = String(over.id);
    // Soltar num dia → agenda/reagenda; soltar no backlog → limpa a data.
    const newDate = overId.startsWith('day-')
      ? overId.slice(4)
      : overId === 'backlog-drop'
        ? ''
        : null;
    if (newDate === null) return;
    const issue = issues?.find((i) => i.id === parsed.id);
    if (!issue || issueDate(issue, parsed.type) === newDate) return;
    reschedule(issue, newDate, parsed.type);
  };

  const headerLabel =
    view === 'week'
      ? `${format(days[0], 'd')} – ${format(days[6], "d 'de' MMM", { locale: ptBR })}`
      : format(cursor, "MMMM 'de' yyyy", { locale: ptBR });

  const shift = (dir: 1 | -1) =>
    setCursor((c) => (view === 'week' ? addWeeks(c, dir) : addMonths(c, dir)));

  const weekMode = view === 'week';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Calendário</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {personId == null ? 'Suas tarefas' : 'Tarefas da pessoa'} por{' '}
            {field === 'all'
              ? 'prazo e previsão de revisão'
              : field === 'due_date'
                ? 'prazo'
                : 'previsão de revisão'}
            <span className="text-slate-400"> · arraste para reagendar</span>.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-3">
          <PersonSelect
            members={members ?? []}
            value={personId}
            onChange={(v) => {
              setPersonId(v);
              setExpanded(new Set());
            }}
          />

          {/* Mês / Semana */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setView('month')}
              className={`px-2.5 py-1.5 rounded-md transition-all ${view === 'month' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Mês
            </button>
            <button
              onClick={() => setView('week')}
              className={`px-2.5 py-1.5 rounded-md transition-all ${view === 'week' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Semana
            </button>
          </div>

          {/* Tudo / Prazo / Previsão */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setField('all')}
              className={`px-2.5 py-1.5 rounded-md transition-all ${field === 'all' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}`}
            >
              Tudo
            </button>
            <button
              onClick={() => setField('due_date')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md transition-all ${field === 'due_date' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}`}
            >
              <Flag size={11} className="text-slate-400 dark:text-slate-500" /> Prazo
            </button>
            <button
              onClick={() => setField('review')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md transition-all ${field === 'review' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}`}
            >
              <Eye size={11} className="text-violet-400 dark:text-violet-500" /> Previsão Revisão
            </button>
          </div>

          <FilterMenu
            projectOptions={projectOptions}
            priorityOptions={priorityOptions}
            hideClosed={hideClosed}
            setHideClosed={setHideClosed}
            priorityFilter={priorityFilter}
            setPriorityFilter={setPriorityFilter}
            projectFilter={projectFilter}
            setProjectFilter={setProjectFilter}
            activeCount={activeFilterCount}
          />

          {/* Backlog (tarefas sem data) */}
          <button
            onClick={() => setShowBacklog((v) => !v)}
            title={showBacklog ? 'Ocultar tarefas sem data' : 'Mostrar tarefas sem data'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showBacklog
                ? 'border-blue-300 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Inbox size={13} /> Sem data
            {backlogIssues.length > 0 && (
              <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full text-[9px] font-bold px-1.5 min-w-4 h-4 flex items-center justify-center">
                {backlogIssues.length}
              </span>
            )}
          </button>

          {/* Agenda Zimbra (só quando o e-mail está disponível) */}
          {mailOn && (
            <button
              onClick={() => setShowEvents((v) => !v)}
              title={showEvents ? 'Ocultar agenda do e-mail' : 'Mostrar agenda do e-mail'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showEvents
                  ? 'border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {eventsQuery.isFetching ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Clock size={13} />
              )}
              Agenda
            </button>
          )}

          {/* Nova reunião — Zimbra + Jitsi quando há e-mail; senão, evento local */}
          <button
            onClick={() => setShowNewEvent(true)}
            title="Criar reunião no calendário"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-teal-600 bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            <Plus size={13} /> Nova reunião
          </button>
        </div>
      </div>

      {showNewEvent && <NewEventModal onClose={() => setShowNewEvent(false)} />}

      {/* Barra de navegação */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => shift(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            title={weekMode ? 'Semana anterior' : 'Mês anterior'}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-slate-800 capitalize min-w-44 text-center">
            {headerLabel}
          </span>
          <button
            onClick={() => shift(1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            title={weekMode ? 'Próxima semana' : 'Próximo mês'}
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="ml-1 text-xs font-medium text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg"
          >
            Hoje
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {updateIssue.isPending && (
            <span className="flex items-center gap-1 text-blue-500">
              <Loader2 size={12} className="animate-spin" /> salvando…
            </span>
          )}
          <span>
            {periodCount} {weekMode ? 'nesta semana' : 'neste mês'}
          </span>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Atualizar"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="relative">
            <div
              className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${showBacklog ? 'mr-[252px]' : ''}`}
            >
              {/* Cabeçalho dos dias da semana */}
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-center"
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* Células dos dias */}
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const inMonth = weekMode || isSameMonth(day, cursor);
                  const isToday = isSameDay(day, new Date());
                  const weekend = day.getDay() === 0 || day.getDay() === 6;
                  const dayIssues = byDay.get(dayStr) ?? [];
                  const showAll = weekMode || expanded.has(dayStr);
                  const visible = showAll ? dayIssues : dayIssues.slice(0, 3);

                  return (
                    <DayCell
                      key={dayStr}
                      dayStr={dayStr}
                      className={`${weekMode ? 'min-h-[26rem]' : 'min-h-28'} border-b border-r border-slate-100 p-1.5 flex flex-col gap-1 ${
                        !inMonth ? 'bg-slate-50/60' : weekend ? 'bg-slate-50/40' : 'bg-white'
                      }`}
                    >
                      <div className="flex justify-end">
                        <span
                          className={`text-xs w-5 h-5 flex items-center justify-center rounded-full ${
                            isToday
                              ? 'bg-blue-600 text-white font-bold'
                              : inMonth
                                ? 'text-slate-600'
                                : 'text-slate-300'
                          }`}
                        >
                          {format(day, 'd')}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1">
                        {(byEvent.get(dayStr) ?? []).map((ev) => (
                          <EventChip key={`${ev.id}-${ev.start}`} ev={ev} />
                        ))}
                        {visible.map(({ issue, type }) => {
                          const closed = isClosed(issue);
                          const overdue = !closed && dayStr < todayStr;
                          return (
                            <IssueChip
                              key={`${type}-${issue.id}`}
                              issue={issue}
                              type={type}
                              overdue={overdue}
                              closed={closed}
                              showAssignee={personId != null}
                              showType={field === 'all'}
                              onIssueClick={onIssueClick}
                            />
                          );
                        })}
                        {!weekMode && dayIssues.length > 3 && (
                          <button
                            onClick={() => toggleExpand(dayStr)}
                            className="text-[10px] text-slate-400 hover:text-blue-600 px-1 text-left"
                          >
                            {expanded.has(dayStr)
                              ? 'mostrar menos'
                              : `+${dayIssues.length - 3} mais`}
                          </button>
                        )}
                      </div>
                    </DayCell>
                  );
                })}
              </div>

              {/* Legenda */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-900/50 text-[11px] text-slate-500 dark:text-slate-400">
                {field === 'all' && (
                  <>
                    <span className="flex items-center gap-1">
                      <Flag size={11} className="text-slate-400 dark:text-slate-500" />
                      Prazo
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye size={11} className="text-violet-500 dark:text-violet-400" />
                      Previsão Revisão
                    </span>
                    <span className="text-slate-200 dark:text-slate-700">|</span>
                  </>
                )}
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  Imediata
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  Urgente
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Alta
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  Normal
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                  Baixa
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <span className="text-red-600 dark:text-red-400">atrasada</span>
                  <span className="text-slate-400 dark:text-slate-500 line-through">concluída</span>
                </span>
              </div>
            </div>

            {showBacklog && (
              <div className="absolute top-0 right-0 bottom-0 w-60">
                <BacklogPanel
                  issues={backlogIssues}
                  mode={field}
                  scheduleAs={scheduleAs}
                  onScheduleAs={setScheduleAs}
                  backlogType={backlogType}
                  showAssignee={personId != null}
                  onIssueClick={onIssueClick}
                  onClose={() => setShowBacklog(false)}
                />
              </div>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {dragging &&
              (() => {
                const TypeIcon = TYPE_META[dragging.type].icon;
                return (
                  <div
                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] bg-white shadow-lg border ${dragging.type === 'review' ? 'border-violet-200' : 'border-blue-200'}`}
                  >
                    <TypeIcon
                      size={10}
                      className={dragging.type === 'review' ? 'text-violet-500' : 'text-slate-400'}
                    />
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[dragging.issue.priority.name] ?? 'bg-slate-300'}`}
                    />
                    <span className="truncate max-w-40 text-slate-700">
                      {dragging.issue.subject}
                    </span>
                  </div>
                );
              })()}
          </DragOverlay>
        </DndContext>
      )}

      {!isLoading && scheduledCount === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <CalendarDays size={28} className="mb-2 opacity-30" />
          <p className="text-sm">
            Nenhuma tarefa com{' '}
            {field === 'all'
              ? 'prazo ou previsão de revisão'
              : field === 'due_date'
                ? 'prazo'
                : 'previsão de revisão'}{' '}
            definido.
          </p>
        </div>
      )}
    </div>
  );
}
