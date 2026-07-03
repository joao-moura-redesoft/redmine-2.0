// Status do cofre de segredos server-side (o que está configurado, sem os
// segredos em si). Cacheado em memória para gating síncrono na UI; atualizado
// no login e após cada gravação/remoção.
import axios from 'axios';

export interface SecretsStatus {
  ad: boolean;
  ai: { anthropic: boolean; openai: boolean; gemini: boolean; local: boolean };
  totpCount: number;
}

const EMPTY: SecretsStatus = {
  ad: false,
  ai: { anthropic: false, openai: false, gemini: false, local: false },
  totpCount: 0,
};
// Cache booleano de "o que está configurado" — NÃO contém segredos, só flags.
// Persistido em localStorage para o gating funcionar de imediato no reload
// (evita flash de "credenciais necessárias" antes do fetch).
const LS_KEY = 'rk_secrets_status';
function loadCache(): SecretsStatus {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') };
  } catch {
    return EMPTY;
  }
}
let cache: SecretsStatus = loadCache();
const listeners = new Set<() => void>();

export function getSecretsStatus(): SecretsStatus {
  return cache;
}

export async function refreshSecretsStatus(): Promise<SecretsStatus> {
  try {
    const { data } = await axios.get<SecretsStatus>('/api/secrets/status');
    cache = data;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* quota */
    }
  } catch {
    /* mantém o cache atual */
  }
  listeners.forEach((l) => l());
  return cache;
}

export function resetSecretsStatus() {
  cache = EMPTY;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

// Permite componentes re-renderizarem quando o status muda.
export function onSecretsStatusChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
