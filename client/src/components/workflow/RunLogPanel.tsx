// Painel de histórico de execução de uma automação. Lista as execuções recentes
// (mais nova primeiro) com o resultado de cada ação. Atualiza sozinho enquanto
// aberto (útil para ver disparos de schedule/eventos chegando).
import { Loader2, CheckCircle2, XCircle, FlaskConical, Zap, OctagonX } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWorkflowRuns } from '../../hooks/useWorkflows';
import { descriptorFor } from './nodeCatalog';

const actionLabel = (type: string) => descriptorFor(type)?.label ?? type;

export function RunLogPanel({ workflowId }: { workflowId: string }) {
  const { data: runs, isLoading } = useWorkflowRuns(workflowId, true);

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Histórico</div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : !runs || runs.length === 0 ? (
        <p className="text-xs text-slate-400">
          Nenhuma execução ainda. Dispare um evento ou use o botão “Testar”.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li
              key={run.id}
              className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs"
            >
              <div className="flex items-center gap-1.5">
                {run.ok ? (
                  <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                ) : (
                  <XCircle size={14} className="text-rose-500 flex-shrink-0" />
                )}
                <span
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                  title={run.mode === 'manual' ? 'Teste manual' : 'Disparo automático'}
                >
                  {run.mode === 'manual' ? <FlaskConical size={10} /> : <Zap size={10} />}
                  {run.mode === 'manual' ? 'teste' : 'auto'}
                </span>
                <span className="text-slate-400 ml-auto">
                  {formatDistanceToNow(run.at, { addSuffix: true, locale: ptBR })}
                </span>
              </div>
              {run.truncated ? (
                <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  Teto atingido — {run.truncated} tarefa(s) ficaram para a próxima execução.
                </div>
              ) : null}
              <div className="mt-1.5 space-y-1">
                {run.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    {a.ok ? (
                      <CheckCircle2 size={12} className="mt-0.5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <XCircle size={12} className="mt-0.5 text-rose-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="text-slate-600 dark:text-slate-300">{actionLabel(a.type)}</span>
                      {a.error && <span className="text-rose-500"> — {a.error}</span>}
                      {a.stopped && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
                          <OctagonX size={9} /> ramo interrompido
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
