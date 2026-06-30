import { useMemo } from 'react';
import type { Issue } from '../types/redmine';

const WEEKS = 8;

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day + (day === 0 ? -6 : 1); // segunda
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function label(d: Date) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

interface Props {
  open: Issue[] | undefined;
  completed: Issue[] | undefined;
}

export function ThroughputChart({ open, completed }: Props) {
  const data = useMemo(() => {
    const weekKey = (iso?: string) => {
      if (!iso) return null;
      return startOfWeek(new Date(iso)).toISOString().split('T')[0];
    };

    const created = new Map<string, number>();
    const closed = new Map<string, number>();

    const allForCreated = new Map<number, Issue>();
    [...(open ?? []), ...(completed ?? [])].forEach((i) => allForCreated.set(i.id, i));

    allForCreated.forEach((i) => {
      const k = weekKey(i.created_on);
      if (k) created.set(k, (created.get(k) || 0) + 1);
    });
    (completed ?? []).forEach((i) => {
      const k = weekKey(i.closed_on || i.updated_on);
      if (k) closed.set(k, (closed.get(k) || 0) + 1);
    });

    const weeks: { key: string; label: string; created: number; closed: number }[] = [];
    const thisWeek = startOfWeek(new Date());
    for (let i = WEEKS - 1; i >= 0; i--) {
      const d = new Date(thisWeek);
      d.setDate(d.getDate() - i * 7);
      const key = d.toISOString().split('T')[0];
      weeks.push({
        key,
        label: label(d),
        created: created.get(key) || 0,
        closed: closed.get(key) || 0,
      });
    }
    return weeks;
  }, [open, completed]);

  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.closed)));
  const totalCreated = data.reduce((s, d) => s + d.created, 0);
  const totalClosed = data.reduce((s, d) => s + d.closed, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">
          Criadas vs concluídas — últimas {WEEKS} semanas
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Criadas ({totalCreated})
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Concluídas ({totalClosed})
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 h-40">
        {data.map((d) => (
          <div key={d.key} className="flex-1 flex flex-col items-center gap-1 group/bar">
            <div className="w-full flex items-end justify-center gap-1 h-32">
              <div
                className="flex-1 max-w-8 bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                style={{ height: `${(d.created / max) * 100}%`, minHeight: d.created > 0 ? 4 : 0 }}
                title={`Semana de ${d.label}: ${d.created} criada(s)`}
              />
              <div
                className="flex-1 max-w-8 bg-green-500 rounded-t transition-all hover:bg-green-600"
                style={{ height: `${(d.closed / max) * 100}%`, minHeight: d.closed > 0 ? 4 : 0 }}
                title={`Semana de ${d.label}: ${d.closed} concluída(s)`}
              />
            </div>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">{d.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-2 text-center">
        Início de cada semana (segunda-feira)
      </p>
    </div>
  );
}
