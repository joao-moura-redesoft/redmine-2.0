import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  type Board,
  type BoardPatch,
} from '../api/boards';
import { getStoredAuth } from '../api/redmine';

const KEY = ['boards'];

export function useBoards() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchBoards,
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BoardPatch & { id?: string } = {}) => createBoard(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Board[]>(KEY);
      const now = Date.now();
      const optimistic: Board = {
        id: patch.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: patch.name ?? '',
        color: patch.color ?? null,
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<Board[]>(KEY, (old = []) => [...old, optimistic]);
      return { prev, id: optimistic.id };
    },
    onSuccess: (board, _patch, ctx) => {
      qc.setQueryData<Board[]>(KEY, (old = []) => old.map((b) => (b.id === ctx?.id ? board : b)));
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useUpdateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BoardPatch }) => updateBoard(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Board[]>(KEY);
      qc.setQueryData<Board[]>(KEY, (old = []) =>
        old.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBoard(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Board[]>(KEY);
      qc.setQueryData<Board[]>(KEY, (old = []) => old.filter((b) => b.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    // Sprints do board voltam a boardId=null no servidor — recarrega ambos.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['sprints'] });
    },
  });
}
