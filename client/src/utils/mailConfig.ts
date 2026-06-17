import { hasEffectiveCreds, needsADCreds } from './adConfig';

const KEY = 'rk_mail_config';
export const DEFAULT_HOST = 'email.redesoft.org';

export interface MailConfig { host?: string; }

export function getMailConfig(): MailConfig {
  try { return { host: JSON.parse(localStorage.getItem(KEY) || '{}').host }; } catch { return {}; }
}

export function saveMailConfig(cfg: MailConfig) {
  const existing = getMailConfig();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, host: (cfg.host || '').trim() || DEFAULT_HOST }));
}

export function clearMailConfig() {
  localStorage.removeItem(KEY);
}

export function getMailHost(): string {
  return getMailConfig().host || DEFAULT_HOST;
}

export function isMailAvailable(): boolean {
  return hasEffectiveCreds();
}

export function needsMailConfig(): boolean {
  return needsADCreds();
}
