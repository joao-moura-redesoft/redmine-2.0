import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  fetchWorkflowRuns,
  triggerWorkflow,
  type Workflow,
  type WorkflowPatch,
} from '../api/workflows';
import { getStoredAuth } from '../api/redmine';

const KEY = ['workflows'];

// Histórico de execução de um workflow. Enquanto o painel está aberto, atualiza
// a cada 8s para refletir disparos recentes.
export function useWorkflowRuns(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workflow-runs', id],
    queryFn: () => fetchWorkflowRuns(id),
    enabled: enabled && !!getStoredAuth(),
    refetchInterval: enabled ? 8_000 : false,
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchWorkflows,
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: WorkflowPatch & { id?: string } = {}) => createWorkflow(patch),
    // Criação otimista com id estável vindo do cliente (o editor abre na hora,
    // sem remontar quando o servidor responde).
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Workflow[]>(KEY);
      const now = Date.now();
      const optimistic: Workflow = {
        id: patch.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: patch.name ?? 'Nova automação',
        enabled: patch.enabled ?? false,
        nodes: patch.nodes ?? [],
        createdAt: now,
        updatedAt: now,
        runCount: 0,
      };
      qc.setQueryData<Workflow[]>(KEY, (old = []) => [optimistic, ...old]);
      return { prev, id: optimistic.id };
    },
    onSuccess: (wf, _patch, ctx) => {
      qc.setQueryData<Workflow[]>(KEY, (old = []) => old.map((w) => (w.id === ctx?.id ? wf : w)));
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WorkflowPatch }) => updateWorkflow(id, patch),
    // Atualização otimista (autosave sem flicker).
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Workflow[]>(KEY);
      qc.setQueryData<Workflow[]>(KEY, (old = []) =>
        old.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

// Dispara manualmente um workflow com gatilho `workflow.manual` (execução REAL:
// respeita filtros e executa as ações). `issueId` opcional injeta a tarefa do
// card no contexto. Ao concluir, atualiza o histórico de execuções.
export function useTriggerWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, issueId }: { id: string; issueId?: number }) => triggerWorkflow(id, issueId),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workflow-runs', id] });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Workflow[]>(KEY);
      qc.setQueryData<Workflow[]>(KEY, (old = []) => old.filter((w) => w.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}
