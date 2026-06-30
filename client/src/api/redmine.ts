import axios from 'axios';
import type {
  Issue,
  IssueStatus,
  Project,
  Tracker,
  Priority,
  CurrentUser,
  Version,
  TimeEntry,
  TimeEntryActivity,
  Mention,
  NamedRef,
  EditField,
} from '../types/redmine';
import { aiConfigured, hasOpenAIKey } from '../utils/aiConfig';

export const AUTH_KEY = 'redmine_auth';

export interface RedmineAuth {
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface Upload {
  token: string;
  filename: string;
  content_type: string;
}

export function getStoredAuth(): RedmineAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.url) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuth(auth: RedmineAuth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

/** Retorna vazio, pois agora a autenticação é via Cookie HttpOnly no Backend */
export function authHeaders(): Record<string, string> {
  return {};
}

// Token de sessão por usuário para URLs de anexo (substitui o lastAuth global).
let _sessionToken: string | null = null;

export async function initSession(): Promise<void> {
  const auth = getStoredAuth();
  if (!auth) return;
  try {
    const { data } = await axios.post('/api/attachments/session');
    _sessionToken = data.token ?? null;
  } catch {
    /* silencioso; imagens de anexo retornarão 401 */
  }
}

export function attachmentUrl(id: number, filename: string): string {
  const base = `/api/attachments/${id}/${encodeURIComponent(filename)}`;
  return _sessionToken ? `${base}?s=${_sessionToken}` : base;
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.dispatchEvent(new Event('auth-expired'));
    }
    return Promise.reject(err);
  },
);

