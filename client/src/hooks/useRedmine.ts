import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { redmineApi, type Upload } from '../api/redmine';
import { useLocalWatches } from '../utils/localWatches';

export function useCurrentUser() {
  return useQuery({ queryKey: ['currentUser'], queryFn: redmineApi.getCurrentUser });
}

export function useStatuses() {
  return useQuery({ queryKey: ['statuses'], queryFn: redmineApi.getStatuses, staleTime: 5 * 60 * 1000 });
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: redmineApi.getProjects, staleTime: 5 * 60 * 1000 });
}

export function useTrackers() {
  return useQuery({ queryKey: ['trackers'], queryFn: redmineApi.getTrackers, staleTime: 5 * 60 * 1000 });
}

export function usePriorities() {
  return useQuery({ queryKey: ['priorities'], queryFn: redmineApi.getPriorities, staleTime: 5 * 60 * 1000 });
}

export function useIssues(projectId?: number) {
  return useQuery({
    queryKey: ['issues', projectId],
    queryFn: () => redmineApi.getIssues(projectId),
    refetchInterval: 60 * 1000
  });
}

export function useIssueDetail(id: number | null) {
  return useQuery({
    queryKey: ['issue', id],
    queryFn: () => redmineApi.getIssue(id!),
    enabled: id !== null
  });
}

export function useUpdateIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, statusId }: { id: number; statusId: number }) =>
      redmineApi.updateIssueStatus(id, statusId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues'] })
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes, uploads }: { id: number; notes: string; uploads?: Upload[] }) =>
      redmineApi.addNote(id, notes, uploads),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['issue', id] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    }
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: redmineApi.createIssue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues'] })
  });
}

export function useMonitoredIssues() {
  return useQuery({
    queryKey: ['issues-monitored'],
    queryFn: redmineApi.getMonitoredIssues,
    refetchInterval: 90 * 1000,
  });
}

export function useAuthoredIssues() {
  return useQuery({
    queryKey: ['issues-authored'],
    queryFn: redmineApi.getAuthoredIssues,
    refetchInterval: 90 * 1000,
  });
}

// "Observadas" agora vem da lista local (localStorage), não da API de watchers do
// Redmine. Busca os detalhes das tarefas marcadas pelo ID. A queryKey inclui os IDs,
// então marcar/desmarcar refaz a busca automaticamente.
export function useWatchedIssues() {
  const ids = useLocalWatches();
  return useQuery({
    queryKey: ['issues-watched-local', ids],
    queryFn: () => redmineApi.getIssuesByIds(ids),
    refetchInterval: 90 * 1000,
  });
}

export function useCompletedIssues() {
  return useQuery({
    queryKey: ['issues-completed'],
    queryFn: redmineApi.getCompletedIssues,
    staleTime: 5 * 60 * 1000,
  });
}

export function useToReviewIssues() {
  return useQuery({
    queryKey: ['issues-to-review'],
    queryFn: redmineApi.getToReviewIssues,
    refetchInterval: 90 * 1000,
  });
}

export function useProjectIssues(projectId?: number) {
  return useQuery({
    queryKey: ['issues-by-project', projectId],
    queryFn: () => redmineApi.getProjectIssues(projectId!),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  });
}

export function useUserIssues(userId?: number) {
  return useQuery({
    queryKey: ['issues-user', userId],
    queryFn: () => redmineApi.getUserIssues(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useProjectMembers(projectId?: number) {
  return useQuery({
    queryKey: ['members', projectId],
    queryFn: () => redmineApi.getProjectMembers(projectId!),
    enabled: !!projectId,
    staleTime: 10 * 60 * 1000
  });
}

// Membros de todos os projetos unificados (opção "Todos os projetos" em Pessoas)
export function useAllMembers(enabled = true) {
  return useQuery({
    queryKey: ['members-all'],
    queryFn: redmineApi.getAllMembers,
    enabled,
    staleTime: 10 * 60 * 1000
  });
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      redmineApi.updateIssue(id, fields),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['issue', id] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    }
  });
}
