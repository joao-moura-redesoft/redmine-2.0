import { getStoredAuth } from '../api/redmine';

const KEY = 'rk_ad_creds';

export interface ADCreds { username: string; password: string; }

export function getADCreds(): ADCreds | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.username && p?.password) return p;
    }
    // Migração: credenciais antigas salvas dentro de rk_mail_config
    const old = JSON.parse(localStorage.getItem('rk_mail_config') || '{}');
    if (old?.user && old?.password) {
      const creds: ADCreds = { username: old.user, password: old.password };
      saveADCreds(creds);
      return creds;
    }
    return null;
  } catch { return null; }
}

export function saveADCreds(creds: ADCreds) {
  localStorage.setItem(KEY, JSON.stringify({ username: creds.username.trim(), password: creds.password }));
}

export function clearADCreds() {
  localStorage.removeItem(KEY);
}

// Credenciais efetivas: login Redmine user/pass tem prioridade; senão, config manual
export function getEffectiveCreds(): ADCreds | null {
  const auth = getStoredAuth();
  if (auth?.username && auth?.password) return { username: auth.username, password: auth.password };
  return getADCreds();
}

export function hasEffectiveCreds(): boolean {
  return getEffectiveCreds() !== null;
}

// True quando logado só por API key e ainda sem creds manuais configuradas
export function needsADCreds(): boolean {
  const auth = getStoredAuth();
  if (auth?.username && auth?.password) return false;
  return !getADCreds();
}
