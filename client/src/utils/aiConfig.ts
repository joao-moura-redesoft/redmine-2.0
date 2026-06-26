// Chaves de IA — agora vivem no cofre cifrado do servidor. O cliente só conhece
// QUAIS provedores estão configurados (status booleano), nunca as chaves.
import axios from 'axios';
import { getSecretsStatus, refreshSecretsStatus } from './secretsStatus';

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export function getConfiguredProviders(): { anthropic: boolean; openai: boolean; gemini: boolean } {
  return getSecretsStatus().ai;
}

export function aiConfigured(): boolean {
  const ai = getSecretsStatus().ai;
  return !!(ai.anthropic || ai.openai || ai.gemini);
}

// Provider ativo (precedência Claude > OpenAI > Gemini), sem expor a chave.
export function getActiveAIProvider(): AIProvider | null {
  const ai = getSecretsStatus().ai;
  if (ai.anthropic) return 'anthropic';
  if (ai.openai) return 'openai';
  if (ai.gemini) return 'gemini';
  return null;
}

export function hasOpenAIKey(): boolean {
  return getSecretsStatus().ai.openai;
}

// Compat: gating booleano usado por vários componentes. A chave real está no
// servidor — aqui devolvemos só um marcador de "configurado".
export function getAIKey(): string | null {
  return aiConfigured() ? 'configured' : null;
}

export async function saveAIKey(provider: AIProvider, key: string): Promise<void> {
  await axios.put(`/api/secrets/ai/${provider}`, { key: key.trim() });
  await refreshSecretsStatus();
}

export async function clearAIKey(provider: AIProvider): Promise<void> {
  await axios.delete(`/api/secrets/ai/${provider}`);
  await refreshSecretsStatus();
}

// Migração: sobe chaves antigas do localStorage pro cofre e apaga.
export async function migrateLegacyAIKeys(): Promise<void> {
  try {
    const raw = localStorage.getItem('rk_ai_keys');
    if (!raw) return;
    const keys = JSON.parse(raw) as Partial<Record<AIProvider, string>>;
    const status = getSecretsStatus().ai;
    for (const p of ['anthropic', 'openai', 'gemini'] as AIProvider[]) {
      if (keys[p] && !status[p]) await saveAIKey(p, keys[p] as string);
    }
    localStorage.removeItem('rk_ai_keys');
  } catch { /* ignora */ }
}
