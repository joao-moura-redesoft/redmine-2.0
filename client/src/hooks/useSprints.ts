import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSprints, createSprint, updateSprint, deleteSprint, reorderSprints,
  addIssueToSprint, removeIssueFromSprint,
  type Sprint, type SprintPatch,
} from '../api/sprints';
import { getStoredAuth } from '../api/redmine';

const KEY = ['sprints'];

export function useSprints() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchSprints,
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
  });
}

export function useCreateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SprintPatch & { id?: string } = {}) => createSprint(patch),
    // Criação otimista com id estável vindo do cliente (sem troca de id ao
    // responder o servidor) — mesma motivação do bloco de notas.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Sprint[]>(KEY);
      const now = Date.now();
      const optimistic: Sprint = {
        id: patch.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: patch.name ?? '',
        goal: patch.goal ?? '',
        startDate: patch.startDate ?? null,
        endDate: patch.endDate ?? null,
        status: patch.status ?? 'planned',
        boardId: patch.boardId ?? null,
        issueIds: patch.issueIds ?? [],
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<Sprint[]>(KEY, (old = []) => [...old, optimistic]); // ao fim → direita da raia
      return { prev, id: optimistic.id };
    },
    onSuccess: (sprint, _patch, ctx) => {
      qc.setQueryData<Sprint[]>(KEY, (old = []) =>
        old.map(s => (s.id === ctx?.id ? sprint : s)));
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useUpdateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SprintPatch }) => updateSprint(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Sprint[]>(KEY);
      qc.setQueryData<Sprint[]>(KEY, (old = []) =>
        old.map(s => s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useDeleteSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSprint(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Sprint[]>(KEY);
      qc.setQueryData<Sprint[]>(KEY, (old = []) => old.filter(s => s.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useReorderSprints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderSprints(ids),
    // Otimista: reordena a lista em cache segundo a ordem dada (ids ausentes vão pro fim).
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Sprint[]>(KEY);
      const pos = new Map(ids.map((id, i) => [id, i]));
      qc.setQueryData<Sprint[]>(KEY, (old = []) =>
        [...old].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useAddIssueToSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, issueId }: { sprintId: string; issueId: number }) =>
      addIssueToSprint(sprintId, issueId),
    // Otimista: a tarefa sai de qualquer outra sprint e entra na alvo (espelha a
    // regra "1 tarefa = 1 sprint" do servidor).
    onMutate: async ({ sprintId, issueId }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Sprint[]>(KEY);
      qc.setQueryData<Sprint[]>(KEY, (old = []) =>
        old.map(s => {
          if (s.id === sprintId) {
            return s.issueIds.includes(issueId)
              ? s
              : { ...s, issueIds: [...s.issueIds, issueId], updatedAt: Date.now() };
          }
          return s.issueIds.includes(issueId)
            ? { ...s, issueIds: s.issueIds.filter(id => id !== issueId), updatedAt: Date.now() }
            : s;
        }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useRemoveIssueFromSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, issueId }: { sprintId: string; issueId: number }) =>
      removeIssueFromSprint(sprintId, issueId),
    onMutate: async ({ sprintId, issueId }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Sprint[]>(KEY);
      qc.setQueryData<Sprint[]>(KEY, (old = []) =>
        old.map(s => s.id === sprintId
          ? { ...s, issueIds: s.issueIds.filter(id => id !== issueId), updatedAt: Date.now() }
          : s));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}
