import axios from 'axios';

const TALK_AUTH_KEY = 'nextcloud_talk_auth';

export interface TalkAuth {
  url: string;
  user: string;
}

export function getTalkAuth(): TalkAuth | null {
  try {
    const raw = localStorage.getItem(TALK_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.url && parsed?.user) return parsed;
    return null;
  } catch { return null; }
}

export function saveTalkAuth(auth: TalkAuth) {
  localStorage.setItem(TALK_AUTH_KEY, JSON.stringify(auth));
}

export async function clearTalkAuth() {
  localStorage.removeItem(TALK_AUTH_KEY);
  try { await axios.delete('/api/talk/auth'); } catch { /* ignorar erro */ }
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
  // Campos client-only (envio otimista) — nunca vêm do servidor
  _status?: 'sending' | 'failed';
  _clientText?: string;
  _clientReplyTo?: number;
}

export interface TalkParticipant {
  actorId: string;
  actorType: string;
  displayName: string;
  participantType: number;
  attendeeId?: number;
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

// Disparado quando o servidor responde 401 a uma chamada do Talk — sinal de que o token
// (senha de app) foi revogado/expirou. 403 é "sem permissão" (conta não-admin, esperado)
// e NÃO conta. Quem ouve isso (TalkChat) mostra o aviso de reconexão.
export const TALK_AUTH_EXPIRED_EVENT = 'rk-talk-auth-expired';

api.interceptors.response.use(
  r => r,
  err => {
    if (err?.response?.status === 401 && getTalkAuth()) {
      window.dispatchEvent(new CustomEvent(TALK_AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(err);
  },
);

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

export interface TalkUserProfile {
  id: string;
  displayName: string;
  email: string;
  organisation: string;
  role: string;
  phone: string;
}

export async function fetchTalkUser(userId: string): Promise<TalkUserProfile> {
  const { data } = await api.get<TalkUserProfile>(`/users/${encodeURIComponent(userId)}`);
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

// ─── Presença / User Status ─────────────────────────────────────────────────

export type UserStatusType = 'online' | 'away' | 'dnd' | 'invisible' | 'offline';
export interface UserStatus {
  userId: string;
  status: UserStatusType;
  icon?: string | null;
  message?: string | null;
  clearAt?: number | null;
}

export async function fetchUserStatuses(): Promise<UserStatus[]> {
  const { data } = await api.get<UserStatus[]>('/user-statuses');
  return data;
}

export async function fetchMyStatus(): Promise<UserStatus | null> {
  const { data } = await api.get<UserStatus | null>('/my-status');
  return data;
}

export async function setMyStatusType(statusType: UserStatusType): Promise<void> {
  await api.put('/my-status', { statusType });
}

export async function setMyStatusMessage(message: string, statusIcon?: string | null, clearAt?: number | null): Promise<void> {
  await api.put('/my-status/message', { message, statusIcon, clearAt });
}

export async function clearMyStatusMessage(): Promise<void> {
  await api.delete('/my-status/message');
}

// Compartilhamentos agrupados por tipo (cada item tem o mesmo formato de mensagem)
export type TalkShareOverview = Partial<Record<
  'media' | 'file' | 'voice' | 'audio' | 'location' | 'deckcard' | 'other',
  TalkMessage[]
>>;

export async function fetchRoomShares(token: string): Promise<TalkShareOverview> {
  const { data } = await api.get<TalkShareOverview>(`/rooms/${token}/shares`);
  return data;
}

export async function fetchRoomSharesByType(token: string, objectType: string): Promise<TalkMessage[]> {
  const { data } = await api.get<TalkMessage[]>(`/rooms/${token}/shares/${objectType}`);
  return data;
}

export interface TalkSearchResult {
  id: number;
  actorDisplayName: string;
  message: string;
  timestamp: number;
}

export async function searchMessages(token: string, term: string): Promise<TalkSearchResult[]> {
  const { data } = await api.get<TalkSearchResult[]>(`/rooms/${token}/search`, { params: { term } });
  return data;
}

// ─── Gestão de grupos ──────────────────────────────────────────────────────────

export async function renameRoom(token: string, roomName: string): Promise<void> {
  await api.put(`/rooms/${token}`, { roomName });
}

export async function setRoomDescription(token: string, description: string): Promise<void> {
  await api.put(`/rooms/${token}/description`, { description });
}

export async function addParticipant(token: string, userId: string, source = 'users'): Promise<void> {
  await api.post(`/rooms/${token}/participants`, { newParticipant: userId, source });
}

export async function removeAttendee(token: string, attendeeId: number): Promise<void> {
  await api.delete(`/rooms/${token}/attendees`, { params: { attendeeId } });
}

export async function promoteModerator(token: string, attendeeId: number): Promise<void> {
  await api.post(`/rooms/${token}/moderators`, { attendeeId });
}

export async function demoteModerator(token: string, attendeeId: number): Promise<void> {
  await api.delete(`/rooms/${token}/moderators`, { params: { attendeeId } });
}

export async function leaveRoom(token: string): Promise<void> {
  await api.delete(`/rooms/${token}/participants/self`);
}

export async function uploadRoomAvatar(token: string, file: File): Promise<void> {
  await api.post(`/rooms/${token}/avatar`, file, {
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'image/png',
      'Content-Type': file.type || 'image/png',
    },
  });
}

export async function initLoginFlow(ncUrl: string): Promise<{ loginUrl: string; pollEndpoint: string; pollToken: string }> {
  const { data } = await axios.post('/api/talk/login-flow/init', { url: ncUrl });
  return data;
}

export type LoginFlowResult =
  | { done: false }
  | { done: true; server: string; user: string };

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
  opts?: { voiceMessage?: boolean },
): Promise<UploadResult> {
  const { data } = await api.post<UploadResult>(`/rooms/${token}/upload`, file, {
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'application/octet-stream',
      'Content-Type': file.type || 'application/octet-stream',
      ...(caption?.trim() ? { 'x-caption': encodeURIComponent(caption.trim()) } : {}),
      ...(opts?.voiceMessage ? { 'x-voice-message': '1' } : {}),
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
