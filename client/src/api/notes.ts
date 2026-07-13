import axios from 'axios';
import { getStoredAuth } from './redmine';
import { createAuthedClient } from './client';

export interface Note {
  id: string;
  title: string;
  body: string; // markdown
  tags: string[];
  pinned: boolean;
  color: string | null;
  linkedIssueId: number | null;
  linkedProjectId: number | null;
  createdAt: number;
  updatedAt: number;
  // Notas vindas do Nextcloud (app Notes) são mescladas na mesma lista com estes
  // campos extras. Ausentes/'local' nas notas locais — o código local os ignora.
  source?: 'local' | 'nextcloud';
  ncId?: number | null; // id numérico no Nextcloud
  etag?: string; // reservado p/ controle de concorrência (não usado no QuickNotes)
  readonly?: boolean; // notas do Nextcloud somente-leitura (se aplicável)
  category?: string; // reservado (sem equivalente no QuickNotes)
  ncColor?: string | null; // cor real (hex) da nota no QuickNotes
}

export type NotePatch = Partial<
  Pick<Note, 'title' | 'body' | 'tags' | 'pinned' | 'color' | 'linkedIssueId' | 'linkedProjectId'>
>;

// Id gerado no cliente para permitir criação otimista (sem flicker nem troca
// de id quando o servidor responde).
export const newNoteId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const api = createAuthedClient();

export async function fetchNotes(): Promise<Note[]> {
  const { data } = await api.get<Note[]>('/notes');
  return data;
}

export async function createNote(patch: NotePatch & { id?: string } = {}): Promise<Note> {
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
