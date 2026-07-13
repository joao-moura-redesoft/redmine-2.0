import { useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import {
  X,
  Sunrise,
  Loader2,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  CheckCircle2,
} from 'lucide-react';
import { getLatestDigest, runDigest, type Digest } from '../api/digest';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Props {
  onClose: () => void;
}

// Célula de contagem (atrasadas, hoje, revisar…).
function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
      <span className={tone}>{icon}</span>
      <div className="leading-tight">
        <div className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">
          {value}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </div>
  );
}

export function DigestModal({ onClose }: Props) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setDigest(await getLatestDigest());
      } catch {
        /* sem digest ainda */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const generate = async () => {
    setError('');
    setGenerating(true);
    try {
      setDigest(await runDigest());
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      const serverMsg = axios.isAxiosError(e)
        ? e.response?.data?.error || e.response?.data?.message
        : undefined;
      setError(
        status === 404
          ? 'Rota do digest não encontrada — reinicie o servidor com o código novo.'
          : serverMsg || 'Não consegui gerar agora. Confira as credenciais e tente de novo.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const c = digest?.counts;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-indigo-500 to-blue-600">
          <div className="flex items-center gap-2.5 text-white">
            <Sunrise size={20} />
            <div>
              <h2 className="text-base font-bold leading-none">
                Bom dia{digest?.name ? `, ${digest.name}` : ''}
              </h2>
              <p className="text-[11px] text-white/80 mt-1">Resumo da manhã</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : digest ? (
            <>
              <div className="flex items-start gap-2 mb-4">
                <h3 className="flex-1 text-lg font-bold text-slate-800 dark:text-slate-100 text-balance">
                  {digest.headline}
                </h3>
                {digest.ai && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-1 rounded-full flex-shrink-0">
                    <Sparkles size={11} /> IA
                  </span>
                )}
              </div>

              {c && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
                  <Stat
                    icon={<AlertTriangle size={16} />}
                    label="atrasadas"
                    value={c.overdue}
                    tone="text-red-500"
                  />
                  <Stat
                    icon={<CalendarClock size={16} />}
                    label="vencem hoje"
                    value={c.dueToday}
                    tone="text-amber-500"
                  />
                  <Stat
                    icon={<ClipboardCheck size={16} />}
                    label="para revisar"
                    value={c.toReview}
                    tone="text-violet-500"
                  />
                  <Stat
                    icon={<Sunrise size={16} />}
                    label="abertas"
                    value={c.assigned}
                    tone="text-blue-500"
                  />
                  <Stat
                    icon={<CheckCircle2 size={16} />}
                    label="concluídas"
                    value={c.doneRecently}
                    tone="text-emerald-500"
                  />
                </div>
              )}

              <ul className="space-y-2">
                {digest.lines.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <p className="text-[11px] text-slate-400 mt-5">
                Gerado {formatDistanceToNow(digest.generatedAt, { addSuffix: true, locale: ptBR })}
              </p>
            </>
          ) : (
            <div className="text-center py-8">
              <Sunrise size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhum resumo ainda. Gere o primeiro agora.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

          <button
            onClick={generate}
            disabled={generating}
            className="mt-5 w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
          >
            {generating ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Gerando…
              </>
            ) : (
              <>
                <RefreshCw size={15} /> {digest ? 'Gerar de novo' : 'Gerar agora'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
