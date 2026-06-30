import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotes,
  createNote,
  updateNote,
  deleteNote,
  type Note,
  type NotePatch,
} from '../api/notes';
import { getStoredAuth } from '../api/redmine';

const KEY = ['notes'];

export function useNotes() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchNotes,
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotePatch & { id?: string } = {}) => createNote(patch),
    // Criação otimista: a nota aparece na hora, com id estável vindo do cliente.
    // Sem o id estável, o id mudaria quando o servidor respondesse (~2s) e o
    // editor remontaria — disparando a auto-exclusão de nota vazia.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Note[]>(KEY);
      const now = Date.now();
      const optimistic: Note = {
        id: patch.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
        title: patch.title ?? '',
        body: patch.body ?? '',
        tags: patch.tags ?? [],
        pinned: patch.pinned ?? false,
        color: patch.color ?? null,
        linkedIssueId: patch.linkedIssueId ?? null,
        linkedProjectId: patch.linkedProjectId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<Note[]>(KEY, (old = []) => [optimistic, ...old]);
      return { prev, id: optimistic.id };
    },
    // Reconcilia a nota otimista com a versão do servidor (mesmo id).
    onSuccess: (note, _patch, ctx) => {
      qc.setQueryData<Note[]>(KEY, (old = []) => old.map((n) => (n.id === ctx?.id ? note : n)));
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) => updateNote(id, patch),
    // Atualização otimista: a UI reflete imediatamente (autosave sem flicker)
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Note[]>(KEY);
      qc.setQueryData<Note[]>(KEY, (old = []) =>
        old.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Note[]>(KEY);
      qc.setQueryData<Note[]>(KEY, (old = []) => old.filter((n) => n.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}
