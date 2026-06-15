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
  parent?: {
    id: number;
    actorDisplayName: string;
    message: string;
    messageParameters: Record<string, TalkMessageParam>;
    messageType: string;
  };
  reactions?: Record<string, number>;
  reactionsSelf?: string[];
}

export interface TalkParticipant {
  actorId: string;
  actorType: string;
  displayName: string;
  participantType: number;
  lastReadMessage?: number;
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

export interface NCUser {
  id: string;
  label: string;
  source: string;
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

export async function fetchMessages(token: string, params?: { lastKnownMessageId?: number }): Promise<TalkMessage[]> {
  const { data } = await api.get<TalkMessage[]>(`/rooms/${token}/messages`, { params });
  return data;
}

export async function sendMessage(token: string, message: string, replyTo?: number): Promise<TalkMessage> {
  const body: Record<string, unknown> = { message };
  if (replyTo) body.replyTo = replyTo;
  const { data } = await api.post<TalkMessage>(`/rooms/${token}/messages`, body);
  return data;
}

export async function editMessage(token: string, messageId: number, message: string): Promise<TalkMessage> {
  const { data } = await api.put<TalkMessage>(`/rooms/${token}/messages/${messageId}`, { message });
  return data;
}

export async function deleteMessage(token: string, messageId: number): Promise<void> {
  await api.delete(`/rooms/${token}/messages/${messageId}`);
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

export async function sendTyping(token: string, typing: boolean): Promise<void> {
  await api.post(`/rooms/${token}/typing`, { typing });
}

export async function addReaction(token: string, messageId: number, reaction: string): Promise<void> {
  await api.post(`/rooms/${token}/messages/${messageId}/reactions`, { reaction });
}

export async function removeReaction(token: string, messageId: number, reaction: string): Promise<void> {
  await api.delete(`/rooms/${token}/messages/${messageId}/reactions`, { params: { reaction } });
}

export async function createRoom(roomType: number, invite: string, roomName?: string): Promise<TalkRoom> {
  const body: Record<string, unknown> = { roomType, invite };
  if (roomName) body.roomName = roomName;
  const { data } = await api.post<TalkRoom>('/rooms', body);
  return data;
}

export async function initLoginFlow(ncUrl: string): Promise<{ loginUrl: string; pollEndpoint: string; pollToken: string }> {
  const { data } = await axios.post('/api/talk/login-flow/init', { url: ncUrl });
  return data;
}

export type LoginFlowResult =
  | { done: false }
  | { done: true; server: string; user: string; token: string };

export async function pollLoginFlow(pollEndpoint: string, pollToken: string): Promise<LoginFlowResult> {
  const { data } = await axios.post('/api/talk/login-flow/poll', { pollEndpoint, pollToken });
  return data;
}

export async function searchNCUsers(search: string): Promise<NCUser[]> {
  const { data } = await api.get<NCUser[]>('/search/users', { params: { search } });
  return data;
}

export interface UploadResult {
  success: boolean;
  method?: string;
  error?: string;
  uploadedPath?: string;
}

export async function uploadFileToTalk(
  token: string,
  file: File,
  caption?: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const { data } = await api.post<UploadResult>(`/rooms/${token}/upload`, file, {
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'application/octet-stream',
      'Content-Type': file.type || 'application/octet-stream',
      ...(caption?.trim() ? { 'x-caption': encodeURIComponent(caption.trim()) } : {}),
    },
    onUploadProgress: (e: { loaded: number; total?: number }) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export function resolveMessageText(msg: TalkMessage): string {
  const fileParam =
    msg.messageParameters?.file ??
    Object.values(msg.messageParameters ?? {}).find(p => p.type === 'file') ??
    null;
  if (msg.message === '{file}' || fileParam) {
    return fileParam?.name ? `📎 ${fileParam.name}` : '📎 Arquivo';
  }
  return msg.message.replace(/\{([\w-]+)\}/g, (_, key) => {
    const param = msg.messageParameters?.[key];
    return param?.name ? `@${param.name}` : key;
  });
}
