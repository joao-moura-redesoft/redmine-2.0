// Prévia da varredura: mostra quais tarefas casam com as condições AGORA e o que
// rodaria nelas — sem executar nada. É o inverso do botão "Testar" (que ignora as
// condições e executa as ações).
import { X, Loader2, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { descriptorFor } from './nodeCatalog';
import type { PreviewResult } from '../../api/workflows';

const actionLabel = (t: string) => descriptorFor(t)?.label ?? t;

export function PreviewModal({
  result,
  loading,
  error,
  onClose,
}: {
  result: PreviewResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Prévia da varredura
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Avalia as condições nas suas tarefas. Nada é executado.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : error ? (
            <p className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              {error}
            </p>
          ) : result ? (
            <>
              <div className="flex items-baseline gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-2xl font-semibold text-slate-800 dark:text-slate-100">
                  {result.matchedCount}
                </span>
                <span>de {result.scopeCount} tarefas casam com as condições.</span>
              </div>

              {result.matchedCount > result.cap && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                  O teto é {result.cap} por execução — as demais entram nas execuções seguintes.
                </p>
              )}

              {result.indeterminate > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <HelpCircle size={13} className="mt-0.5 flex-shrink-0" />
                  {result.indeterminate} tarefa(s) dependem da saída de uma ação (ex.: a IA
                  classificar). Como a prévia não executa ações, não dá para saber o ramo delas.
                </p>
              )}

              {result.matched.length === 0 ? (
                <p className="mt-6 text-sm text-slate-400 text-center">
                  Nenhuma tarefa casa agora. Nada rodaria.
                </p>
              ) : (
                <ul className="mt-4 space-y-1.5">
                  {result.matched.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-start gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2"
                    >
                      {m.indeterminate ? (
                        <HelpCircle size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                      ) : (
                        <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-slate-800 dark:text-slate-100 truncate">
                          <span className="text-slate-400">#{m.id}</span> {m.subject}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          rodaria: {m.actions.map(actionLabel).join(' · ')}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
