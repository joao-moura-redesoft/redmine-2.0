// Lançador de automações MANUAIS (gatilho `workflow.manual`) a partir de um card.
// Lista os workflows habilitados com esse gatilho e executa o escolhido de
// verdade (respeitando filtros e executando ações), injetando a tarefa atual.
import { useMemo, useRef, useState, useEffect } from 'react';
import { Zap, Loader2, Check } from 'lucide-react';
import { useWorkflows, useTriggerWorkflow } from '../../hooks/useWorkflows';

export function ManualWorkflowButton({ issueId }: { issueId: number }) {
  const { data: workflows } = useWorkflows();
  const trigger = useTriggerWorkflow();
  const [open, setOpen] = useState(false);
  const [ranId, setRanId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const manual = useMemo(
    () =>
      (workflows ?? []).filter(
        (w) =>
          w.enabled && w.nodes.some((n) => n.kind === 'trigger' && n.type === 'workflow.manual'),
      ),
    [workflows],
  );

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (manual.length === 0) return null;

  const run = async (id: string) => {
    try {
      await trigger.mutateAsync({ id, issueId });
      setRanId(id);
      setTimeout(() => setRanId((cur) => (cur === id ? null : cur)), 1500);
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Um só: dispara direto. Vários: abre o menu de escolha.
          if (manual.length === 1) run(manual[0].id);
          else setOpen((v) => !v);
        }}
        disabled={trigger.isPending}
        title="Executar uma automação manual nesta tarefa"
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400 transition-colors disabled:opacity-60"
      >
        {trigger.isPending ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
        Automação
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
          {manual.map((w) => (
            <button
              key={w.id}
              onClick={(e) => {
                e.stopPropagation();
                run(w.id);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <span className="truncate">{w.name}</span>
              {ranId === w.id && <Check size={13} className="text-emerald-500 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
