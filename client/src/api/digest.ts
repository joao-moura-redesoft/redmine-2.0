import { createAuthedClient } from './client';

const api = createAuthedClient();

export interface Digest {
  name: string;
  headline: string;
  lines: string[];
  counts: {
    assigned: number;
    toReview: number;
    overdue: number;
    dueToday: number;
    doneRecently: number;
  };
  generatedAt: number;
  ai: boolean;
}

// Último digest já gerado (pelo agendador ou por "gerar agora"). Pode ser null.
export async function getLatestDigest(): Promise<Digest | null> {
  const { data } = await api.get<Digest | null>('/digest/latest');
  return data;
}

// Gera o digest na hora (server-side) e devolve o resultado.
export async function runDigest(): Promise<Digest> {
  const { data } = await api.post<Digest>('/digest/run');
  return data;
}
