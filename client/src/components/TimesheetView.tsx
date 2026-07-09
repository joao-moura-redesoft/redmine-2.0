import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, CalendarClock } from 'lucide-react';
import { redmineApi } from '../api/redmine';

const WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0=dom
  const diff = x.getDate() - day + (day === 0 ? -6 : 1); // segunda
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const fmtH = (h: number) => (h % 1 === 0 ? `${h}` : h.toFixed(2).replace(/0$/, ''));

interface Props {
  onIssueClick: (id: number) => void;
}

export function TimesheetView({ onIssueClick }: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = addDays(weekStart, 6);
  const from = ymd(weekStart);
  const to = ymd(weekEnd);

  const q = useQuery({
    queryKey: ['time-entries', { from, to }],
    queryFn: () => redmineApi.getTimeEntries({ from, to }),
    staleTime: 60_000,
  });

  const days = useMemo(() => {
    const byDay = new Map<string, typeof q.data>();
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
      return { date, key, entries, total };
    });
  }, [q.data, weekStart]);

  const weekTotal = days.reduce((s, d) => s + d.total, 0);
  const isThisWeek = ymd(startOfWeek(new Date())) === from;
  const rangeLabel = `${weekStart.getDate()}/${weekStart.getMonth() + 1} – ${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`;
  const todayKey = ymd(new Date());

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <CalendarClock size={18} className="text-blue-500" /> Apontamentos
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Suas horas da semana, por dia.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right mr-1">
            <div className="text-xs text-slate-400">Total da semana</div>
            <div className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
              {fmtH(weekTotal)}h
            </div>
          </div>
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            title="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            disabled={isThisWeek}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
          >
            {rangeLabel}
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            title="Próxima semana"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
          {days.map((d, i) => {
            const isToday = d.key === todayKey;
            return (
              <div
                key={d.key}
                className={`rounded-xl border p-3 min-h-28 flex flex-col ${
                  isToday
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50/40 dark:bg-blue-900/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span
                    className={`text-xs font-semibold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {WD[i]} {d.date.getDate()}
                  </span>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                    {d.total ? `${fmtH(d.total)}h` : ''}
                  </span>
                </div>
                <div className="space-y-1.5 flex-1">
                  {d.entries.length === 0 ? (
                    <p className="text-[11px] text-slate-300 dark:text-slate-600">—</p>
                  ) : (
                    d.entries.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => e.issue && onIssueClick(e.issue.id)}
                        disabled={!e.issue}
                        className="w-full text-left rounded-md bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1 transition-colors disabled:cursor-default"
                        title={e.comments}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 truncate">
                            {e.issue ? `#${e.issue.id}` : e.project.name}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums flex-shrink-0">
                            {fmtH(e.hours)}h
                          </span>
                        </div>
                        {e.comments && (
                          <div className="text-[10px] text-slate-400 truncate">{e.comments}</div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