export const redmineApi = {
  getIssues: async (projectId?: number): Promise<Issue[]> => {
    const params: Record<string, unknown> = { assigned_to_id: 'me', status_id: '*', limit: 100 };
    if (projectId) params.project_id = projectId;
    const { data } = await api.get('/issues', { params });
    return data.issues;
  },

  getIssue: async (id: number): Promise<Issue> => {
    const { data } = await api.get(`/issues/${id}`);
    return data.issue;
  },

  // Transições de workflow permitidas (buscado sob demanda; null = sem restrição conhecida).
  // Os determinantes do workflow vão como params para o backend cachear por
  // (projeto/tracker/status/autor/responsável), e não por tarefa.
  getAllowedStatuses: async (
    id: number,
    wf: {
      projectId?: number;
      trackerId?: number;
      statusId?: number;
      isAuthor?: boolean;
      isAssignee?: boolean;
    },
  ): Promise<NamedRef[] | null> => {
    const { data } = await api.get(`/issues/${id}/allowed-statuses`, {
      params: {
        project_id: wf.projectId,
        tracker_id: wf.trackerId,
        status_id: wf.statusId,
        is_author: wf.isAuthor ? 1 : 0,
        is_assignee: wf.isAssignee ? 1 : 0,
      },
    });
    return data.allowed_statuses ?? null;
  },

  // Schema dos campos editáveis (para o popup de campos obrigatórios).
  getEditFields: async (
    id: number,
    wf: { projectId?: number; trackerId?: number },
  ): Promise<EditField[]> => {
    const { data } = await api.get(`/issues/${id}/edit-fields`, {
      params: { project_id: wf.projectId, tracker_id: wf.trackerId },
    });
    return data.fields ?? [];
  },

  updateIssueStatus: async (id: number, statusId: number): Promise<void> => {
    await api.put(`/issues/${id}`, { issue: { status_id: statusId } });
  },

  updateIssue: async (id: number, fields: Record<string, unknown>): Promise<void> => {
    await api.put(`/issues/${id}`, { issue: fields });
  },

  addNote: async (id: number, notes: string, uploads?: Upload[]): Promise<void> => {
    const issue: Record<string, unknown> = { notes };
    if (uploads && uploads.length) issue.uploads = uploads;
    await api.put(`/issues/${id}`, { issue });
  },

  searchIssues: async (q: string): Promise<{ id: number; subject: string }[]> => {
    const { data } = await api.get('/search', { params: { q } });
    return (data.issues ?? []).map((i: { id: number; subject: string }) => ({
      id: i.id,
      subject: i.subject,
    }));
  },

  updateJournal: async (id: number, notes: string): Promise<void> => {
    await api.put(`/journals/${id}`, { journal: { notes } });
  },

  uploadFile: async (file: File): Promise<Upload> => {
    const buf = await file.arrayBuffer();
    const { data } = await api.post('/uploads', buf, {
      params: { filename: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    return {
      token: data.token,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
    };
  },

  createIssue: async (payload: {
    subject: string;
    project_id: number;
    tracker_id?: number;
    priority_id?: number;
    description?: string;
    assigned_to_id?: number;
    uploads?: Upload[];
  }): Promise<Issue> => {
    const { data } = await api.post('/issues', { issue: payload });
    return data.issue;
  },

  getStatuses: async (): Promise<IssueStatus[]> => {
    const { data } = await api.get('/issue_statuses');
    return data.issue_statuses;
  },

  getProjects: async (): Promise<Project[]> => {
    const { data } = await api.get('/projects');
    return data.projects;
  },

  getTrackers: async (): Promise<Tracker[]> => {
    const { data } = await api.get('/trackers');
    return data.trackers;
  },

  getPriorities: async (): Promise<Priority[]> => {
    const { data } = await api.get('/enumerations/issue_priorities');
    return data.issue_priorities;
  },

  getCurrentUser: async (): Promise<CurrentUser> => {
    const { data } = await api.get('/users/current');
    return data.user;
  },

  getMonitoredIssues: async (): Promise<Issue[]> => {
    const { data } = await api.get('/issues/monitored');
    return data.issues;
  },

  getAuthoredIssues: async (): Promise<Issue[]> => {
    const { data } = await api.get('/issues/authored');
    return data.issues;
  },

  getCompletedIssues: async (): Promise<Issue[]> => {
    const { data } = await api.get('/issues/completed');
    return data.issues;
  },

  getToReviewIssues: async (): Promise<Issue[]> => {
    const { data } = await api.get('/issues/to-review');
    return data.issues;
  },

  getProjectIssues: async (projectId?: number): Promise<Issue[]> => {
    const params: Record<string, unknown> = {};
    if (projectId) params.project_id = projectId;
    const { data } = await api.get('/issues/by-project', { params });
    return data.issues;
  },

  getIssuesByIds: async (ids: number[]): Promise<Issue[]> => {
    if (!ids.length) return [];
    const { data } = await api.get('/issues/by-ids', {
      params: { ids: ids.join(',') },
    });
    return data.issues;
  },

  getUserIssues: async (userId: number): Promise<Issue[]> => {
    const { data } = await api.get('/issues', {
      params: { assigned_to_id: userId, status_id: 'open', limit: 100 },
    });
    return data.issues;
  },

  search: async (q: string): Promise<Issue[]> => {
    const { data } = await api.get('/search', { params: { q } });
    return data.issues;
  },

  getProjectMembers: async (
    projectId: number,
  ): Promise<{ id: number; name: string; team: string }[]> => {
    const { data } = await api.get(`/projects/${projectId}/memberships`);
    return data.users;
  },

  getAllMembers: async (): Promise<{ id: number; name: string; team: string }[]> => {
    const { data } = await api.get('/members');
    return data.users;
  },

  getTimeEntries: async (
    params: {
      from?: string;
      to?: string;
      issue_id?: number;
    } = {},
  ): Promise<TimeEntry[]> => {
    const { data } = await api.get('/time_entries', { params });
    return data.time_entries ?? [];
  },

  createTimeEntry: async (entry: {
    issue_id: number;
    hours: number;
    activity_id: number;
    comments?: string;
    spent_on?: string;
  }): Promise<TimeEntry> => {
    const { data } = await api.post('/time_entries', { time_entry: entry });
    return data.time_entry;
  },

  getTimeEntryActivities: async (): Promise<TimeEntryActivity[]> => {
    const { data } = await api.get('/enumerations/time_entry_activities');
    return data.time_entry_activities ?? [];
  },

  getProjectVersions: async (projectId: number): Promise<Version[]> => {
    const { data } = await api.get(`/projects/${projectId}/versions`);
    return (data.versions ?? []).sort((a: Version, b: Version) =>
      a.name.localeCompare(b.name, 'pt-BR'),
    );
  },

  getVersionIssues: async (projectId: number, versionId: number): Promise<Issue[]> => {
    const { data } = await api.get('/issues/by-version', {
      params: { project_id: projectId, version_id: versionId },
    });
    return data.issues ?? [];
  },

  getMentions: async (): Promise<Mention[]> => {
    const { data } = await api.get('/issues/mentions');
    return data.mentions ?? [];
  },

  weeklyDigest: async (open: Issue[], completed: Issue[]): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/weekly-digest', { open, completed });
    return data.digest as string;
  },

  // ── IA ────────────────────────────────────────────────────────────────
  getAIStatus: async (): Promise<{ configured: boolean }> => {
    const { data } = await api.get('/ai/status');
    return data;
  },

  // ── IA ────────────────────────────────────────────────────────────────
  generatePrompt: async (issue: Issue): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/generate-prompt', { issue });
    return data.prompt as string;
  },

  quickSummary: async (issue: Issue): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/quick', { issue });
    return data.oneLiner as string;
  },

  summarizeHistory: async (issue: Issue): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/summarize-history', { issue });
    return data.summary as string;
  },

  draftNote: async (issue: Issue): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/draft-note', { issue });
    return data.draft as string;
  },

  aiChat: async (
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<{ reply: string; trace: { tool: string; args: unknown }[] }> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/chat', { messages });
    return data;
  },

  draftReply: async (issue: Issue, instruction?: string): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/draft-reply', { issue, instruction });
    return data.reply as string;
  },

  detectAmbiguities: async (
    issue: Issue,
  ): Promise<{
    hasIssues: boolean;
    ambiguities: { trecho: string; problema: string; pergunta: string }[];
  }> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/detect-ambiguities', { issue });
    return data;
  },

  suggestVersionNote: async (issue: Issue): Promise<{ notes: string[]; reasoning: string }> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/suggest-version-note', { issue });
    return data;
  },

  assessComplexity: async (
    issue: Issue,
  ): Promise<{ level: string; reasoning: string; risks: string[]; roughHours: string }> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/assess-complexity', { issue });
    return data;
  },

  reviewChecklist: async (issue: Issue): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/review-checklist', { issue });
    return data.checklist as string;
  },

  suggestFields: async (
    subject: string,
    description: string,
    trackers: { id: number; name: string }[],
    priorities: { id: number; name: string }[],
  ): Promise<{
    tracker_id: number | null;
    priority_id: number | null;
    impacto: string | null;
    reasoning: string;
  }> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/suggest-fields', {
      subject,
      description,
      trackers,
      priorities,
    });
    return data;
  },

  reviewNote: async (
    noteText: string,
    issueSubject: string,
    issueStatus: string,
  ): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/review-note', { noteText, issueSubject, issueStatus });
    return data.feedback as string;
  },

  standup: async (issues: Issue[]): Promise<string> => {
    if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
    const { data } = await api.post('/ai/standup', { issues });
    return data.standup as string;
  },

  transcribeSummarize: async (
    audioBlob: Blob,
    filename: string,
    title: string,
    participants: string,
  ): Promise<{ transcript: string; summary: string }> => {
    if (!hasOpenAIKey())
      throw new Error(
        'A transcrição exige uma chave da OpenAI (Whisper) configurada nas configurações de IA.',
      );

    // Chaves de IA resolvidas no servidor (cofre). O cliente só envia metadados.
    const { data } = await api.post('/ai/transcribe-summarize', audioBlob, {
      headers: {
        'x-filename': encodeURIComponent(filename),
        'x-meeting-title': encodeURIComponent(title),
        'x-meeting-participants': encodeURIComponent(participants),
        'Content-Type': audioBlob.type || 'audio/webm',
      },
      timeout: 300000, // 5 minutes for large audio processing
    });
    return data;
  },

  // ── Web Push ──────────────────────────────────────────────────────────
  getVapidPublicKey: async (): Promise<string> => {
    const { data } = await api.get('/push/vapid-public-key');
    return data.publicKey;
  },

  subscribePush: async (
    subscription: PushSubscriptionJSON,
    talkPrefs?: { groupMentionsOnly: boolean; realtime: boolean } | null,
  ): Promise<void> => {
    await api.post('/push/subscribe', { subscription, talkPrefs: talkPrefs ?? null });
  },

  unsubscribePush: async (endpoint: string): Promise<void> => {
    await api.post('/push/unsubscribe', { endpoint });
  },
};
