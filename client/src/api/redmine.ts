import axios from 'axios';
import type { Issue, IssueStatus, Project, Tracker, Priority, CurrentUser } from '../types/redmine';

export const AUTH_KEY = 'redmine_auth';

export interface RedmineAuth {
  url: string;
  apiKey: string;
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
    if (parsed?.url && parsed?.apiKey) return parsed;
    return null;
  } catch { return null; }
}

export function saveAuth(auth: RedmineAuth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

const api = axios.create({ baseURL: '/api' });

// Injeta as credenciais em cada request
api.interceptors.request.use(config => {
  const auth = getStoredAuth();
  if (auth) {
    config.headers['X-Redmine-Url'] = auth.url;
    config.headers['X-Redmine-Key'] = auth.apiKey;
  }
  return config;
});

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

  uploadFile: async (file: File): Promise<Upload> => {
    const buf = await file.arrayBuffer();
    const { data } = await api.post('/uploads', buf, {
      params: { filename: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    return { token: data.token, filename: file.name, content_type: file.type || 'application/octet-stream' };
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

  getProjectIssues: async (projectId: number): Promise<Issue[]> => {
    const { data } = await api.get('/issues/by-project', { params: { project_id: projectId } });
    return data.issues;
  },

  getIssuesByIds: async (ids: number[]): Promise<Issue[]> => {
    if (!ids.length) return [];
    const { data } = await api.get('/issues/by-ids', {
      params: { ids: ids.join(',') }
    });
    return data.issues;
  },

  getUserIssues: async (userId: number): Promise<Issue[]> => {
    const { data } = await api.get('/issues', {
      params: { assigned_to_id: userId, status_id: 'open', limit: 100 }
    });
    return data.issues;
  },

  search: async (q: string): Promise<Issue[]> => {
    const { data } = await api.get('/search', { params: { q } });
    return data.issues;
  },

  getProjectMembers: async (projectId: number): Promise<{ id: number; name: string; team: string }[]> => {
    const { data } = await api.get(`/projects/${projectId}/memberships`);
    return data.users;
  },

  getAllMembers: async (): Promise<{ id: number; name: string; team: string }[]> => {
    const { data } = await api.get('/members');
    return data.users;
  }
};
