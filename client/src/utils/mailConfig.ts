import { hasEffectiveCreds, needsADCreds } from './adConfig';

const KEY = 'rk_mail_config';
export const DEFAULT_HOST = 'email.redesoft.org';

// Modelo de e-mail reutilizável, escolhido no compositor. `bodyHtml` é HTML
// (produzido pelo editor rico).
export interface MailTemplate {
  id: string;
  name: string;
  subject?: string;
  bodyHtml: string;
}

export interface MailConfig {
  host?: string;
  // Assinatura/rodapé em HTML, aplicada automaticamente em novas mensagens.
  signature?: string;
  templates?: MailTemplate[];
}

// Lê o objeto cru do localStorage (sem descartar campos, ao contrário do
// getMailConfig legado que só devolvia host).
function readRaw(): MailConfig {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as MailConfig;
  } catch {
    return {};
  }
}

export function getMailConfig(): MailConfig {
  return readRaw();
}

export function saveMailConfig(cfg: MailConfig) {
  const existing = readRaw();
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...existing, host: (cfg.host || '').trim() || DEFAULT_HOST }),
  );
}

export function getSignature(): string {
  return readRaw().signature || '';
}

export function saveSignature(html: string) {
  const existing = readRaw();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, signature: html || '' }));
}

export function getTemplates(): MailTemplate[] {
  const t = readRaw().templates;
  return Array.isArray(t) ? t : [];
}

export function saveTemplates(list: MailTemplate[]) {
  const existing = readRaw();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, templates: list }));
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
