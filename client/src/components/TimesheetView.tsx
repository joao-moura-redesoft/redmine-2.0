import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  CalendarClock,
  AlertTriangle,
  Plus,
  Target,
  TrendingUp,
  CalendarX,
} from 'lucide-react';
import { redmineApi } from '../api/redmine';
import { useIssuesByIds } from '../hooks/useRedmine';
import { ymd, addDays, startOfWeek, fmtHours } from '../utils/time';
import { TimeEntryDialog } from './timesheet/TimeEntryDialog';
import type { TimeEntry } from '../types/redmine';

const WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const GOAL_KEY = 'timesheet:weeklyGoal';
const DAILY_TARGET = 8;

/** Cor estável por projeto — mesma tarefa sempre com a mesma faixa lateral. */
const colorFor = (id: number) => `hsl(${(id * 137.5) % 360} 62% 55%)`;

const readGoal = () => Number(localStorage.getItem(GOAL_KEY)) || 40;

interface Props {
  onIssueClick: (id: number) => void;
}

function StatTile({
  icon,
  label,
  value,
  hint,
  tone = 'slate',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'slate' | 'amber' | 'blue';
}) {
  const tones = {
    slate: 'text-slate-400',
    amber: 'text-amber-500',
    blue: 'text-blue-500',
  };
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 mb-1">
        <span className={tones[tone]}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums leading-none">
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; hours: number }[] }) {
  const max = Math.max(...rows.map((r) => r.hours), 1);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">Nada apontado nesta semana.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.name}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                  {r.name}
                </span>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                  {fmtHours(r.hours)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${(r.hours / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimesheetView({ onIssueClick }: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [goal, setGoal] = useState(readGoal);

  const weekEnd = addDays(weekStart, 6);
  const from = ymd(weekStart);
  const to = ymd(weekEnd);

  const q = useQuery({
    queryKey: ['time-entries', { from, to }],
    queryFn: () => redmineApi.getTimeEntries({ from, to }),
    staleTime: 60_000,
  });

  // A API de time entries devolve `issue: { id }` e nada mais — buscamos os
  // assuntos à parte para o card mostrar o que a pessoa realmente fez.
  const issueIds = useMemo(
    () => [...new Set((q.data ?? []).map((e) => e.issue?.id).filter((id): id is number => !!id))],
    [q.data],
  );
  const { data: issues } = useIssuesByIds(issueIds);
  const subjects = useMemo(() => new Map((issues ?? []).map((i) => [i.id, i.subject])), [issues]);

  const days = useMemo(() => {
    const byDay = new Map<string, TimeEntry[]>();
    for (const e of q.data ?? []) {
      const list = byDay.get(e.spent_on) ?? [];
      list.push(e);
      byDay.set(e.spent_on, list);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const key = ymd(date);
      const entries = (byDay.get(key) ?? []).slice().sort((a, b) => b.hours - a.hours);
      const total = entries.reduce((s, e) => s + e.hours, 0);
      return { date, key, entries, total, isWeekend: i >= 5 };
    });
  }, [q.data, weekStart]);

  const todayKey = ymd(new Date());
  const weekTotal = days.reduce((s, d) => s + d.total, 0);
  const workedDays = days.filter((d) => d.total > 0).length;
  // Dia útil já passado e sem nenhuma hora: o que a pessoa precisa ver primeiro.
  const openDays = days.filter((d) => !d.isWeekend && d.key < todayKey && d.total === 0);
  const isThisWeek = ymd(startOfWeek(new Date())) === from;
  const rangeLabel = `${weekStart.getDate()}/${weekStart.getMonth() + 1} – ${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`;
  const pct = goal > 0 ? Math.min((weekTotal / goal) * 100, 100) : 0;
  const remaining = Math.max(goal - weekTotal, 0);

  const byProject = useMemo(() => aggregate(q.data ?? [], (e) => e.project.name), [q.data]);
  const byActivity = useMemo(() => aggregate(q.data ?? [], (e) => e.activity.name), [q.data]);

  const dialogOpen = !!editing || !!creatingOn;

  // Atalhos de teclado, no mesmo espírito da triagem do Kanban.
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') setWeekStart((w) => addDays(w, -7));
      else if (e.key === 'ArrowRight') setWeekStart((w) => addDays(w, 7));
      else if (e.key.toLowerCase() === 't') setWeekStart(startOfWeek(new Date()));
      else if (e.key.toLowerCase() === 'n') setCreatingOn(todayKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, todayKey]);

  const updateGoal = (v: number) => {
    const clamped = Math.max(1, Math.min(v || 40, 168));
    setGoal(clamped);
    localStorage.setItem(GOAL_KEY, String(clamped));
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-10">
      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
            <CalendarClock size={24} className="text-blue-500" /> Apontamentos
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Clique num registro para editar, ou num dia para lançar horas.{' '}
            <span className="text-slate-400">
              Atalhos: <kbd className="font-sans">←</kbd> <kbd className="font-sans">→</kbd> semana
              · <kbd className="font-sans">T</kbd> hoje · <kbd className="font-sans">N</kbd> novo
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreatingOn(todayKey)}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            <Plus size={15} /> Apontar horas
          </button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            title="Semana anterior (←)"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            disabled={isThisWeek}
            title={isThisWeek ? 'Você está na semana atual' : 'Voltar para a semana atual (T)'}
            className="text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 tabular-nums min-w-[7rem]"
          >
            {rangeLabel}
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            title="Próxima semana (→)"
            aria-label="Próxima semana"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {q.isError ? (
        /* Sem este ramo, uma falha de rede renderiza sete dias vazios — o usuário
           conclui que já apontou tudo. Nunca deixe o erro parecer "zero horas". */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <AlertTriangle size={28} className="text-amber-500 mb-3" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Não consegui carregar seus apontamentos.
          </p>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            Isto <strong>não</strong> significa que a semana está vazia.
          </p>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium"
          >
            {q.isFetching ? 'Tentando…' : 'Tentar de novo'}
          </button>
        </div>
      ) : q.isLoading ? (
        <div className="flex items-center justify-center py-32 text-slate-400">
          <Loader2 size={26} className="animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Indicadores ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <Target size={13} className="text-blue-500" /> Meta da semana
                </span>
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={goal}
                  onChange={(e) => updateGoal(Number(e.target.value))}
                  aria-label="Meta semanal em horas"
                  className="w-12 text-[11px] text-right bg-transparent text-slate-400 hover:text-slate-600 focus:text-slate-700 dark:focus:text-slate-200 border-b border-dashed border-slate-300 dark:border-slate-600 focus:outline-none tabular-nums"
                />
              </div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums leading-none">
                {fmtHours(weekTotal)}
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mt-2">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {remaining > 0 ? `Faltam ${fmtHours(remaining)}` : 'Meta batida'}
              </div>
            </div>

            <StatTile
              icon={<TrendingUp size={13} />}
              label="Média por dia apontado"
              tone="blue"
              value={fmtHours(workedDays ? weekTotal / workedDays : 0)}
              hint={`${workedDays} ${workedDays === 1 ? 'dia' : 'dias'} com registro`}
            />
            <StatTile
              icon={<CalendarX size={13} />}
              label="Dias úteis em aberto"
              tone={openDays.length ? 'amber' : 'slate'}
              value={String(openDays.length)}
              hint={
                openDays.length
                  ? openDays.map((d) => WD[days.indexOf(d)]).join(', ')
                  : 'Nenhuma pendência'
              }
            />
            <StatTile
              icon={<CalendarClock size={13} />}
              label="Registros na semana"
              value={String((q.data ?? []).length)}
              hint={`${byProject.length} ${byProject.length === 1 ? 'projeto' : 'projetos'}`}
            />
          </div>

          {/* ── Semana ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
            {days.map((d, i) => {
              const isToday = d.key === todayKey;
              const isOpen = openDays.includes(d);
              const dayPct = Math.min((d.total / DAILY_TARGET) * 100, 100);
              return (
                <div
                  key={d.key}
                  className={`group rounded-xl border flex flex-col min-h-[22rem] transition-colors ${
                    isToday
                      ? 'border-blue-400 dark:border-blue-600 bg-blue-50/40 dark:bg-blue-900/10 ring-1 ring-blue-200 dark:ring-blue-800'
                      : isOpen
                        ? 'border-amber-300 dark:border-amber-800/60 border-dashed bg-amber-50/30 dark:bg-amber-900/5'
                        : d.isWeekend
                          ? 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="px-3 pt-3 pb-2">
                    <div className="flex items-baseline justify-between gap-1">
                      <span
                        className={`text-sm font-semibold ${
                          isToday
                            ? 'text-blue-600 dark:text-blue-400'
                            : d.isWeekend
                              ? 'text-slate-400'
                              : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {WD[i]}{' '}
                        <span className="text-slate-400 font-normal">{d.date.getDate()}</span>
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-base font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                          {d.total ? fmtHours(d.total) : ''}
                        </span>
                        <button
                          onClick={() => setCreatingOn(d.key)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                          title={`Apontar horas em ${d.date.getDate()}/${d.date.getMonth() + 1}`}
                          aria-label="Apontar horas neste dia"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    {!d.isWeekend && (
                      <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mt-2">
                        <div
                          className={`h-full rounded-full ${d.total >= DAILY_TARGET ? 'bg-emerald-500' : 'bg-blue-400'}`}
                          style={{ width: `${dayPct}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="px-2.5 pb-2.5 space-y-2 flex-1 overflow-y-auto">
                    {d.entries.length === 0 ? (
                      <button
                        onClick={() => setCreatingOn(d.key)}
                        className="w-full h-full min-h-[8rem] rounded-lg flex flex-col items-center justify-center gap-1.5 text-slate-300 dark:text-slate-600 hover:text-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors"
                      >
                        {isOpen ? (
                          <>
                            <AlertTriangle size={16} className="text-amber-500" />
                            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
                              Sem apontamento
                            </span>
                          </>
                        ) : (
                          <>
                            <Plus size={16} />
                            <span className="text-[11px]">Apontar</span>
                          </>
                        )}
                      </button>
                    ) : (
                      d.entries.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setEditing(e)}
                          style={{ borderLeftColor: colorFor(e.project.id) }}
                          className="w-full text-left rounded-lg border-l-[3px] bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm px-2.5 py-2 transition-all"
                          title={e.comments || undefined}
                        >
                          <div className="flex items-baseline justify-between gap-1.5">
                            <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 truncate">
                              {e.issue ? `#${e.issue.id}` : e.project.name}
                            </span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                              {fmtHours(e.hours)}
                            </span>
                          </div>
                          {e.issue && subjects.get(e.issue.id) && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5 line-clamp-2">
                              {subjects.get(e.issue.id)}
                            </div>
                          )}
                          <div className="text-[10px] text-slate-400 mt-1 truncate">
                            {e.activity.name}
                            {e.comments && ` · ${e.comments}`}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Resumo ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Breakdown title="Por projeto" rows={byProject} />
            <Breakdown title="Por atividade" rows={byActivity} />
          </div>
        </>
      )}

      {(editing || creatingOn) && (
        <TimeEntryDialog
          entry={editing ?? undefined}
          defaultDate={creatingOn ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreatingOn(null);
          }}
          onIssueClick={onIssueClick}
        />
      )}
    </div>
  );
}

function aggregate(entries: TimeEntry[], key: (e: TimeEntry) => string) {
  const map = new Map<string, number>();
  for (const e of entries) map.set(key(e), (map.get(key(e)) ?? 0) + e.hours);
  return [...map.entries()]
    .map(([name, hours]) => ({ name, hours }))
    .sort((a, b) => b.hours - a.hours);
}
