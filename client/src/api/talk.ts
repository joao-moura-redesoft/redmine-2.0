import axios from 'axios';

const TALK_AUTH_KEY = 'nextcloud_talk_auth';

export interface TalkAuth {
  url: string;
  user: string;
  token: string;
}

export function getTalkAuth(): TalkAuth | null {
  try {
    const raw = localStorage.getItem(TALK_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.url && parsed?.user && parsed?.token) return parsed;
    return null;
  } catch { return null; }
}

export function saveTalkAuth(auth: TalkAuth) {
  localStorage.setItem(TALK_AUTH_KEY, JSON.stringify(auth));
}

export function clearTalkAuth() {
  localStorage.removeItem(TALK_AUTH_KEY);
}

export interface TalkMessageParam {
  type: string;
  id?: string;
  name?: string;
  path?: string;
  mimetype?: string;
  'preview-available'?: string;
  'mention-id'?: string;
}

export interface TalkMessage {
  id: number;
  token: string;
  actorType: string;
  actorId: string;
  actorDisplayName: string;
  timestamp: number;
  message: string;
  messageParameters: Record<string, TalkMessageParam>;
  systemMessage: string;
  messageType: string;
  isReplyable: boolean;
}

export interface TalkParticipant {
  actorId: string;
  actorType: string;
  displayName: string;
  participantType: number;
}

export interface TalkRoom {
  id: number;
  token: string;
  type: number; // 1=DM 2=group 3=public 4=changelog 6=self
  name: string;
  displayName: string;
  unreadMessages: number;
  unreadMention: boolean;
  lastMessage?: TalkMessage;
  lastActivity: number;
  participantType: number;
}

const api = axios.create({ baseURL: '/api/talk' });

api.interceptors.request.use(cfg => {
  const auth = getTalkAuth();
  if (auth) {
    cfg.headers['x-nextcloud-url']   = auth.url;
    cfg.headers['x-nextcloud-user']  = auth.user;
    cfg.headers['x-nextcloud-token'] = auth.token;
  }
  return cfg;
});

export async function fetchRooms(): Promise<TalkRoom[]> {
  const { data } = await api.get<TalkRoom[]>('/rooms');
  return data;
}

export async function fetchMessages(token: string): Promise<TalkMessage[]> {
  const { data } = await api.get<TalkMessage[]>(`/rooms/${token}/messages`);
  return data;
}

export async function sendMessage(token: string, message: string): Promise<TalkMessage> {
  const { data } = await api.post<TalkMessage>(`/rooms/${token}/messages`, { message });
  return data;
}

export async function fetchParticipants(token: string): Promise<TalkParticipant[]> {
  const { data } = await api.get<TalkParticipant[]>(`/rooms/${token}/participants`);
  return data;
}

export async function fetchTalkMe(): Promise<{ id: string; displayName: string }> {
  const { data } = await api.get('/me');
  return data;
}

export async function markMessagesRead(token: string, lastReadMessage: number): Promise<void> {
  await api.post(`/rooms/${token}/read`, { lastReadMessage });
}

export async function uploadFileToTalk(
  token: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  await api.post(`/rooms/${token}/upload`, file, {
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'application/octet-stream',
      'Content-Type': file.type || 'application/octet-stream',
    },
    onUploadProgress: (e: { loaded: number; total?: number }) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

export function resolveMessageText(msg: TalkMessage): string {
  if (msg.message === '{file}') {
    const file = msg.messageParameters?.file;
    return file?.name ? `📎 ${file.name}` : '📎 Arquivo';
  }
  return msg.message.replace(/\{([\w-]+)\}/g, (_, key) => {
    const param = msg.messageParameters?.[key];
    return param?.name ? `@${param.name}` : key;
  });
}
