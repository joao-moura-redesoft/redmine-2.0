import { createAuthedClient } from './client';

// "Projeto" pessoal que agrupa sprints em raias (não é projeto do Redmine).
export interface Board {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

export type BoardPatch = Partial<Pick<Board, 'name' | 'color'>>;

export const newBoardId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const api = createAuthedClient();

export async function fetchBoards(): Promise<Board[]> {
  const { data } = await api.get<Board[]>('/boards');
  return data;
}

export async function createBoard(patch: BoardPatch & { id?: string } = {}): Promise<Board> {
  const { data } = await api.post<Board>('/boards', patch);
  return data;
}

export async function updateBoard(id: string, patch: BoardPatch): Promise<Board> {
  const { data } = await api.put<Board>(`/boards/${id}`, patch);
  return data;
}

export async function deleteBoard(id: string): Promise<void> {
  await api.delete(`/boards/${id}`);
}
