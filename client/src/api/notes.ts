import axios from 'axios';
import { getStoredAuth } from './redmine';

export interface Note {
  id: string;
  title: string;
  body: string;            // markdown
  tags: string[];
  pinned: boolean;
  color: string | null;
  linkedIssueId: number | null;
  linkedProjectId: number | null;
  createdAt: number;
  updatedAt: number;
}

export type NotePatch = Partial<Pick<Note,
  'title' | 'body' | 'tags' | 'pinned' | 'color' | 'linkedIssueId' | 'linkedProjectId'>>;

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const auth = getStoredAuth();
  if (auth) {
    config.headers['X-Redmine-Url'] = auth.url;
    config.headers['X-Redmine-Key'] = auth.apiKey;
  }
  return config;
});

export async function fetchNotes(): Promise<Note[]> {
  const { data } = await api.get<Note[]>('/notes');
  return data;
}

export async function createNote(patch: NotePatch = {}): Promise<Note> {
  const { data } = await api.post<Note>('/notes', patch);
  return data;
}

export async function updateNote(id: string, patch: NotePatch): Promise<Note> {
  const { data } = await api.put<Note>(`/notes/${id}`, patch);
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  await api.delete(`/notes/${id}`);
}
