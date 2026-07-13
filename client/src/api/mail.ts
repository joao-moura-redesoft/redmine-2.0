import axios from 'axios';
import { getMailHost } from '../utils/mailConfig';

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

// Anexo já enviado ao Zimbra (retorno de /mail/upload), pronto para referência
// no envio via `aid`.
export interface UploadedAttachment {
  aid: string;
  filename: string;
  size: number;
  contentType?: string;
}

// Parte de outra mensagem reanexada por (mid, part) — usado no Encaminhar,
// evita baixar+re-subir os anexos da original.
export interface ForwardPart {
  mid: string;
  part: string;
}

export interface MailSendPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  attachments?: { aid: string }[];
  forwardParts?: ForwardPart[];
}

export interface CalendarEvent {
  id: string;
  invId: string | null;
  uid: string | null; // identifica a SÉRIE (comum a todas as ocorrências)
  compNum: number;
  recurring: boolean; // faz parte de uma série (RRULE)
  ridZ: string | null; // recurrence-id desta ocorrência (ex.: 20260710T143000Z)
  isException: boolean; // ocorrência remarcada, destacada da série
  occurrencesInWindow: number; // ocorrências da série na janela visível (≠ tamanho da série)
  subject: string;
  start: number | null; // epoch ms
  end: number | null;
  durationMs: number;
  allDay: boolean;
  location: string;
  status: string; // TENT | CONF | CANC
  ptst: string; // participação: NE|AC|TE|DE|...
  organizer: MailAddress | null;
  isOrganizer: boolean;
  snippet: string;
  // Evento local (store por-usuário, não-Zimbra). Quando true, o chip mostra
  // ação de excluir e não tenta responder convite/buscar participantes.
  local?: boolean;
}

export interface EventAttendee {
  address: string;
  name: string;
  role: string; // REQ (obrigatório) | OPT (opcional) | NON | CHA
  ptst: string; // NE (sem resposta) | AC (aceitou) | DE (recusou) | TE (talvez) | DG (delegou)
  rsvp: boolean;
  isMe: boolean; // o convidado é o próprio usuário logado
}

export interface EventAttendees {
  organizer: MailAddress | null;
  attendees: EventAttendee[];
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

api.interceptors.request.use((config) => {
  // Credenciais (Redmine/AD) resolvidas no servidor a partir da sessão/cofre.
  // O cliente só envia a configuração de host do e-mail.
  const host = getMailHost();
  if (host) config.headers['X-Mail-Host'] = host;
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

  getMessages: async (
    folder = 'inbox',
    limit = 30,
    offset = 0,
  ): Promise<{ messages: MailMessageSummary[]; more: boolean }> => {
    const { data } = await api.get('/mail/messages', { params: { folder, limit, offset } });
    return data;
  },

  search: async (
    q: string,
    limit = 30,
  ): Promise<{ messages: MailMessageSummary[]; more: boolean }> => {
    const { data } = await api.get('/mail/search', { params: { q, limit } });
    return data;
  },

  getMessage: async (id: string, markRead = true): Promise<MailMessageFull> => {
    const { data } = await api.get(`/mail/messages/${id}`, {
      params: { markRead: markRead ? 1 : 0 },
    });
    return data;
  },

  getUnread: async (): Promise<{ unread: number; inboxTotal: number }> => {
    const { data } = await api.get('/mail/unread');
    return data;
  },

  // op ∈ read|!read|flag|!flag|trash|spam|move|delete. Para 'move', informe
  // `target` = id da pasta destino (Inbox=2, Trash=3…).
  action: async (id: string, op: string, target?: string | number): Promise<void> => {
    await api.post(`/mail/messages/${id}/action`, { op, l: target });
  },

  send: async (payload: MailSendPayload): Promise<void> => {
    await api.post('/mail/send', payload);
  },

  saveDraft: async (payload: MailSendPayload): Promise<{ id: string | null }> => {
    const { data } = await api.post('/mail/draft', payload);
    return data;
  },

  // Envia os bytes do arquivo e recebe um `aid` para usar em send/saveDraft.
  uploadAttachment: async (file: File): Promise<UploadedAttachment> => {
    const { data } = await api.post('/mail/upload', file, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
        'X-Content-Type': file.type || 'application/octet-stream',
      },
    });
    return data;
  },

  attachmentUrl: (id: string, part: string, sessionToken?: string | null): string => {
    const base = `/api/mail/messages/${id}/attachments/${part}`;
    return sessionToken ? `${base}?s=${sessionToken}` : base;
  },

  getCalendar: async (start: number, end: number): Promise<CalendarEvent[]> => {
    const { data } = await api.get('/mail/calendar', { params: { start, end } });
    return data.events;
  },

  getEventAttendees: async (id: string): Promise<EventAttendees> => {
    const { data } = await api.get(`/mail/calendar/${id}/attendees`);
    return data;
  },

  replyToInvite: async (id: string, verb: InviteVerb, compNum = 0): Promise<void> => {
    await api.post(`/mail/calendar/${id}/reply`, { verb, compNum });
  },

  createEvent: async (payload: CreateEventPayload): Promise<CreateEventResult> => {
    const { data } = await api.post('/mail/calendar', payload);
    return data;
  },
};

export interface NewEventAttendee {
  address: string;
  name?: string;
  role?: 'REQ' | 'OPT';
}

export interface CreateEventPayload {
  subject: string;
  start: number; // epoch ms
  end: number; // epoch ms
  location?: string;
  description?: string;
  attendees?: NewEventAttendee[];
  allDay?: boolean;
}

export interface CreateEventResult {
  success: boolean;
  calItemId: string | null;
  invId: string | null;
  invitesSent: number;
}
