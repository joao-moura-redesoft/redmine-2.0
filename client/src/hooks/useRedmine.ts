import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { redmineApi, type Upload } from '../api/redmine';
import type { Issue, Version } from '../types/redmine';
import { useLocalWatches } from '../utils/localWatches';
import { recordMutation } from '../utils/recentMutations';

export function useCurrentUser() {
  return useQuery({ queryKey: ['currentUser'], queryFn: redmineApi.getCurrentUser });
}

export function useStatuses() {
  return useQuery({
    queryKey: ['statuses'],
    queryFn: redmineApi.getStatuses,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: redmineApi.getProjects,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTrackers() {
  return useQuery({
    queryKey: ['trackers'],
    queryFn: redmineApi.getTrackers,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePriorities() {
  return useQuery({
    queryKey: ['priorities'],
    queryFn: redmineApi.getPriorities,
    staleTime: 5 * 60 * 1000,
  });
}

// Campos personalizados distintos vistos nas tarefas do usuário. Derivado das
// issues atribuídas (o endpoint /custom_fields do Redmine é admin-only e dá 403
// com key não-admin), então listamos o que aparece de fato nas tarefas.
export function useCustomFieldDefs() {
  return useQuery({
    queryKey: ['custom-field-defs'],
    queryFn: async () => {
      const issues = await redmineApi.getIssues();
      const map = new Map<number, string>();
      for (const it of issues)
        for (const cf of it.custom_fields ?? []) if (!map.has(cf.id)) map.set(cf.id, cf.name);
      return [...map.entries()].map(([id, name]) => ({ id, name }));
    },
    staleTime: 5 * 60 * 1000,
  });
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
    enabled: id !== null,
  });
}

// Transições de workflow permitidas — query separada e sob demanda (não bloqueia
// o load da tarefa). A chave de cache são os DETERMINANTES do workflow (não o
// issueId): tarefas no mesmo projeto/tracker/status/papel compartilham o
// resultado, evitando 1 request por tarefa. `enabled` controla quando dispara.
export interface WorkflowKey {
  issueId: number | null;
  projectId?: number;
  trackerId?: number;
  statusId?: number;
  isAuthor?: boolean;
  isAssignee?: boolean;
}
export function useAllowedStatuses(wf: WorkflowKey, enabled: boolean) {
  const { issueId, projectId, trackerId, statusId, isAuthor, isAssignee } = wf;
  return useQuery({
    queryKey: ['allowedStatuses', projectId, trackerId, statusId, isAuthor, isAssignee],
    queryFn: () =>
      redmineApi.getAllowedStatuses(issueId!, {
        projectId,
        trackerId,
        statusId,
        isAuthor,
        isAssignee,
      }),
    enabled: enabled && issueId !== null && statusId !== undefined,
    staleTime: 10 * 60 * 1000, // workflow muda raríssimas vezes
  });
}

// Schema dos campos editáveis — só buscado quando um 422 de obrigatório acontece.
// Cacheado por projeto+tracker (estrutura de campos depende disso).
export function useEditFields(
  wf: { issueId: number | null; projectId?: number; trackerId?: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['editFields', wf.projectId, wf.trackerId],
    queryFn: () =>
      redmineApi.getEditFields(wf.issueId!, { projectId: wf.projectId, trackerId: wf.trackerId }),
    enabled: enabled && wf.issueId !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, statusId }: { id: number; statusId: number }) =>
      redmineApi.updateIssueStatus(id, statusId),
    onSuccess: (_, { id }) => {
      recordMutation(id);
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes, uploads }: { id: number; notes: string; uploads?: Upload[] }) =>
      redmineApi.addNote(id, notes, uploads),
    onSuccess: (_, { id }) => {
      recordMutation(id);
      qc.invalidateQueries({ queryKey: ['issue', id] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

export function useUpdateJournal(issueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      redmineApi.updateJournal(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issue', issueId] }),
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: redmineApi.createIssue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues'] }),
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

export function useIssuesByIds(ids: number[]) {
  return useQuery({
    queryKey: ['issues-by-ids', [...ids].sort((a, b) => a - b)],
    queryFn: () => redmineApi.getIssuesByIds(ids),
    enabled: ids.length > 0,
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
    refetchIntervalInBackground: true,
  });
}

export function useProjectIssues(projectId?: number) {
  return useQuery({
    queryKey: ['issues-by-project', projectId ?? 'all'],
    queryFn: () => redmineApi.getProjectIssues(projectId),
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
    staleTime: 10 * 60 * 1000,
  });
}

// Membros de todos os projetos unificados (opção "Todos os projetos" em Pessoas)
export function useAllMembers(enabled = true) {
  return useQuery({
    queryKey: ['members-all'],
    queryFn: redmineApi.getAllMembers,
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      redmineApi.updateIssue(id, fields),
    onSuccess: (_, { id }) => {
      recordMutation(id);
      qc.invalidateQueries({ queryKey: ['issue', id] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

// Edição rápida (inline) com update OTIMISTA: corrige o cache na hora (sem esperar
// o refetch) em TODAS as listas de issues + na tarefa aberta, com rollback no erro.
// `optimistic` é o patch visual (ex.: { status: {id,name} }); `fields` é o que vai
// pra API (ex.: { status_id }).
function isIssueListKey(key: readonly unknown[]): boolean {
  return key[0] === 'issues' || (typeof key[0] === 'string' && key[0].startsWith('issues-'));
}
export function useQuickEditIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number;
      fields: Record<string, unknown>;
      optimistic?: Partial<Issue>;
    }) => redmineApi.updateIssue(id, fields),
    onMutate: async ({ id, optimistic }) => {
      const snapshots: [readonly unknown[], unknown][] = [];
      if (!optimistic) return { snapshots };
      await qc.cancelQueries();
      qc.getQueriesData<Issue[]>({ predicate: (q) => isIssueListKey(q.queryKey) }).forEach(
        ([key, data]) => {
          if (!Array.isArray(data)) return;
          snapshots.push([key, data]);
          qc.setQueryData(
            key,
            data.map((it) => (it.id === id ? { ...it, ...optimistic } : it)),
          );
        },
      );
      const singleKey = ['issue', id] as const;
      const prev = qc.getQueryData<Issue>(singleKey);
      if (prev) {
        snapshots.push([singleKey, prev]);
        qc.setQueryData(singleKey, { ...prev, ...optimistic });
      }
      return { snapshots };
    },
    onError: (_e, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: (_d, _e, { id }) => {
      recordMutation(id);
      qc.invalidateQueries({ queryKey: ['issue', id] });
      qc.invalidateQueries({ predicate: (q) => isIssueListKey(q.queryKey) });
    },
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

// `issueId` não é enviado ao Redmine — serve só para invalidar as queries da
// tarefa afetada (horas gastas no card, lista de registros do modal).
export function useUpdateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: number;
      issueId?: number;
      hours?: number;
      activity_id?: number;
      comments?: string;
      spent_on?: string;
    }) =>
      redmineApi.updateTimeEntry(vars.id, {
        hours: vars.hours,
        activity_id: vars.activity_id,
        comments: vars.comments,
        spent_on: vars.spent_on,
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['time-entries'] });
      if (vars.issueId) {
        qc.invalidateQueries({ queryKey: ['time-entries-issue', vars.issueId] });
        qc.invalidateQueries({ queryKey: ['issue', vars.issueId] });
      }
    },
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; issueId?: number }) => redmineApi.deleteTimeEntry(id),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['time-entries'] });
      if (vars.issueId) {
        qc.invalidateQueries({ queryKey: ['time-entries-issue', vars.issueId] });
        qc.invalidateQueries({ queryKey: ['issue', vars.issueId] });
      }
    },
  });
}

export function useMentions() {
  return useQuery({
    queryKey: ['issues-mentions'],
    queryFn: redmineApi.getMentions,
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: true,
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

// Versões de vários projetos em paralelo (uma query por projeto, mesma cache
// key de useProjectVersions). Devolve por projeto consultado — versões
// compartilhadas aparecem na lista de cada projeto que as recebe.
export function useAllVersions(projectIds: number[]) {
  const results = useQueries({
    queries: projectIds.map((pid) => ({
      queryKey: ['versions', pid],
      queryFn: () => redmineApi.getProjectVersions(pid),
      enabled: !!pid,
      staleTime: 5 * 60 * 1000,
    })),
  });
  const isLoading = results.some((r) => r.isLoading);
  const byProject = projectIds.map((projectId, i) => ({
    projectId,
    versions: (results[i]?.data ?? []) as Version[],
  }));
  return { byProject, isLoading };
}

// Tarefas de várias versões em paralelo, buscando a versão INTEIRA (sem filtro
// de projeto — cobre versões compartilhadas). Devolve um mapa versionId →
// tarefas e um índice issueId → Issue para lookups no drag.
export function useVersionIssuesMulti(versionIds: number[]) {
  const results = useQueries({
    queries: versionIds.map((vid) => ({
      queryKey: ['roadmap-version-issues', vid],
      queryFn: () => redmineApi.getVersionIssuesAll(vid),
      staleTime: 60 * 1000,
    })),
  });
  const byVersion = new Map<number, Issue[]>();
  const issueById = new Map<number, Issue>();
  versionIds.forEach((vid, i) => {
    const issues = (results[i]?.data ?? []) as Issue[];
    byVersion.set(vid, issues);
    for (const issue of issues) issueById.set(issue.id, issue);
  });
  const isLoading = results.some((r) => r.isLoading);
  return { byVersion, issueById, isLoading };
}
