import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, addWeeks, isSameMonth, isSameDay, format,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, ChevronDown, RefreshCw, CalendarDays, Loader2, User, Search, Check, Clock, MapPin, X } from 'lucide-react';
import { useIssues, useUserIssues, useAllMembers, useUpdateIssue } from '../hooks/useRedmine';
import { useZimbraEvents, useReplyToInvite } from '../hooks/useZimbraEvents';
import { isMailAvailable } from '../utils/mailConfig';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getPrevisaoRevisao, CF_IDS } from '../utils/alerts';
import type { Issue } from '../types/redmine';
import type { CalendarEvent, InviteVerb } from '../api/mail';

type DateField = 'due_date' | 'review';
type ViewMode = 'month' | 'week';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PRIORITY_DOT: Record<string, string> = {
  Imediata: 'bg-red-500',
  Urgente: 'bg-orange-500',
  Alta: 'bg-amber-500',
  Normal: 'bg-blue-400',
  Baixa: 'bg-slate-300',
};

const PRIORITY_ORDER: Record<string, number> = {
  Imediata: 0, Urgente: 1, Alta: 2, Normal: 3, Baixa: 4,
};

function isClosed(issue: Issue): boolean {
  const n = issue.status.name.toLowerCase();
  return n.includes('fechad') || n.includes('cancelad');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
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
  const others = (issue.custom_fields ?? []).filter(cf => cf.id !== CF_IDS.PREVISAO_REVISAO);
  return { ...issue, custom_fields: [...others, { id: CF_IDS.PREVISAO_REVISAO, name: 'Previsão Revisão', value: date }] };
}

/* ── Chip arrastável ── */
function IssueChip({ issue, overdue, closed, showAssignee, onIssueClick }: {
  issue: Issue; overdue: boolean; closed: boolean; showAssignee: boolean; onIssueClick: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `chip-${issue.id}` });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onIssueClick(issue.id)}
      title={`#${issue.id} ${issue.subject} — ${issue.status.name}${issue.assigned_to ? ` · ${issue.assigned_to.name}` : ''}`}
      className={`group flex items-center gap-1 text-left rounded px-1 py-0.5 text-[11px] transition-colors cursor-grab active:cursor-grabbing touch-none select-none ${
        isDragging ? 'opacity-30' : ''
      } ${overdue ? 'bg-red-50 hover:bg-red-100' : 'bg-slate-50 hover:bg-blue-50'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${closed ? 'bg-slate-300' : PRIORITY_DOT[issue.priority.name] ?? 'bg-slate-300'}`} />
      {showAssignee && issue.assigned_to && (
        <span
          className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[8px] font-bold flex items-center justify-center flex-shrink-0"
          title={issue.assigned_to.name}
        >
          {initials(issue.assigned_to.name)}
        </span>
      )}
      <span className={`truncate ${
        closed ? 'text-slate-400 line-through'
          : overdue ? 'text-red-600'
          : 'text-slate-600 group-hover:text-blue-700'
      }`}>
        {issue.subject}
      </span>
    </button>
  );
}

/* ── Chip de compromisso do Zimbra (read-only + responder convite) ── */
const PTST_BORDER: Record<string, string> = {
  AC: 'border-l-emerald-500',  // aceito
  DE: 'border-l-red-400',      // recusado
  TE: 'border-l-amber-400',    // talvez
};

