import axios from 'axios';
import { getStoredAuth } from './redmine';
import { getMailHost } from '../utils/mailConfig';
import { getEffectiveCreds } from '../utils/adConfig';

// Tipos do front (espelham o que o servidor normaliza a partir do Zimbra).
export interface MailFolder {
  id: string;
  name: string;
  path: string;
  unread: number;
  total: number;
  view: string;
}

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MailMessageSummary {
  id: string;
  conversationId?: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  flagged: boolean;
  hasAttachment: boolean;
  from: MailAddress;
  size?: number;
}

export interface MailAttachment {
  part: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface CalendarEvent {
  id: string;
  invId: string | null;
  uid: string | null;
  compNum: number;
  subject: string;
  start: number | null;      // epoch ms
  end: number | null;
  durationMs: number;
  allDay: boolean;
  location: string;
  status: string;            // TENT | CONF | CANC
  ptst: string;              // participação: NE|AC|TE|DE|...
  organizer: MailAddress | null;
  isOrganizer: boolean;
  snippet: string;
}

export type InviteVerb = 'ACCEPT' | 'DECLINE' | 'TENTATIVE';

export interface MailMessageFull {
  id: string;
  conversationId?: string;
  subject: string;
  date: number;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  html: string;
  text: string;
  attachments: MailAttachment[];
  sessionToken: string | null;
}

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const auth = getStoredAuth();
  if (auth) {
    config.headers['X-Redmine-Url'] = auth.url;
    if (auth.apiKey) config.headers['X-Redmine-Key'] = auth.apiKey;
    if (auth.username && auth.password) {
      config.headers['X-Redmine-User'] = auth.username;
      config.headers['X-Redmine-Pass'] = auth.password;
    }
  }
  const host = getMailHost();
  if (host) config.headers['X-Mail-Host'] = host;
  // Credenciais AD manuais (quando logado só por API key)
  if (!auth?.username) {
    const creds = getEffectiveCreds();
    if (creds) {
      config.headers['X-Mail-User'] = creds.username;
      config.headers['X-Mail-Pass'] = creds.password;
    }
  }
  return config;
});

export const mailApi = {
  ping: async (): Promise<{ ok: boolean; host: string; user: string }> => {
    const { data } = await api.get('/mail/ping');
    return data;
  },

  getFolders: async (): Promise<MailFolder[]> => {
    const { data } = await api.get('/mail/folders');
    return data.folders;
  },

  getMessages: async (folder = 'inbox', limit = 30, offset = 0): Promise<{ messages: MailMessageSummary[]; more: boolean }> => {
    const { data } = await api.get('/mail/messages', { params: { folder, limit, offset } });
    return data;
  },

  search: async (q: string, limit = 30): Promise<{ messages: MailMessageSummary[]; more: boolean }> => {
    const { data } = await api.get('/mail/search', { params: { q, limit } });
    return data;
  },

  getMessage: async (id: string, markRead = true): Promise<MailMessageFull> => {
    const { data } = await api.get(`/mail/messages/${id}`, { params: { markRead: markRead ? 1 : 0 } });
    return data;
  },

  getUnread: async (): Promise<{ unread: number; inboxTotal: number }> => {
    const { data } = await api.get('/mail/unread');
    return data;
  },

  action: async (id: string, op: string): Promise<void> => {
    await api.post(`/mail/messages/${id}/action`, { op });
  },

  send: async (payload: { to: string[]; cc?: string[]; subject: string; text?: string; html?: string; inReplyTo?: string }): Promise<void> => {
    await api.post('/mail/send', payload);
  },

  attachmentUrl: (id: string, part: string, sessionToken?: string | null): string => {
    const base = `/api/mail/messages/${id}/attachments/${part}`;
    return sessionToken ? `${base}?s=${sessionToken}` : base;
  },

  getCalendar: async (start: number, end: number): Promise<CalendarEvent[]> => {
    const { data } = await api.get('/mail/calendar', { params: { start, end } });
    return data.events;
  },

  replyToInvite: async (id: string, verb: InviteVerb, compNum = 0): Promise<void> => {
    await api.post(`/mail/calendar/${id}/reply`, { verb, compNum });
  },
};
