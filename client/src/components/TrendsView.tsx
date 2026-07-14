import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  RefreshCw,
  Layers,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react';
import { getTrendsAnalytics, type TrendsAnalytics, type TrendMonth } from '../api/analytics';

interface Props {
  projectId?: number;
}

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// 'YYYY-MM' -> 'fev/26'
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MES[Number(m) - 1] ?? '?'}/${y.slice(2)}`;
}

const RANGES = [3, 6, 12];

function Tile({
  label,
  value,
  suffix,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
      {icon && <span className={`flex-shrink-0 ${tone ?? 'text-slate-400'}`}>{icon}</span>}
      <div className="leading-tight min-w-0">
        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
          {value}
          {suffix && <span className="text-sm font-medium text-slate-400 ml-1">{suffix}</span>}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</div>
      </div>
    </div>
  );
}

// Barras agrupadas: criadas (azul) vs. fechadas (verde), rótulo de valor acima.
function CreatedVsClosed({ months }: { months: TrendMonth[] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.created, m.closed)));
  return (
    <div className="flex items-end justify-between gap-2 h-48">
      {months.map((m) => (
        <div key={m.key} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          <div className="w-full flex items-end justify-center gap-1 h-40">
            <div className="flex-1 max-w-9 flex flex-col items-center justify-end h-full">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums leading-none mb-0.5">
                {m.created > 0 ? m.created : ''}
              </span>
              <div
                className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                style={{ height: `${(m.created / max) * 100}%`, minHeight: m.created > 0 ? 4 : 0 }}
                title={`${monthLabel(m.key)}: ${m.created} criada(s)`}
              />
            </div>
            <div className="flex-1 max-w-9 flex flex-col items-center justify-end h-full">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums leading-none mb-0.5">
                {m.closed > 0 ? m.closed : ''}
              </span>
              <div
                className="w-full bg-green-500 rounded-t transition-all hover:bg-green-600"
                style={{ height: `${(m.closed / max) * 100}%`, minHeight: m.closed > 0 ? 4 : 0 }}
                title={`${monthLabel(m.key)}: ${m.closed} fechada(s)`}
              />
            </div>
          </div>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">{monthLabel(m.key)}</span>
        </div>
      ))}
    </div>
  );
}

// Linha de backlog (série única) em SVG, com área sob a curva e pontos.
function BacklogLine({ months }: { months: TrendMonth[] }) {
  const W = 600,
    H = 200,
    P = 30;
  const max = Math.max(1, ...months.map((m) => m.backlog));
  const n = months.length;
  const x = (i: number) => P + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * P));
  const y = (v: number) => P + (1 - v / max) * (H - 2 * P);

  const line = months.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(m.backlog)}`).join(' ');
  const area = `${line} L${x(n - 1)},${H - P} L${x(0)},${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* grade + escala */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={P}
            x2={W - P}
            y1={y(max * f)}
            y2={y(max * f)}
            className="stroke-slate-100 dark:stroke-slate-800"
            strokeWidth={1}
          />
          <text x={4} y={y(max * f) + 3} className="fill-slate-400 text-[9px]">
            {Math.round(max * f)}
          </text>
        </g>
      ))}

      <path d={area} className="fill-blue-500/10" stroke="none" />
      <path
        d={line}
        fill="none"
        className="stroke-blue-500"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {months.map((m, i) => (
        <g key={m.key}>
          <circle cx={x(i)} cy={y(m.backlog)} r={4} className="fill-blue-500" />
          <circle cx={x(i)} cy={y(m.backlog)} r={2} className="fill-white dark:fill-slate-900" />
          <text x={x(i)} y={H - P + 14} textAnchor="middle" className="fill-slate-400 text-[9px]">
            {monthLabel(m.key)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function TrendContent({ data }: { data: TrendsAnalytics }) {
  const { summary } = data;
  const trendMeta =
    summary.trend === 'growing'
      ? {
          icon: <TrendingUp size={22} />,
          tone: 'text-red-500',
          label: 'backlog crescendo',
          badge: 'text-red-600 dark:text-red-400',
          arrow: <ArrowUpRight size={13} />,
        }
      : summary.trend === 'shrinking'
        ? {
            icon: <TrendingDown size={22} />,
            tone: 'text-emerald-500',
            label: 'backlog encolhendo',
            badge: 'text-emerald-600 dark:text-emerald-400',
            arrow: <ArrowDownRight size={13} />,
          }
        : {
            icon: <Minus size={22} />,
            tone: 'text-slate-400',
            label: 'backlog estável',
            badge: 'text-slate-500',
            arrow: null,
          };

  return (
    <div className="space-y-6">
      {data.capped && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          Atingiu o teto de 2000 tarefas em alguma consulta — filtre por projeto para números
          exatos.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          icon={<Layers size={22} />}
          tone="text-blue-500"
          label="backlog atual (abertas)"
          value={data.totalOpenNow}
        />
        <Tile
          icon={trendMeta.icon}
          tone={trendMeta.tone}
          label={trendMeta.label}
          value={
            <span className="inline-flex items-center gap-0.5">
              {summary.backlogDelta > 0 ? '+' : ''}
              {summary.backlogDelta}
            </span>
          }
          suffix={`em ${data.monthsBack}m`}
        />
        <Tile
          icon={<ArrowUpRight size={22} />}
          tone="text-slate-400"
          label="média criadas/mês"
          value={summary.avgCreated}
        />
        <Tile
          icon={<ArrowDownRight size={22} />}
          tone="text-slate-400"
          label="média fechadas/mês"
          value={summary.avgClosed}
        />
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Criadas vs. fechadas por mês
          </h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Criadas (
              {summary.createdTotal})
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Fechadas (
              {summary.closedTotal})
            </span>
          </div>
        </div>
        <CreatedVsClosed months={data.months} />
        <p className="text-xs text-slate-400 mt-3">
          Saldo no período:{' '}
          <b
            className={
              summary.netTotal > 0
                ? 'text-red-600 dark:text-red-400'
                : summary.netTotal < 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500'
            }
          >
            {summary.netTotal > 0 ? '+' : ''}
            {summary.netTotal}
          </b>{' '}
          (criadas − fechadas). O mês atual é parcial.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Backlog ao longo do tempo
          </h3>
          <span className={`text-xs font-semibold flex items-center gap-1 ${trendMeta.badge}`}>
            {trendMeta.arrow}
            {summary.backlogStart} → {summary.backlogEnd}
          </span>
        </div>
        <BacklogLine months={data.months} />
        <p className="text-xs text-slate-400 mt-3">
          Reconstruído a partir do total aberto de hoje, andando para trás pelo saldo mensal —
          aproximado, mas mostra a direção.
        </p>
      </section>
    </div>
  );
}

export function TrendsView({ projectId }: Props) {
  const [months, setMonths] = useState<number>(6);
  const q = useQuery({
    queryKey: ['analytics', 'trends', projectId, months],
    queryFn: () => getTrendsAnalytics(projectId, months),
    staleTime: 60_000,
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <TrendingUp size={18} className="text-blue-500" /> Tendências
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Estamos melhorando ou piorando? Criadas vs. fechadas e evolução do backlog.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setMonths(r)}
                className={`text-xs font-medium px-3 py-1.5 transition-colors ${
                  months === r
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {r}m
              </button>
            ))}
          </div>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {q.isFetching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Atualizar
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : q.isError || !q.data ? (
        <div className="text-center py-16 text-slate-500">
          Não consegui carregar as tendências. Tente atualizar.
        </div>
      ) : (
        <TrendContent data={q.data} />
      )}
    </div>
  );
}