function EventChip({ ev }: { ev: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reply = useReplyToInvite();

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const time = ev.allDay || ev.start == null ? 'Dia todo' : format(new Date(ev.start), 'HH:mm');
  const range = ev.start != null && ev.end != null && !ev.allDay
    ? `${format(new Date(ev.start), 'HH:mm')} – ${format(new Date(ev.end), 'HH:mm')}`
    : 'Dia todo';
  const canceled = ev.status === 'CANC';
  // SendInviteReply do Zimbra usa o id da MENSAGEM do convite (invId), não o id do
  // item de calendário (ev.id) — usar ev.id dá "no such message" (mail.NO_SUCH_MSG).
  const doReply = (verb: InviteVerb) => reply.mutate({ id: ev.invId ?? ev.id, verb, compNum: ev.compNum });

  // Resposta atual: a do servidor (ev.ptst), mas reflete na hora a recém-enviada
  // (reply.variables) enquanto o refetch não chega; em caso de erro, volta para ev.ptst.
  const verbToPtst: Record<InviteVerb, string> = { ACCEPT: 'AC', TENTATIVE: 'TE', DECLINE: 'DE' };
  const sentVerb = reply.variables?.verb;
  const currentPtst = !reply.isError && sentVerb ? verbToPtst[sentVerb] : ev.ptst;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={`${time} · ${ev.subject}`}
        className={`w-full flex items-center gap-1 text-left rounded px-1 py-0.5 text-[11px] bg-teal-50 dark:bg-teal-900/30 hover:bg-teal-100 dark:hover:bg-teal-900/50 border-l-2 ${PTST_BORDER[ev.ptst] ?? 'border-l-teal-400'} transition-colors`}
      >
        <Clock size={9} className="text-teal-500 flex-shrink-0" />
        {!ev.allDay && <span className="text-teal-600 dark:text-teal-400 font-medium flex-shrink-0">{time}</span>}
        <span className={`truncate text-teal-800 dark:text-teal-200 ${canceled ? 'line-through opacity-60' : ''}`}>{ev.subject}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-40 p-3 text-left cursor-default" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">{ev.subject}</p>
            <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 flex-shrink-0"><X size={13} /></button>
          </div>
          <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
            <p className="flex items-center gap-1.5"><Clock size={11} /> {range}</p>
            {ev.location && <p className="flex items-center gap-1.5"><MapPin size={11} /> {ev.location}</p>}
            {ev.organizer && <p className="flex items-center gap-1.5"><User size={11} /> {ev.organizer.name}</p>}
            {canceled && <p className="text-red-500 font-medium">Cancelado</p>}
          </div>

          {!ev.isOrganizer && !canceled && (
            <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                {currentPtst === 'AC' ? 'Você aceitou — clique para alterar'
                  : currentPtst === 'DE' ? 'Você recusou — clique para alterar'
                  : currentPtst === 'TE' ? 'Você respondeu talvez — clique para alterar'
                  : 'Responder convite'}
              </p>
              <div className="flex gap-1.5">
                {([['ACCEPT', 'Aceitar', 'emerald'], ['TENTATIVE', 'Talvez', 'amber'], ['DECLINE', 'Recusar', 'red']] as const).map(([verb, label, color]) => {
                  const selected = verbToPtst[verb] === currentPtst;
                  const sending = reply.isPending && sentVerb === verb;
                  const palette = color === 'emerald'
                    ? { sel: 'bg-emerald-500 border-emerald-500 text-white', out: 'border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' }
                    : color === 'amber'
                    ? { sel: 'bg-amber-500 border-amber-500 text-white', out: 'border-amber-200 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30' }
                    : { sel: 'bg-red-500 border-red-500 text-white', out: 'border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30' };
                  return (
                    <button
                      key={verb}
                      onClick={() => doReply(verb)}
                      disabled={reply.isPending || selected}
                      className={`flex-1 flex items-center justify-center gap-1 text-xs font-medium px-2 py-1 rounded-md border transition-colors disabled:opacity-60
                        ${selected ? palette.sel : palette.out}`}
                    >
                      {sending ? <Loader2 size={11} className="animate-spin" /> : selected ? <Check size={11} /> : null}
                      {label}
                    </button>
                  );
                })}
              </div>
              {reply.isError && <p className="text-[11px] text-red-500 mt-1.5">Falha ao responder. Tente novamente.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Célula do dia (droppable) ── */
function DayCell({ dayStr, className, children }: {
  dayStr: string; className: string; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayStr}` });
  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/70' : ''}`}>
      {children}
    </div>
  );
}

/* ── Seletor de pessoa (Eu + qualquer membro) ── */
function PersonSelect({ members, value, onChange }: {
  members: { id: number; name: string }[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = value == null ? null : members.find(m => m.id === value);
  const filtered = members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setSearch(''); setOpen(v => !v); }}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 min-w-40 max-w-56"
      >
        <User size={13} className="text-slate-400 flex-shrink-0" />
        <span className="truncate flex-1 text-left">{current ? current.name : 'Minhas tarefas'}</span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 w-60 flex flex-col" style={{ maxHeight: 320 }}>
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar pessoa..."
                className="w-full text-xs border border-slate-200 rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin py-1">
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${value == null ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
            >
              <span>Minhas tarefas</span>
              {value == null && <Check size={12} className="flex-shrink-0" />}
            </button>
            <div className="border-t border-slate-100 my-1" />
            {filtered.map(m => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${m.id === value ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
              >
                <span className="truncate">{m.name}</span>
                {m.id === value && <Check size={12} className="flex-shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Nenhuma pessoa</p>}
          </div>
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
  const [field, setField] = useState<DateField>('due_date');
  const [view, setView] = useState<ViewMode>('month');
  const [personId, setPersonId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [showEvents, setShowEvents] = useState(true);
  const mailOn = isMailAvailable();

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const toggleExpand = (d: string) =>
    setExpanded(prev => {
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
  const eventsQuery = useZimbraEvents(days[0].getTime(), days[days.length - 1].getTime() + 86_400_000);
  const byEvent = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    if (!showEvents) return map;
    (eventsQuery.data ?? []).forEach(ev => {
      if (ev.start == null) return;
      const d = format(new Date(ev.start), 'yyyy-MM-dd');
      const arr = map.get(d);
      if (arr) arr.push(ev); else map.set(d, [ev]);
    });
    return map;
  }, [eventsQuery.data, showEvents]);

  // Agrupa por dia, ordenado dentro do dia
  const byDay = useMemo(() => {
    const map = new Map<string, Issue[]>();
    (issues ?? []).forEach(i => {
      const d = issueDate(i, field);
      if (!d) return;
      const arr = map.get(d);
      if (arr) arr.push(i); else map.set(d, [i]);
    });
    map.forEach(arr => arr.sort(compareIssues));
    return map;
  }, [issues, field]);

  const scheduledCount = useMemo(
    () => (issues ?? []).filter(i => issueDate(i, field)).length,
    [issues, field]
  );
  // Tarefas no período visível (mês ou semana)
  const periodCount = useMemo(
    () => (issues ?? []).filter(i => {
      const d = issueDate(i, field);
      return d && d >= rangeStart && d <= rangeEnd;
    }).length,
    [issues, field, rangeStart, rangeEnd]
  );

  // Grava a nova data, com atualização otimista do cache ativo
  const reschedule = (issue: Issue, newDate: string) => {
    qc.setQueryData<Issue[]>(activeKey, old =>
      old ? old.map(i => (i.id === issue.id ? withDate(i, field, newDate) : i)) : old);

    const fields = field === 'due_date'
      ? { due_date: newDate }
      : { custom_fields: [{ id: CF_IDS.PREVISAO_REVISAO, value: newDate }] };

    updateIssue.mutate({ id: issue.id, fields }, {
      onSettled: () => qc.invalidateQueries({ queryKey: activeKey }),
    });
  };

  const handleDragStart = ({ active: a }: DragStartEvent) => {
    const id = parseInt(String(a.id).replace('chip-', ''));
    setActiveIssue(issues?.find(i => i.id === id) ?? null);
  };

  const handleDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActiveIssue(null);
    if (!over) return;
    const id = parseInt(String(a.id).replace('chip-', ''));
    const newDate = String(over.id).replace('day-', '');
    const issue = issues?.find(i => i.id === id);
    if (!issue || issueDate(issue, field) === newDate) return;
    reschedule(issue, newDate);
  };

  const headerLabel = view === 'week'
    ? `${format(days[0], 'd')} – ${format(days[6], "d 'de' MMM", { locale: ptBR })}`
    : format(cursor, "MMMM 'de' yyyy", { locale: ptBR });

  const shift = (dir: 1 | -1) =>
    setCursor(c => (view === 'week' ? addWeeks(c, dir) : addMonths(c, dir)));

  const weekMode = view === 'week';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Calendário</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {personId == null ? 'Suas tarefas' : 'Tarefas da pessoa'} por {field === 'due_date' ? 'prazo' : 'previsão de revisão'}
            <span className="text-slate-400"> · arraste para reagendar</span>.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PersonSelect members={members ?? []} value={personId} onChange={v => { setPersonId(v); setExpanded(new Set()); }} />

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

          {/* Prazo / Previsão */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setField('due_date')}
              className={`px-2.5 py-1.5 rounded-md transition-all ${field === 'due_date' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Prazo
            </button>
            <button
              onClick={() => setField('review')}
              className={`px-2.5 py-1.5 rounded-md transition-all ${field === 'review' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Previsão Revisão
            </button>
          </div>

          {/* Agenda Zimbra (só quando o e-mail está disponível) */}
          {mailOn && (
            <button
              onClick={() => setShowEvents(v => !v)}
              title={showEvents ? 'Ocultar agenda do e-mail' : 'Mostrar agenda do e-mail'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showEvents
                  ? 'border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {eventsQuery.isFetching ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
              Agenda
            </button>
          )}
        </div>
      </div>

      {/* Barra de navegação */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title={weekMode ? 'Semana anterior' : 'Mês anterior'}>
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-slate-800 capitalize min-w-44 text-center">
            {headerLabel}
          </span>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title={weekMode ? 'Próxima semana' : 'Próximo mês'}>
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
          <span>{periodCount} {weekMode ? 'nesta semana' : 'neste mês'}</span>
          <button onClick={() => refetch()} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title="Atualizar">
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
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Cabeçalho dos dias da semana */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map(w => (
                <div key={w} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-center">
                  {w}
                </div>
              ))}
            </div>

            {/* Células dos dias */}
            <div className="grid grid-cols-7">
              {days.map(day => {
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
                      <span className={`text-xs w-5 h-5 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-blue-600 text-white font-bold'
                          : inMonth ? 'text-slate-600' : 'text-slate-300'
                      }`}>
                        {format(day, 'd')}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      {(byEvent.get(dayStr) ?? []).map(ev => (
                        <EventChip key={`${ev.id}-${ev.start}`} ev={ev} />
                      ))}
                      {visible.map(issue => {
                        const closed = isClosed(issue);
                        const overdue = !closed && dayStr < todayStr;
                        return (
                          <IssueChip
                            key={issue.id}
                            issue={issue}
                            overdue={overdue}
                            closed={closed}
                            showAssignee={personId != null}
                            onIssueClick={onIssueClick}
                          />
                        );
                      })}
                      {!weekMode && dayIssues.length > 3 && (
                        <button
                          onClick={() => toggleExpand(dayStr)}
                          className="text-[10px] text-slate-400 hover:text-blue-600 px-1 text-left"
                        >
                          {expanded.has(dayStr) ? 'mostrar menos' : `+${dayIssues.length - 3} mais`}
                        </button>
                      )}
                    </div>
                  </DayCell>
                );
              })}
            </div>

            {/* Legenda */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-slate-100 bg-slate-50/50 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Imediata</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />Urgente</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Alta</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />Normal</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300" />Baixa</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-red-600">atrasada</span>
                <span className="text-slate-400 line-through">concluída</span>
              </span>
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeIssue && (
              <div className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] bg-white shadow-lg border border-blue-200">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[activeIssue.priority.name] ?? 'bg-slate-300'}`} />
                <span className="truncate max-w-40 text-slate-700">{activeIssue.subject}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {!isLoading && scheduledCount === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <CalendarDays size={28} className="mb-2 opacity-30" />
          <p className="text-sm">
            Nenhuma tarefa com {field === 'due_date' ? 'prazo' : 'previsão de revisão'} definido.
          </p>
        </div>
      )}
    </div>
  );
}
