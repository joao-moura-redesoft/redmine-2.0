import { createAuthedClient } from './client';

export type SprintStatus = 'planned' | 'active' | 'closed';

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  status: SprintStatus;
  boardId: string | null; // "projeto" pessoal ao qual pertence (ou null)
  issueIds: number[];
  createdAt: number;
  updatedAt: number;
}

export type SprintPatch = Partial<
  Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate' | 'status' | 'boardId' | 'issueIds'>
>;

// Id gerado no cliente para criação otimista (sem flicker nem troca de id).
export const newSprintId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const api = createAuthedClient();

export async function fetchSprints(): Promise<Sprint[]> {
  const { data } = await api.get<Sprint[]>('/sprints');
  return data;
}

export async function createSprint(patch: SprintPatch & { id?: string } = {}): Promise<Sprint> {
  const { data } = await api.post<Sprint>('/sprints', patch);
  return data;
}

export async function updateSprint(id: string, patch: SprintPatch): Promise<Sprint> {
  const { data } = await api.put<Sprint>(`/sprints/${id}`, patch);
  return data;
}

export async function deleteSprint(id: string): Promise<void> {
  await api.delete(`/sprints/${id}`);
}

export async function reorderSprints(ids: string[]): Promise<Sprint[]> {
  const { data } = await api.put<Sprint[]>('/sprints/order', { ids });
  return data;
}

export async function addIssueToSprint(id: string, issueId: number): Promise<Sprint> {
  const { data } = await api.post<Sprint>(`/sprints/${id}/issues`, { issueId });
  return data;
}

export async function removeIssueFromSprint(id: string, issueId: number): Promise<Sprint> {
  const { data } = await api.delete<Sprint>(`/sprints/${id}/issues/${issueId}`);
  return data;
}
