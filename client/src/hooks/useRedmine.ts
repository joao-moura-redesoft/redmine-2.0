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
    refetchInterval: 60 * 1000,
    // Mantém o polling rodando mesmo com a aba minimizada/em segundo plano,
    // para que as notificações de novas atribuições continuem disparando.
    refetchIntervalInBackground: true,
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
    refetchIntervalInBackground: true,
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
    refetchIntervalInBackground: true,
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
    refetchIntervalInBackground: true,
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

export function useTimeEntries(params: { from?: string; to?: string; issue_id?: number } = {}) {
  return useQuery({
    queryKey: ['time-entries', params],
    queryFn: () => redmineApi.getTimeEntries(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useIssueTimeEntries(issueId?: number) {
  return useQuery({
    queryKey: ['time-entries-issue', issueId],
    queryFn: () => redmineApi.getTimeEntries({ issue_id: issueId! }),
    enabled: !!issueId,
    staleTime: 60 * 1000,
  });
}

export function useTimeEntryActivities() {
  return useQuery({
    queryKey: ['time-entry-activities'],
    queryFn: redmineApi.getTimeEntryActivities,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: redmineApi.createTimeEntry,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['time-entries'] });
      qc.invalidateQueries({ queryKey: ['time-entries-issue', vars.issue_id] });
      qc.invalidateQueries({ queryKey: ['issue', vars.issue_id] });
    },
  });
}

export function useProjectVersions(projectId?: number) {
  return useQuery({
    queryKey: ['versions', projectId],
    queryFn: () => redmineApi.getProjectVersions(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useVersionIssues(projectId?: number, versionId?: number) {
  return useQuery({
    queryKey: ['version-issues', projectId, versionId],
    queryFn: () => redmineApi.getVersionIssues(projectId!, versionId!),
    enabled: !!projectId && !!versionId,
    staleTime: 60 * 1000,
  });
}
