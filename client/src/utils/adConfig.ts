import axios from 'axios';
import { getStoredAuth } from '../api/redmine';
import { getSecretsStatus, refreshSecretsStatus } from './secretsStatus';

export interface ADCreds {
  username: string;
  password: string;
}

// Grava as credenciais AD no cofre cifrado do servidor (não mais no localStorage).
export async function saveADCreds(creds: ADCreds): Promise<void> {
  await axios.put('/api/secrets/ad', { user: creds.username.trim(), pass: creds.password });
  await refreshSecretsStatus();
}

export async function clearADCreds(): Promise<void> {
  await axios.delete('/api/secrets/ad');
  await refreshSecretsStatus();
}

// Wiki/E-mail disponíveis quando: logado por usuário/senha (o servidor injeta a
// senha do AD a partir da sessão) OU há credenciais AD no cofre.
export function hasEffectiveCreds(): boolean {
  const auth = getStoredAuth();
  if (auth?.username) return true;
  return getSecretsStatus().ad;
}

// True quando logado só por API key e ainda sem credenciais AD no cofre.
export function needsADCreds(): boolean {
  const auth = getStoredAuth();
  if (auth?.username) return false;
  return !getSecretsStatus().ad;
}

// True quando as credenciais AD estão configuradas no cofre (modo API key).
export function adConfigured(): boolean {
  return getSecretsStatus().ad;
}

// Migração: se houver credenciais AD antigas no localStorage, sobe pro cofre e
// apaga toda senha remanescente (inclusive a guardada dentro de rk_mail_config).
export async function migrateLegacyADCreds(): Promise<void> {
  try {
    // Limpa senha legada dentro de rk_mail_config, preservando só o host.
    let legacyFromMail: { username: string; password: string } | null = null;
    try {
      const mail = JSON.parse(localStorage.getItem('rk_mail_config') || '{}');
      if (mail?.user && mail?.password)
        legacyFromMail = { username: mail.user, password: mail.password };
      if (mail && ('user' in mail || 'password' in mail)) {
        localStorage.setItem(
          'rk_mail_config',
          JSON.stringify(mail.host ? { host: mail.host } : {}),
        );
      }
    } catch {
      /* ignora */
    }

    const raw = localStorage.getItem('rk_ad_creds');
    const p = raw ? JSON.parse(raw) : legacyFromMail;
    if (p?.username && p?.password && !getSecretsStatus().ad) {
      await saveADCreds({ username: p.username, password: p.password });
    }
    localStorage.removeItem('rk_ad_creds');
  } catch {
    /* ignora */
  }
}
