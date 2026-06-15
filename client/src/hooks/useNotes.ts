import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchNotes, createNote, updateNote, deleteNote, type Note, type NotePatch } from '../api/notes';
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
    mutationFn: (patch: NotePatch = {}) => createNote(patch),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old = []) => [note, ...old]);
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
        old.map(n => n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n));
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
      qc.setQueryData<Note[]>(KEY, (old = []) => old.filter(n => n.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}
