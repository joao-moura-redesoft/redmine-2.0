import { useState } from 'react';
import { X, Sparkles, Copy, Check, Loader2, RefreshCw, CalendarRange, Sun } from 'lucide-react';
import { redmineApi } from '../api/redmine';
import { getAIKey } from '../utils/aiConfig';
import type { Issue } from '../types/redmine';

type Mode = 'daily' | 'weekly';

interface Props {
  issues: Issue[];
  completedIssues?: Issue[];
  onClose: () => void;
}

export function StandupModal({ issues, completedIssues = [], onClose }: Props) {
  const [mode, setMode] = useState<Mode>('daily');
  const [standup, setStandup] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState(false);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setStandup('');
    setGenerated(false);
    setError('');
  };

  const generate = async () => {
    setError('');
    setLoading(true);
    try {
      const text = mode === 'daily'
        ? await redmineApi.standup(issues)
        : await redmineApi.weeklyDigest(issues, completedIssues);
      setStandup(text);
      setGenerated(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('401') || msg.includes('403')
        ? 'Chave inválida. Verifique nas Configurações.'
        : 'Erro ao gerar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(standup);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasKey = !!getAIKey();

  // Status summary para mostrar antes de gerar
  const byStatus = issues.reduce<Record<string, number>>((acc, i) => {
    acc[i.status.name] = (acc[i.status.name] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{mode === 'daily' ? 'Daily Standup' : 'Retrospectiva Semanal'}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Toggle de modo */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
            <button
              onClick={() => switchMode('daily')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-colors ${mode === 'daily' ? 'bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400' : 'text-slate-500'}`}
            ><Sun size={13} /> Diário</button>
            <button
              onClick={() => switchMode('weekly')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-colors ${mode === 'weekly' ? 'bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400' : 'text-slate-500'}`}
            ><CalendarRange size={13} /> Semanal</button>
          </div>

          {/* Resumo das tarefas */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
              {issues.length} tarefa{issues.length !== 1 ? 's' : ''} abertas
              {mode === 'weekly' && completedIssues.length > 0 && ` · ${completedIssues.length} concluída${completedIssues.length !== 1 ? 's' : ''} recentes`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byStatus).map(([status, count]) => (
                <span
                  key={status}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                >
                  {count}× {status}
                </span>
              ))}
            </div>
          </div>

          {!hasKey && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Configure uma Claude API Key ou OpenAI API Key nas Configurações para usar esta feature.
            </p>
          )}

          {/* Resultado */}
          {generated && standup && (
            <div className="border border-purple-200 dark:border-purple-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-100 dark:border-purple-800">
                <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">{mode === 'daily' ? 'Standup gerado' : 'Retrospectiva gerada'}</span>
                <button
                  onClick={copy}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-400 transition-colors"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
              <div className="p-4 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto scrollbar-thin">
                {standup}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            Fechar
          </button>
          <button
            onClick={generate}
            disabled={loading || !hasKey}
            className="flex items-center gap-2 px-4 py-2 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
          >
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> Gerando…</>
              : generated
                ? <><RefreshCw size={13} /> Regenerar</>
                : <><Sparkles size={13} /> {mode === 'daily' ? 'Gerar standup' : 'Gerar retrospectiva'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
