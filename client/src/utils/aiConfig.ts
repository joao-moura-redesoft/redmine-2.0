export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface AIKeys {
  anthropic?: string;
  openai?: string;
  gemini?: string;
}

const STORAGE_KEY = 'rk_ai_keys';

function load(): AIKeys {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function getAIKeys(): AIKeys {
  return load();
}

export function saveAIKey(provider: AIProvider, key: string) {
  const keys = load();
  keys[provider] = key.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function clearAIKey(provider: AIProvider) {
  const keys = load();
  delete keys[provider];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

/** Retorna o provedor ativo e a key (Claude preferido, depois OpenAI, depois Gemini). */
export function getActiveAI(): { provider: AIProvider; key: string } | null {
  const keys = load();
  if (keys.anthropic) return { provider: 'anthropic', key: keys.anthropic };
  if (keys.openai)    return { provider: 'openai',    key: keys.openai    };
  if (keys.gemini)    return { provider: 'gemini',    key: keys.gemini    };
  return null;
}

// Retrocompatibilidade — usado pelo IssueAIPanel para checar se há algo configurado.
export function getAIKey(): string | null {
  return getActiveAI()?.key ?? null;
}
