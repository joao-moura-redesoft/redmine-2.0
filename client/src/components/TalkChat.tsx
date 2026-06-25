import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import {
  MessageSquare, X, Minus, Send, Paperclip, Reply, Pencil, Trash2,
  Plus, Search, Wifi, WifiOff, ChevronUp, SmilePlus, Bell, BellOff, Smile,
  Users, UserPlus, LogOut, Crown, Camera, Check, CheckCheck, UserMinus, Files, Link2, FileText, Download, Video, MoreVertical, Mic, Play, Pause,
  Loader2, AlertCircle, RotateCw, Copy, CornerUpRight,
} from 'lucide-react';
import { useJitsi } from './jitsi/JitsiContext';
import { FilePreviewModal, isPreviewable } from './FilePreview';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { pcmToMp3, pcmToWav } from '../utils/encodeMp3';
import { makeTalkRoom, jitsiRoomUrl, callRoomFromText } from '../utils/jitsiConfig';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useTalkRooms, useTalkMessages, useSendMessage, useTalkCurrentUser,
  useEditMessage, useDeleteMessage, useReaction, useCreateRoom,
  useSearchNCUsers, useTypingSender, useTalkSSE, useUserStatuses,
} from '../hooks/useTalk';
import {
  getTalkAuth, resolveMessageText, fetchParticipants, markMessagesRead,
  uploadFileToTalk, fetchMessages, fetchTalkUser, createRoom, sendMessage,
  renameRoom, setRoomDescription, addParticipant, removeAttendee,
  promoteModerator, demoteModerator, leaveRoom, uploadRoomAvatar, searchNCUsers,
  searchMessages, fetchRoomShares,
  fetchMyStatus, setMyStatusType, setMyStatusMessage, clearMyStatusMessage,
  TALK_AUTH_EXPIRED_EVENT,
} from '../api/talk';
import type { UserStatusType } from '../api/talk';
import { getStoredAuth, authHeaders, redmineApi } from '../api/redmine';
import { talkBridge } from '../utils/talkBridge';
import { talkMute } from '../utils/talkMute';
import type { TalkRoom, TalkMessage, TalkParticipant } from '../api/talk';
import {
  formatDistanceToNow, format, isToday, isYesterday, isSameDay, differenceInCalendarDays,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';


// ─── Markdown simples ─────────────────────────────────────────────────────────

// Transforma URLs em links clicáveis dentro de um trecho de texto puro.
function linkify(text: string, isMe: boolean): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g).map((seg, i) => {
    // Índices ímpares = URL capturada
    if (i % 2 === 1) {
      const trimmed = seg.replace(/[.,;!?)]+$/, ''); // pontuação final fica fora do link
      const trail = seg.slice(trimmed.length);
      return (
        <span key={i}>
          <a href={trimmed} target="_blank" rel="noopener noreferrer"
             onClick={e => e.stopPropagation()}
             className={`underline break-all ${isMe ? 'text-white' : 'text-blue-600'}`}>
            {trimmed}
          </a>
          {trail}
        </span>
      );
    }
    return <span key={i}>{seg}</span>;
  });
}

function renderMarkdown(text: string, isMe: boolean): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|_[^_\n]+_|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} className={`rounded px-1 font-mono text-[10px] ${
          isMe ? 'bg-white/20' : 'bg-slate-200'
        }`}>{part.slice(1, -1)}</code>
      );
    return <span key={i}>{linkify(part, isMe)}</span>;
  });
}

// ─── Detecção de links do Redmine ─────────────────────────────────────────────

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type MessagePart = { type: 'text'; content: string } | { type: 'issue'; id: number };

function parseMessageParts(text: string): MessagePart[] {
  const auth = getStoredAuth();
  const matches: Array<{ start: number; end: number; id: number }> = [];

  // 1. URLs completas do Redmine: https://host/issues/1234
  if (auth?.url) {
    try {
      const host = new URL(auth.url).host;
      const urlRe = new RegExp(`https?://${escapeRegex(host)}/issues/(\\d+)`, 'g');
      let m: RegExpExecArray | null;
      while ((m = urlRe.exec(text)) !== null)
        matches.push({ start: m.index, end: m.index + m[0].length, id: parseInt(m[1]) });
    } catch {}
  }

  // 2. Referências bare: #1234 ou #123456 (não precedidas/seguidas de letra ou dígito)
  const hashRe = /(?<!\w)#(\d+)(?!\w)/g;
  let m: RegExpExecArray | null;
  while ((m = hashRe.exec(text)) !== null) {
    // ignora se já coberto por uma URL acima
    if (!matches.some(mx => m!.index >= mx.start && m!.index < mx.end))
      matches.push({ start: m.index, end: m.index + m[0].length, id: parseInt(m[1]) });
  }

  if (matches.length === 0) return [{ type: 'text', content: text }];
  matches.sort((a, b) => a.start - b.start);

  const parts: MessagePart[] = [];
  let last = 0;
  for (const mx of matches) {
    if (mx.start > last) parts.push({ type: 'text', content: text.slice(last, mx.start) });
    parts.push({ type: 'issue', id: mx.id });
    last = mx.end;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });
  return parts;
}

function RedmineIssueChip({ id, isMe, onIssueClick }: {
  id: number; isMe: boolean; onIssueClick?: (id: number) => void;
}) {
  const auth = getStoredAuth();
  const { data } = useQuery({
    queryKey: ['issue-chip', id],
    queryFn: async () => {
      const r = await fetch(`/api/issues/by-ids?ids=${id}`, {
        headers: authHeaders(),
      });
      const d = await r.json();
      return (d.issues?.[0] ?? null) as { id: number; subject: string } | null;
    },
    enabled: !!auth,
    staleTime: 10 * 60 * 1000,
  });
  return (
    <button
      onClick={e => { e.stopPropagation(); onIssueClick?.(id); }}
      className={`inline-flex items-baseline gap-1 px-2 py-0.5 mx-0.5 rounded-md text-[11px] font-medium transition-colors align-baseline border ${
        isMe
          ? 'bg-white/20 border-white/40 text-white hover:bg-white/30'
          : 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
      }`}
    >
      <span className="font-mono font-bold flex-shrink-0">#{id}</span>
      {data?.subject && <span>— {data.subject}</span>}
    </button>
  );
}

// ─── Avatar do usuário ────────────────────────────────────────────────────────

// Cor da bolinha de presença por tipo de status do Nextcloud.
const PRESENCE_COLOR: Record<string, string> = {
  online: 'bg-green-500',
  away: 'bg-amber-400',
  dnd: 'bg-red-500',
};
function PresenceDot({ status, size = 10 }: { status?: UserStatusType; size?: number }) {
  if (!status || status === 'offline' || status === 'invisible') return null;
  const color = PRESENCE_COLOR[status] ?? 'bg-slate-300';
  return (
    <span className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white dark:ring-slate-800 ${color}`}
          style={{ width: size, height: size }} />
  );
}

function TalkAvatar({ actorId, displayName, size = 36, onClick, status }: {
  actorId: string; displayName: string; size?: number; onClick?: () => void; status?: UserStatusType;
}) {
  const auth = getTalkAuth();
  const { data: src } = useQuery({
    queryKey: ['talk-avatar', actorId, size],
    queryFn: async () => {
      const r = await fetch(`/api/talk/avatar/${encodeURIComponent(actorId)}?size=${size}`, {
        headers: {
          'x-nextcloud-url':   auth!.url,
          'x-nextcloud-user':  auth!.user,
          'x-nextcloud-token': auth!.token,
        },
      });
      if (!r.ok) return null;
      return URL.createObjectURL(await r.blob());
    },
    enabled: !!auth && !!actorId,
    staleTime: 10 * 60 * 1000,
  });
  const initials = displayName.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const dotSize = Math.max(7, Math.round(size * 0.3));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
    <div onClick={onClick ? (e => { e.stopPropagation(); onClick(); }) : undefined}
         className={`rounded-full overflow-hidden w-full h-full bg-gradient-to-br from-blue-400 to-blue-600 ${
           onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all' : ''
         }`}>
      {src
        ? <img src={src} alt={displayName} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-white font-bold"
               style={{ fontSize: Math.round(size * 0.38) }}>
            {initials}
          </div>
      }
    </div>
      <PresenceDot status={status} size={dotSize} />
    </div>
  );
}

// ─── Pop-up de perfil de usuário ──────────────────────────────────────────────

function UserProfilePopup({ actorId, displayName, myId, onClose, onOpenDM }: {
  actorId: string;
  displayName: string;
  myId: string;
  onClose: () => void;
  onOpenDM: (userId: string) => void;
}) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['talk-user-profile', actorId],
    queryFn: () => fetchTalkUser(actorId),
    staleTime: 5 * 60 * 1000,
  });
  const { data: statuses } = useUserStatuses();
  const userStatus = statuses?.get(actorId);
  const isSelf = actorId === myId;
  const name = profile?.displayName || displayName;
  // Alguns Nextcloud usam UUID como user id (LDAP/SAML) — não faz sentido exibir.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId);
  const STATUS_LABEL: Record<string, string> = { online: 'Online', away: 'Ausente', dnd: 'Não perturbe', offline: 'Offline', invisible: 'Offline' };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-72 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="relative flex flex-col items-center pt-6 pb-4 px-5 bg-gradient-to-b from-blue-50 to-white">
          <button onClick={onClose}
                  className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={14} />
          </button>
          <TalkAvatar actorId={actorId} displayName={name} size={72} status={userStatus?.status} />
          <p className="mt-3 text-base font-semibold text-slate-800 text-center">{name}</p>
          {!isUuid && <p className="text-xs text-slate-400">@{actorId}</p>}
          {userStatus && (userStatus.message || (userStatus.status && userStatus.status !== 'offline')) && (
            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              {userStatus.icon && <span>{userStatus.icon}</span>}
              {userStatus.message || STATUS_LABEL[userStatus.status]}
            </p>
          )}
        </div>

        <div className="px-5 pb-4 space-y-1.5">
          {isLoading && <p className="text-xs text-slate-400 text-center py-2">Carregando…</p>}
          {!isLoading && profile?.role && (
            <p className="text-xs text-slate-600"><span className="text-slate-400">Cargo:</span> {profile.role}</p>
          )}
          {!isLoading && profile?.organisation && (
            <p className="text-xs text-slate-600"><span className="text-slate-400">Equipe:</span> {profile.organisation}</p>
          )}
          {!isLoading && profile?.email && (
            <a href={`mailto:${profile.email}`} className="block text-xs text-blue-600 hover:underline break-all">
              {profile.email}
            </a>
          )}
          {!isLoading && profile?.phone && (
            <p className="text-xs text-slate-600">{profile.phone}</p>
          )}

          {!isSelf && (
            <button onClick={() => { onOpenDM(actorId); onClose(); }}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors">
              <MessageSquare size={14} /> Mensagem Direta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Avatar de sala (grupos usam avatar dedicado do Talk) ─────────────────────

function RoomAvatar({ room, size = 36, status }: { room: TalkRoom; size?: number; status?: UserStatusType }) {
  const auth = getTalkAuth();
  const { data: src } = useQuery({
    queryKey: ['talk-room-avatar', room.token, size],
    queryFn: async () => {
      const r = await fetch(`/api/talk/rooms/${room.token}/avatar`, {
        headers: {
          'x-nextcloud-url':   auth!.url,
          'x-nextcloud-user':  auth!.user,
          'x-nextcloud-token': auth!.token,
        },
      });
      if (!r.ok) return null;
      return URL.createObjectURL(await r.blob());
    },
    enabled: !!auth && room.type !== 1,
    staleTime: 10 * 60 * 1000,
  });

  if (room.type === 1) {
    return <TalkAvatar actorId={room.name} displayName={room.displayName} size={size} status={status} />;
  }

  const initials = room.displayName.charAt(0).toUpperCase();
  return (
    <div className="rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-indigo-400 to-indigo-600"
         style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt={room.displayName} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-white font-bold"
               style={{ fontSize: Math.round(size * 0.38) }}>
            {initials}
          </div>
      }
    </div>
  );
}

// ─── Imagem inline ────────────────────────────────────────────────────────────

function TalkImage({ fileId, path, name, actorId }: {
  fileId: string; path?: string; name: string; actorId: string;
}) {
  const auth = getTalkAuth();
  const [src, setSrc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    const params = new URLSearchParams({ fileId });
    if (path) params.set('path', path);
    if (actorId) params.set('actorId', actorId);
    fetch(`/api/talk/file-preview?${params}`, {
      headers: {
        'x-nextcloud-url':   auth.url,
        'x-nextcloud-user':  auth.user,
        'x-nextcloud-token': auth.token,
      },
    })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        if (!active) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [fileId, path]);

  if (!src) {
    const link = auth ? `${auth.url}/index.php/f/${fileId}` : '#';
    return (
      <a href={link} target="_blank" rel="noopener noreferrer"
         className="flex items-center gap-1.5 text-xs underline opacity-80 hover:opacity-100">
        📎 {name}
      </a>
    );
  }

  return (
    <>
      <img src={src} alt={name} className="rounded-xl max-w-full cursor-zoom-in block"
           style={{ maxHeight: 180 }} onClick={() => setLightbox(true)} />
      {lightbox && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
             onClick={() => setLightbox(false)}>
          <div className="relative max-w-3xl max-h-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setLightbox(false)}
                    className="absolute -top-3 -right-3 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-lg text-slate-700 hover:text-slate-900 z-10">
              <X size={14} />
            </button>
            <img src={src} alt={name} className="rounded-xl max-w-full max-h-[85vh] object-contain shadow-2xl" />
            <p className="text-center text-xs text-slate-400 mt-2">{name}</p>
          </div>
        </div>
      )}
    </>
  );
}

// Baixa um arquivo compartilhado no Talk via proxy autenticado. Recorre a abrir
// no Nextcloud caso o download direto falhe.
// Busca o conteúdo de um anexo do Talk como Blob (para pré-visualização).
async function fetchTalkFileBlob(
  file: { id?: string; name?: string; path?: string },
  actorId?: string,
): Promise<Blob> {
  const auth = getTalkAuth();
  if (!auth || !file.id) throw new Error('sem arquivo');
  const params = new URLSearchParams({ fileId: file.id });
  if (file.path) params.set('path', file.path);
  if (actorId) params.set('actorId', actorId);
  if (file.name) params.set('name', file.name);
  const r = await fetch(`/api/talk/file-download?${params}`, {
    headers: { 'x-nextcloud-url': auth.url, 'x-nextcloud-user': auth.user, 'x-nextcloud-token': auth.token },
  });
  if (!r.ok) throw new Error('download failed');
  return r.blob();
}

async function downloadTalkFile(
  file: { id?: string; name?: string; path?: string },
  actorId?: string,
) {
  const auth = getTalkAuth();
  if (!auth || !file.id) return;
  const params = new URLSearchParams({ fileId: file.id });
  if (file.path) params.set('path', file.path);
  if (actorId) params.set('actorId', actorId);
  if (file.name) params.set('name', file.name);
  try {
    const r = await fetch(`/api/talk/file-download?${params}`, {
      headers: {
        'x-nextcloud-url': auth.url,
        'x-nextcloud-user': auth.user,
        'x-nextcloud-token': auth.token,
      },
    });
    if (!r.ok) throw new Error('download failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name || `arquivo_${file.id}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    window.open(`${auth.url}/index.php/f/${file.id}`, '_blank', 'noopener');
  }
}

// ─── Áudio / mensagem de voz inline ───────────────────────────────────────────

function TalkAudio({ file, actorId, isMe, isVoice }: {
  file: { id?: string; name?: string; path?: string; mimetype?: string };
  actorId: string; isMe: boolean; isVoice: boolean;
}) {
  const auth = getTalkAuth();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auth || !file.id) return;
    let active = true;
    const params = new URLSearchParams({ fileId: file.id });
    if (file.path) params.set('path', file.path);
    if (actorId) params.set('actorId', actorId);
    if (file.name) params.set('name', file.name);
    fetch(`/api/talk/file-download?${params}`, {
      headers: { 'x-nextcloud-url': auth.url, 'x-nextcloud-user': auth.user, 'x-nextcloud-token': auth.token },
    })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        if (!active) return;
        // Nextcloud devolve video/webm para gravações de voz; o <audio> toca melhor
        // com tipo de áudio explícito.
        const audioBlob = blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/webm' });
        const u = URL.createObjectURL(audioBlob);
        urlRef.current = u;
        setSrc(u);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [file.id]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => {}); }
    else { a.pause(); setPlaying(false); }
  };

  // webm do MediaRecorder costuma reportar duration = Infinity até "seek" ao fim.
  const onLoaded = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.duration === Infinity || isNaN(a.duration)) {
      a.currentTime = 1e101; // força o navegador a calcular a duração real
    } else setDur(a.duration);
  };
  const onDurationChange = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.duration !== Infinity && !isNaN(a.duration)) {
      setDur(a.duration);
      if (a.currentTime > 1e6) a.currentTime = 0; // desfaz o seek do truque acima
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !dur || !isFinite(dur)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
  };

  const fmt = (s: number) => isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
  const pct = dur > 0 && isFinite(dur) ? Math.min(100, (cur / dur) * 100) : 0;

  if (failed) {
    return (
      <button onClick={() => downloadTalkFile(file, actorId)}
              className={`flex items-center gap-1.5 hover:underline ${isMe ? 'text-white' : 'text-blue-700'}`}>
        <Mic size={13} /> {isVoice ? 'Mensagem de voz' : (file.name || 'Áudio')}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] py-0.5 pr-1">
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" className="hidden"
             onLoadedMetadata={onLoaded}
             onDurationChange={onDurationChange}
             onTimeUpdate={() => setCur(audioRef.current?.currentTime ?? 0)}
             onEnded={() => { setPlaying(false); setCur(0); }} />
      <button onClick={toggle} disabled={!src}
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50 ${
                isMe ? 'bg-white text-blue-600 hover:bg-blue-50' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}>
        {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div onClick={seek}
             className={`h-1.5 rounded-full cursor-pointer ${isMe ? 'bg-white/30' : 'bg-slate-300'}`}>
          <div className={`h-full rounded-full ${isMe ? 'bg-white' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-[9px] tabular-nums leading-none ${isMe ? 'text-white/70' : 'text-slate-400'}`}>
          {fmt(cur > 0 || playing ? cur : dur)}
        </span>
      </div>
      <button onClick={() => downloadTalkFile(file, actorId)} title="Baixar áudio"
              className={`flex-shrink-0 transition-colors ${isMe ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-blue-600'}`}>
        <Download size={13} />
      </button>
    </div>
  );
}

// ─── Mensagem citada (reply) ──────────────────────────────────────────────────

function QuotedMessage({ parent, isMe, onJump }: {
  parent: NonNullable<TalkMessage['parent']>;
  isMe: boolean;
  onJump?: (id: number) => void;
}) {
  const text = parent.message === '{file}'
    ? '📎 Arquivo'
    : parent.message.replace(/\{([\w-]+)\}/g, (_, k) => {
        return parent.messageParameters?.[k]?.name ? `@${parent.messageParameters[k].name}` : k;
      });
  // A citação fica sobre o fundo da página (não dentro da bolha), então usa
  // paleta legível em ambos os modos; a borda azul indica que é a sua mensagem.
  return (
    <button
      type="button"
      onClick={() => onJump?.(parent.id)}
      title="Ir para a mensagem"
      className={`talk-quote block text-left text-[10px] rounded-lg px-2 py-1 mb-1 border-l-2 max-w-full truncate transition-colors cursor-pointer ${
        isMe ? 'border-blue-400' : 'border-slate-400'
      }`}>
      <span className="font-semibold">{parent.actorDisplayName.split(' ')[0]}: </span>
      <span>{text}</span>
    </button>
  );
}

// ─── Seletor de emojis ────────────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🔥'];

// Seletor completo (emoji-mart) — usado tanto para reações quanto no input.
// Renderiza em posição absoluta; `align` controla de que lado ancora.
function FullEmojiPicker({ onPick, onClose, align = 'right', position = 'bottom' }: {
  onPick: (e: string) => void;
  onClose: () => void;
  align?: 'left' | 'right';
  position?: 'top' | 'bottom';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  // Carrega o emoji-mart (componente + dados ~1.4MB) sob demanda, mantendo-o fora
  // do bundle principal. Só baixa quando o usuário abre o seletor completo.
  const [mart, setMart] = useState<{ Picker: React.ComponentType<Record<string, unknown>>; data: unknown } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([import('@emoji-mart/react'), import('@emoji-mart/data')])
      .then(([mod, data]) => { if (active) setMart({ Picker: mod.default, data: (data as { default: unknown }).default }); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Fecha ao clicar fora
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const Picker = mart?.Picker;
  return (
    <div ref={ref}
         className={`talk-emoji-picker absolute z-[60] ${position === 'bottom' ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'} shadow-2xl rounded-xl overflow-hidden`}>
      {Picker ? (
        <Picker
          data={mart!.data}
          locale="pt"
          theme={isDark ? 'dark' : 'light'}
          previewPosition="none"
          skinTonePosition="search"
          perLine={7}
          emojiButtonSize={28}
          emojiSize={20}
          maxFrequentRows={1}
          navPosition="bottom"
          onEmojiSelect={(e: { native: string }) => { onPick(e.native); onClose(); }}
        />
      ) : (
        <div className="w-[240px] h-[120px] flex items-center justify-center bg-white border border-slate-200 rounded-xl">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

function EmojiPicker({ onPick, onClose, align = 'right' }: {
  onPick: (e: string) => void; onClose: () => void; align?: 'left' | 'right';
}) {
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha apenas ao clicar fora (não ao tirar o mouse) — assim a transição para o
  // seletor completo não some quando o mouse fica fora da área do picker antigo.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  if (full) {
    return <FullEmojiPicker onPick={onPick} onClose={onClose} align={align} position="bottom" />;
  }

  return (
    // Ancorada no lado de origem (right p/ minhas msgs, left p/ recebidas).
    // Emojis compactos em linha única — cabem na janela estreita sem quebrar.
    <div ref={ref}
         className={`absolute z-50 bottom-full mb-1 ${align === 'right' ? 'right-0' : 'left-0'} bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 flex gap-1 items-center`}>
      {QUICK_EMOJIS.map(e => (
        <button key={e} onClick={() => { onPick(e); onClose(); }}
                className="text-base hover:scale-125 transition-transform leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100">
          {e}
        </button>
      ))}
      <span className="w-px h-4 bg-slate-200 mx-0.5" />
      <button onClick={() => setFull(true)} title="Mais emojis"
              className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
        <Plus size={14} />
      </button>
    </div>
  );
}

// ─── Barra de reações ─────────────────────────────────────────────────────────

function ReactionBar({ reactions, reactionsSelf, onToggle }: {
  reactions: Record<string, number>;
  reactionsSelf: string[];
  onToggle: (emoji: string, remove: boolean) => void;
}) {
  const entries = Object.entries(reactions).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.map(([emoji, count]) => {
        const isMine = reactionsSelf.includes(emoji);
        return (
          <button key={emoji} onClick={() => onToggle(emoji, isMine)}
                  className={`inline-flex items-center gap-0.5 text-[11px] rounded-full px-1.5 py-0.5 border transition-colors ${
                    isMine
                      ? 'bg-blue-100 border-blue-300 text-blue-700 hover:bg-blue-200'
                      : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                  }`}>
            <span>{emoji}</span>
            <span className="font-medium">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Divisor de data/hora entre mensagens ─────────────────────────────────────

// Rótulo amigável de um dia: "Hoje", "Ontem", dia da semana (última semana) ou data.
function formatDayLabel(d: Date): string {
  if (isToday(d)) return 'Hoje';
  if (isYesterday(d)) return 'Ontem';
  const days = differenceInCalendarDays(new Date(), d);
  if (days > 0 && days < 7) {
    const wd = format(d, 'EEEE', { locale: ptBR });
    return wd.charAt(0).toUpperCase() + wd.slice(1);
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

// Decide se uma mensagem deve exibir um divisor antes dela e qual o rótulo.
// - 1ª mensagem ou troca de dia → rótulo do dia (ex.: "Hoje", "Ontem", "12 de junho")
// - mesmo dia, mas intervalo ≥ 1h em relação à anterior → horário (HH:mm)
const GAP_DIVIDER_SECONDS = 60 * 60;
function dividerLabel(prev: TalkMessage | undefined, m: TalkMessage): string | null {
  const cur = new Date(m.timestamp * 1000);
  if (!prev) return formatDayLabel(cur);
  const prevDate = new Date(prev.timestamp * 1000);
  if (!isSameDay(prevDate, cur)) return formatDayLabel(cur);
  if (m.timestamp - prev.timestamp >= GAP_DIVIDER_SECONDS) {
    return `${formatDayLabel(cur)} · ${format(cur, 'HH:mm')}`;
  }
  return null;
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center my-3">
      <span className="text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full px-2.5 py-0.5">
        {label}
      </span>
    </div>
  );
}

// ─── Bolha de mensagem ────────────────────────────────────────────────────────

function renderBubbleContent(text: string, isMe: boolean, onIssueClick?: (id: number) => void) {
  const parts = parseMessageParts(text);
  const nodes: React.ReactNode[] = [];
  parts.forEach((part, pi) => {
    if (part.type === 'issue') {
      nodes.push(<RedmineIssueChip key={pi} id={part.id} isMe={isMe} onIssueClick={onIssueClick} />);
    } else {
      part.content.split('\n').forEach((line, li, arr) => {
        nodes.push(...renderMarkdown(line, isMe).map((n, ni) => (
          <span key={`${pi}-${li}-${ni}`}>{n}</span>
        )));
        if (li < arr.length - 1) nodes.push(<br key={`${pi}-br${li}`} />);
      });
    }
  });
  return <>{nodes}</>;
}

// ─── Preview de link (OpenGraph) ─────────────────────────────────────────────

function findPreviewUrl(text: string): string | null {
  const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,;!?)]+$/, ''); // remove pontuação final
    try { new URL(url); return url; } catch { /* ignora URL mal-formada */ }
  }
  return null;
}

function OGPreview({ url }: { url: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['og', url],
    queryFn: async () => {
      const r = await fetch(`/api/og?url=${encodeURIComponent(url)}`);
      return r.json() as Promise<{ title: string; description: string; image: string; siteName: string; url: string }>;
    },
    staleTime: 60 * 60 * 1000,
    enabled: !!url,
  });

  if (isLoading || !data?.title) return null;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
       className="flex gap-2 mt-1.5 p-2 bg-white border border-slate-200 rounded-xl hover:border-blue-300 transition-colors text-left overflow-hidden max-w-full">
      {data.image && (
        <img src={data.image} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" onError={e => (e.currentTarget.style.display = 'none')} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{data.title}</p>
        {data.description && (
          <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">{data.description}</p>
        )}
        <p className="text-[9px] text-slate-400 mt-0.5 truncate">{data.siteName}</p>
      </div>
    </a>
  );
}

// Card de chamada de vídeo dentro da bolha (mensagem "iniciei uma chamada").
function CallCard({ room, isMe }: { room: string; isMe: boolean }) {
  const { startCall, activeCall, poppedOut } = useJitsi();
  const here = activeCall?.room === room || poppedOut?.room === room;
  return (
    <div className={`flex items-center gap-2.5 ${isMe ? 'text-white' : 'text-slate-700'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isMe ? 'bg-white/20' : 'bg-blue-100 text-blue-600'
      }`}>
        <Video size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-tight">Chamada de vídeo</p>
        <p className={`text-[10px] ${isMe ? 'text-white/70' : 'text-slate-400'}`}>Toque para entrar</p>
      </div>
      <button onClick={() => startCall({ room, title: 'Chamada', kind: 'adhoc' })}
              disabled={here}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors flex-shrink-0 ${
                here
                  ? (isMe ? 'bg-white/20 text-white/70' : 'bg-slate-100 text-slate-400')
                  : (isMe ? 'bg-white text-blue-600 hover:bg-blue-50' : 'bg-blue-600 text-white hover:bg-blue-700')
              }`}>
        <Video size={12} /> {here ? 'Na chamada' : 'Entrar'}
      </button>
    </div>
  );
}

// Divisor "Novas mensagens" — marca onde a leitura havia parado.
function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 my-3 px-2">
      <div className="flex-1 h-px bg-rose-300/60" />
      <span className="text-[10px] font-semibold text-rose-500 whitespace-nowrap">Novas mensagens</span>
      <div className="flex-1 h-px bg-rose-300/60" />
    </div>
  );
}

// Detecta se a mensagem menciona o usuário atual (@nome) ou todos (@todos/@all).
function messageMentionsMe(msg: TalkMessage, myId: string): boolean {
  return Object.values(msg.messageParameters ?? {}).some(p =>
    (p.type === 'user' && (p.id === myId || p['mention-id'] === myId)) ||
    p.type === 'call');
}

// ─── Diálogo: encaminhar mensagem para outra conversa ─────────────────────────

function ForwardDialog({ msg, onClose }: { msg: TalkMessage; onClose: () => void }) {
  const { data: rooms = [] } = useTalkRooms();
  const [sending, setSending] = useState<string | null>(null);
  const [doneTo, setDoneTo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const text = resolveMessageText(msg);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const targets = rooms
    .filter(r => r.type !== 4 && r.type !== 6) // exclui changelog e "anotações pessoais"
    .filter(r => r.displayName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const forward = async (token: string) => {
    setSending(token);
    try {
      await sendMessage(token, text);
      setDoneTo(token);
      setTimeout(onClose, 700);
    } catch {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-80 max-h-[70vh] flex flex-col bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
           onClick={e => e.stopPropagation()} role="dialog" aria-label="Encaminhar mensagem">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-800">Encaminhar para…</span>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600" aria-label="Fechar">
            <X size={14} />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-slate-100">
          <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5 line-clamp-2 mb-2">{text || '📎 Anexo'}</p>
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5">
            <Search size={13} className="text-slate-400 flex-shrink-0" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Buscar conversa…"
                   className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400" />
          </div>
        </div>
        <div className="overflow-y-auto scrollbar-thin">
          {targets.length === 0 && (
            <div className="text-center py-6 text-xs text-slate-400">Nenhuma conversa</div>
          )}
          {targets.map(r => (
            <button key={r.token} onClick={() => forward(r.token)} disabled={!!sending}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left transition-colors border-b border-slate-50 last:border-0 disabled:opacity-60">
              <RoomAvatar room={r} size={28} />
              <span className="flex-1 text-xs font-medium text-slate-700 truncate">{r.displayName}</span>
              {sending === r.token && (doneTo === r.token
                ? <Check size={14} className="text-green-500" />
                : <Loader2 size={14} className="text-slate-400 animate-spin" />)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg, isMe, onIssueClick, onJumpTo, onReply, onEdit, onDelete, onReact, onRetry, onCopy, onForward, onAvatarClick, onShowInfo, myId, mentionsMe, readers, numActiveParticipants, readStatusAvailable, showSender, grouped, groupedWithNext, isDM }: {
  msg: TalkMessage;
  isMe: boolean;
  myId: string;
  onIssueClick?: (id: number) => void;
  onJumpTo?: (id: number) => void;
  onReply: (msg: TalkMessage) => void;
  onEdit: (msg: TalkMessage) => void;
  onDelete: (msg: TalkMessage) => void;
  onReact: (msgId: number, emoji: string, remove: boolean) => void;
  onRetry?: (msg: TalkMessage) => void;
  onCopy?: (msg: TalkMessage) => void;
  onForward?: (msg: TalkMessage) => void;
  onAvatarClick?: (actorId: string, displayName: string) => void;
  onShowInfo?: (msg: TalkMessage) => void;
  mentionsMe?: boolean;
  readers: string[];
  numActiveParticipants: number;
  readStatusAvailable: boolean;
  showSender: boolean;
  grouped: boolean;
  groupedWithNext: boolean;
  isDM: boolean;
}) {
  const file = msg.message === '{file}'
    ? msg.messageParameters?.file
    : Object.values(msg.messageParameters ?? {}).find(p => p.type === 'file') ?? null;
  const isImage = !!file && !!file.mimetype?.startsWith('image/');
  // Mensagem de voz ou qualquer anexo de áudio → player inline.
  // O Nextcloud reporta .webm como video/webm; nossas gravações de voz são webm/opus,
  // então detectamos por extensão também (e tratamos video/webm como áudio).
  const isAudio = !!file && (
    msg.messageType === 'voice-message' ||
    !!file.mimetype?.startsWith('audio/') ||
    file.mimetype === 'video/webm' ||
    /\.(webm|weba|ogg|oga|opus|mp3|m4a|aac|wav)$/i.test(file.name ?? '')
  );
  // Legenda do arquivo: texto da mensagem com o placeholder {file} removido.
  const caption = file
    ? msg.message.replace(/\{([\w-]+)\}/g, (_, key) => {
        const param = msg.messageParameters?.[key];
        if (param?.type === 'file') return '';
        return param?.name ? `@${param.name}` : key;
      }).trim()
    : '';
  const [showMenu, setShowMenu] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filePreview, setFilePreview] = useState(false);
  // Em telas de toque (sem hover) tocar na bolha revela a barra de ações.
  const [actionsOpen, setActionsOpen] = useState(false);
  const reactions = msg.reactions ?? {};
  const reactionsSelf = msg.reactionsSelf ?? [];
  // Mensagem de chamada de vídeo do Talk → renderiza card "Entrar na chamada".
  const callRoom = !file ? callRoomFromText(resolveMessageText(msg)) : null;

  return (
    <div className={`relative flex ${groupedWithNext ? 'mb-0.5' : 'mb-2'} gap-1.5 group ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end ${
           showMenu || showEmoji ? 'z-30' : ''
         }`}
         onMouseLeave={() => { if (!showEmoji && !showMenu) { setConfirmDelete(false); setActionsOpen(false); } }}>
      {!isMe && !isDM && (
        showSender
          ? <TalkAvatar actorId={msg.actorId} displayName={msg.actorDisplayName} size={24}
                        onClick={onAvatarClick ? () => onAvatarClick(msg.actorId, msg.actorDisplayName) : undefined} />
          : <div style={{ width: 24, flexShrink: 0 }} />
      )}
      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[80%] min-w-0 relative`}>
        {!isMe && showSender && (
          <button onClick={() => onAvatarClick?.(msg.actorId, msg.actorDisplayName)}
                  className="text-[10px] text-slate-400 mb-0.5 px-1 hover:text-blue-500 hover:underline transition-colors">
            {msg.actorDisplayName.split(' ')[0]}
          </button>
        )}
        {msg.parent && <QuotedMessage parent={msg.parent} isMe={isMe} onJump={onJumpTo} />}
        <div id={`talk-msg-${msg.id}`} className="relative rounded-2xl">
        {/* Barra de ações — sobreposta à borda superior da bolha, ancorada para
            dentro p/ nunca ser cortada. Em bolhas otimistas (enviando/falhou) não
            há ações; aparece no hover (mouse) ou ao tocar a bolha (toque). */}
        {!msg._status && (
        <div className={`absolute top-0 z-20 -translate-y-1/2 ${isMe ? 'right-1' : 'left-1'} flex items-center gap-0.5 transition-opacity ${
          showEmoji || showMenu || actionsOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          <button onClick={() => setShowEmoji(v => !v)}
                  className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 shadow-sm"
                  title="Reagir" aria-label="Reagir">
            <SmilePlus size={11} />
          </button>
          {msg.isReplyable && (
            <button onClick={() => onReply(msg)}
                    className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 shadow-sm"
                    title="Responder" aria-label="Responder">
              <Reply size={11} />
            </button>
          )}
          <div className="relative">
            <button onClick={() => { setShowMenu(v => !v); }}
                    className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 shadow-sm"
                    title="Mais" aria-label="Mais ações">
              <MoreVertical size={11} />
            </button>
            {showMenu && (
              <div className={`absolute top-full mt-1 ${isMe ? 'right-0' : 'left-0'} z-20 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden min-w-[150px]`}
                   onMouseLeave={() => { if (!confirmDelete) setShowMenu(false); }}>
                {confirmDelete ? (
                  <div className="p-2">
                    <p className="text-[11px] text-slate-600 px-1 pb-1.5">Excluir esta mensagem?</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => { onDelete(msg); setShowMenu(false); setConfirmDelete(false); }}
                              className="flex-1 px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium transition-colors">
                        Excluir
                      </button>
                      <button onClick={() => setConfirmDelete(false)}
                              className="flex-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-medium transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button onClick={() => { onCopy?.(msg); setShowMenu(false); }}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-xs text-slate-700">
                      <Copy size={12} /> Copiar
                    </button>
                    <button onClick={() => { onForward?.(msg); setShowMenu(false); }}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-xs text-slate-700">
                      <CornerUpRight size={12} /> Encaminhar
                    </button>
                    {isMe && (
                      <>
                        <button onClick={() => { onEdit(msg); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-xs text-slate-700">
                          <Pencil size={12} /> Editar
                        </button>
                        <button onClick={() => setConfirmDelete(true)}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-xs text-red-600">
                          <Trash2 size={12} /> Excluir
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {/* Picker ancorado pela barra (borda = borda da bolha), usando toda a
              largura disponível — não fica preso à posição do botão de emoji */}
          {showEmoji && (
            <EmojiPicker
              align={isMe ? 'right' : 'left'}
              onPick={e => onReact(msg.id, e, reactionsSelf.includes(e))}
              onClose={() => setShowEmoji(false)}
            />
          )}
        </div>
        )}

        <div onClick={(e) => {
               // Toque: revela as ações ao tocar no corpo da bolha (ignora links/botões/mídia)
               if ((e.target as HTMLElement).closest('a,button,input,textarea,audio,video,img')) return;
               if (!msg._status) setActionsOpen(v => !v);
             }}
             className={`rounded-2xl text-xs leading-relaxed break-words [overflow-wrap:anywhere] overflow-hidden ${
          isImage ? 'p-1' : 'px-3 py-1.5'
        } ${
          msg._status === 'failed' ? 'ring-1 ring-red-300 ' : ''
        }${
          isMe
            ? `bg-blue-600 text-white ${!grouped ? 'rounded-br-sm' : ''}`
            : mentionsMe
            ? `talk-mention bg-amber-50 text-slate-800 ${!grouped ? 'rounded-bl-sm' : ''}`
            : `talk-bubble-in bg-slate-100 text-slate-800 ${!grouped ? 'rounded-bl-sm' : ''}`
        }`}>
          {file ? (
            <>
              {isImage
                ? <TalkImage fileId={file.id!} path={file.path} name={file.name ?? 'imagem'} actorId={msg.actorId} />
                : isAudio
                ? <TalkAudio file={file} actorId={msg.actorId} isMe={isMe} isVoice={msg.messageType === 'voice-message'} />
                : <button onClick={() => isPreviewable(file.name ?? '', file.mimetype) ? setFilePreview(true) : downloadTalkFile(file, msg.actorId)}
                          title={isPreviewable(file.name ?? '', file.mimetype) ? 'Visualizar arquivo' : 'Baixar arquivo'}
                          className={`flex items-center gap-1.5 text-left hover:underline ${isMe ? 'text-white' : 'text-blue-700'}`}>
                    <Download size={13} className="flex-shrink-0 opacity-80" />
                    <span className="break-all">{file.name}</span>
                  </button>}
              {caption && (
                <div className={isImage ? 'px-2 pb-1 pt-1.5' : 'mt-1'}>
                  {renderBubbleContent(caption, isMe, onIssueClick)}
                </div>
              )}
            </>
          ) : callRoom ? (
            <CallCard room={callRoom} isMe={isMe} />
          ) : (
            renderBubbleContent(resolveMessageText(msg), isMe, onIssueClick)
          )}
        </div>
        </div>
        {/* OG preview — só para mensagens de texto com URL externa (não em chamadas) */}
        {!file && !callRoom && (() => {
          const text = resolveMessageText(msg);
          const url = findPreviewUrl(text);
          return url ? <OGPreview url={url} /> : null;
        })()}
        <ReactionBar reactions={reactions} reactionsSelf={reactionsSelf}
                     onToggle={(e, remove) => onReact(msg.id, e, remove)} />
        <div className={`flex items-center gap-1 mt-0.5 px-1 justify-end transition-opacity ${
          groupedWithNext ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
        }`}>
          {msg._status === 'failed' ? (
            <button onClick={() => onRetry?.(msg)}
                    className="flex items-center gap-1 text-red-500 hover:text-red-600 transition-colors"
                    title="Falha ao enviar — toque para reenviar" aria-label="Reenviar mensagem">
              <AlertCircle size={11} />
              <span className="text-[9px] font-medium">Não enviada</span>
              <RotateCw size={10} />
            </button>
          ) : (
          <>
          <span className="text-[9px] text-slate-400"
                title={format(new Date(msg.timestamp * 1000), "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}>
            {format(new Date(msg.timestamp * 1000), 'HH:mm')}
          </span>
          {isMe && msg._status === 'sending' && (
            <Loader2 size={11} className="text-slate-400 animate-spin" />
          )}
          {isMe && !msg._status && (
            <button
              onClick={() => onShowInfo?.(msg)}
              title={readStatusAvailable ? 'Ver informações de leitura' : 'Enviada'}
              className="relative group/receipt flex items-center justify-center hover:opacity-70 transition-opacity">
              {readStatusAvailable && readers.length > 0 ? (
                // ✓✓ azul = todos leram; cinza = alguns leram (grupo).
                <CheckCheck
                  size={12}
                  strokeWidth={2.5}
                  className={readers.length >= numActiveParticipants && numActiveParticipants > 0 ? "text-blue-500" : "text-slate-400"}
                />
              ) : (
                // ✓ = enviada (ainda não lida, ou servidor não compartilha leitura).
                <Check size={11} strokeWidth={2.5} className="text-slate-400" />
              )}
              {readStatusAvailable && readers.length > 0 && (
                <div className="absolute bottom-full mb-1 right-0 hidden group-hover/receipt:block z-50 w-max max-w-[200px] bg-slate-800 text-white text-[10px] py-1 px-2 rounded shadow-lg text-left">
                  Lido por: {readers.join(', ')}
                </div>
              )}
            </button>
          )}
          </>
          )}
        </div>
      </div>

      {filePreview && file && (
        <FilePreviewModal
          file={{ name: file.name ?? 'arquivo', mime: file.mimetype, ncFileId: file.id }}
          load={() => fetchTalkFileBlob(file, msg.actorId)}
          onDownload={() => downloadTalkFile(file, msg.actorId)}
          ncUrl={getTalkAuth()?.url}
          onClose={() => setFilePreview(false)}
        />
      )}
    </div>
  );
}

// ─── Indicador de digitação ───────────────────────────────────────────────────

function TypingIndicator({ users, myId }: {
  users: Array<{ actorId: string; actorDisplayName: string }>;
  myId: string;
}) {
  const others = users.filter(u => u.actorId !== myId);
  if (others.length === 0) return null;
  const names = others.map(u => u.actorDisplayName.split(' ')[0]).join(', ');
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <div className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
               style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <span className="text-[10px] text-slate-400">{names} está digitando…</span>
    </div>
  );
}

// ─── Input com autocomplete de @menção, reply e typing ───────────────────────

function MessageInput({ token, onSend, isPending, replyTo, onCancelReply, editValue, onCancelEdit }: {
  token: string;
  onSend: (msg: string, replyTo?: number) => void;
  isPending: boolean;
  replyTo: TalkMessage | null;
  onCancelReply: () => void;
  editValue?: string;      // texto pré-preenchido ao editar
  onCancelEdit?: () => void;
}) {
  // Rascunho por sala: preserva o texto digitado ao fechar/reabrir a conversa.
  const draftKey = `talk-draft-${token}`;
  const [input, setInput] = useState(() => editValue ?? localStorage.getItem(draftKey) ?? '');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [issueQuery, setIssueQuery] = useState<string | null>(null);
  const [issueStart, setIssueStart] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Insere o emoji na posição atual do cursor (ou no fim).
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    setInput(next);
    setTimeout(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    }, 0);
  };

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = '0px';
      const scrollH = inputRef.current.scrollHeight;
      inputRef.current.style.height = `${Math.ceil(scrollH) + 2}px`;
    }
  }, [input]);
  const qc = useQueryClient();
  const { onType, stopTyping } = useTypingSender(token);
  const voice = useVoiceRecorder();

  // Revoga a URL de preview ao trocar/desmontar para evitar vazamento de memória
  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview); }, [pendingPreview]);

  // Inicia a gravação de uma mensagem de voz (pede permissão de microfone).
  const startVoice = async () => {
    setUploadError('');
    const ok = await voice.start();
    if (!ok) setUploadError('Não foi possível acessar o microfone.');
  };

  // Finaliza e envia a mensagem de voz. Encoda o PCM gravado em MP3 (formato nativo
  // de voice message do Talk; toca em qualquer cliente). Fallback para WAV.
  const sendVoice = async () => {
    const pcm = voice.finish();
    if (!pcm || pcm.samples.length === 0) return;
    setUploading(true); setUploadPct(0); setUploadError('');
    try {
      let file: File;
      try {
        const mp3 = await pcmToMp3(pcm.samples, pcm.sampleRate);
        file = new File([mp3], `Mensagem de voz ${Date.now()}.mp3`, { type: 'audio/mpeg' });
      } catch (convErr) {
        console.error('[voz] MP3 falhou, usando WAV:', convErr);
        const wav = pcmToWav(pcm.samples, pcm.sampleRate);
        file = new File([wav], `Mensagem de voz ${Date.now()}.wav`, { type: 'audio/wav' });
      }
      const result = await uploadFileToTalk(token, file, '', pct => setUploadPct(pct), { voiceMessage: true });
      if (result.success) qc.invalidateQueries({ queryKey: ['talk-messages', token] });
      else if (result.error) setUploadError(result.error);
    } catch (e: unknown) {
      setUploadError((e instanceof Error ? e.message : null) || 'Falha ao enviar o áudio.');
    } finally {
      setUploading(false);
    }
  };

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Coloca o arquivo em "rascunho" (preview) em vez de enviar direto
  const stagePendingFile = (file: File) => {
    setUploadError('');
    setPendingFile(file);
    setPendingPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const clearPendingFile = () => {
    setPendingFile(null);
    setPendingPreview(null);
  };

  // Sincroniza input quando o usuário troca de mensagem a editar
  useEffect(() => {
    if (editValue !== undefined) {
      setInput(editValue);
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
    } else {
      // Ao sair do modo edição, restaura o rascunho da sala (em vez de limpar)
      setInput(localStorage.getItem(draftKey) ?? '');
    }
  }, [editValue]);

  // Persiste o rascunho enquanto não está editando (e limpa quando esvazia/envia)
  useEffect(() => {
    if (editValue !== undefined) return;
    if (input) localStorage.setItem(draftKey, input);
    else localStorage.removeItem(draftKey);
  }, [input, editValue, draftKey]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stagePendingFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    stagePendingFile(files[0]);
  };

  const { data: participants = [] } = useQuery({
    queryKey: ['talk-participants', token],
    queryFn: () => fetchParticipants(token),
    enabled: mentionQuery !== null,
    staleTime: 60_000,
  });

  const { data: issueResults = [] } = useQuery({
    queryKey: ['issue-mention', issueQuery],
    queryFn: () => redmineApi.searchIssues(issueQuery!),
    enabled: issueQuery !== null && issueQuery.length >= 1,
    staleTime: 30_000,
  });

  const ALL_PSEUDO: TalkParticipant = { actorId: 'all', actorType: 'special', displayName: 'Todos', participantType: 0 };
  const filtered: TalkParticipant[] = mentionQuery !== null
    ? [
        ...('todos'.includes(mentionQuery.toLowerCase()) || 'all'.includes(mentionQuery.toLowerCase()) || mentionQuery === ''
          ? [ALL_PSEUDO] : []),
        ...participants.filter(p => p.actorType === 'users' &&
            p.displayName.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5),
      ]
    : [];

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    onType();
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    // Detecta @menção
    const atIdx = before.lastIndexOf('@');
    if (atIdx >= 0) {
      const q = before.slice(atIdx + 1);
      if (!q.includes(' ')) { setMentionStart(atIdx); setMentionQuery(q); setIssueQuery(null); return; }
    }
    setMentionQuery(null);
    // Detecta #issue
    const hashIdx = before.lastIndexOf('#');
    if (hashIdx >= 0) {
      const q = before.slice(hashIdx + 1);
      if (/^\d*$/.test(q) && !q.includes(' ') && q.length <= 8) {
        setIssueStart(hashIdx);
        setIssueQuery(q);
        return;
      }
    }
    setIssueQuery(null);
  };

  const insertIssueMention = (issue: { id: number; subject: string }) => {
    const before = input.slice(0, issueStart);
    const after = input.slice(issueStart + 1 + (issueQuery?.length ?? 0));
    setInput(`${before}#${issue.id} ${after}`);
    setIssueQuery(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const insertMention = (p: TalkParticipant) => {
    const before = input.slice(0, mentionStart);
    const after = input.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    // @all = mencionar todos; outros = actorId
    setInput(`${before}@${p.actorId} ${after}`);
    setMentionQuery(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submit = async () => {
    if (isPending || uploading) return;

    // Rascunho de arquivo: envia o anexo com o texto como legenda
    if (pendingFile) {
      const caption = input.trim();
      stopTyping();
      setUploading(true); setUploadPct(0); setUploadError('');
      try {
        const result = await uploadFileToTalk(token, pendingFile, caption, pct => setUploadPct(pct));
        if (result.success) {
          qc.invalidateQueries({ queryKey: ['talk-messages', token] });
          clearPendingFile();
          setInput('');
          setMentionQuery(null);
        } else if (result.error) {
          setUploadError(result.error);
        }
      } catch (e: unknown) {
        setUploadError((e instanceof Error ? e.message : null) || 'Falha ao enviar arquivo.');
      } finally {
        setUploading(false);
      }
      return;
    }

    const text = input.trim();
    if (!text) return;
    stopTyping();
    onSend(text, replyTo?.id);
    setInput('');
    setMentionQuery(null);
  };

  return (
    <div className="relative flex-shrink-0">
      {filtered.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-10">
          {filtered.map(p => (
            <button key={p.actorId}
                    onMouseDown={e => { e.preventDefault(); insertMention(p); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors">
              {p.actorId === 'all'
                ? <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">@</div>
                : <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                    {p.displayName.charAt(0).toUpperCase()}
                  </div>
              }
              <div className="min-w-0">
                <span className="text-xs font-medium text-slate-700 truncate block">{p.displayName}</span>
                <span className="text-[10px] text-slate-400">{p.actorId === 'all' ? 'Notifica todos os participantes' : p.actorId}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Autocomplete de #issue */}
      {issueQuery !== null && issueResults.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-10 max-h-48 overflow-y-auto">
          {issueResults.slice(0, 6).map(issue => (
            <button key={issue.id}
                    onMouseDown={e => { e.preventDefault(); insertIssueMention(issue); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors">
              <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center text-blue-700 text-[9px] font-bold flex-shrink-0 font-mono">
                #
              </div>
              <div className="min-w-0">
                <span className="text-xs font-medium text-slate-700 truncate block">{issue.subject}</span>
                <span className="text-[10px] text-slate-400">#{issue.id}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Citação do reply */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-t border-slate-100 bg-slate-50">
          <Reply size={12} className="text-blue-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-slate-500">{replyTo.actorDisplayName.split(' ')[0]}: </span>
            <span className="text-[10px] text-slate-400 truncate">{resolveMessageText(replyTo).slice(0, 80)}</span>
          </div>
          <button onClick={onCancelReply} className="text-slate-400 hover:text-slate-600">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Rascunho de anexo (preview antes de enviar) */}
      {pendingFile && !uploading && (
        <div className="flex items-center gap-2.5 px-3 pt-2 pb-1 border-t border-slate-100 bg-slate-50">
          {pendingPreview ? (
            <img src={pendingPreview} alt={pendingFile.name}
                 className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
              <Paperclip size={18} className="text-slate-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">{pendingFile.name}</p>
            <p className="text-[10px] text-slate-400">
              {(pendingFile.size / 1024).toFixed(0)} KB · adicione uma descrição abaixo
            </p>
          </div>
          <button onClick={clearPendingFile} className="text-slate-400 hover:text-slate-600 flex-shrink-0"
                  title="Remover anexo">
            <X size={14} />
          </button>
        </div>
      )}

      {uploading && (
        <div className="px-3 pt-2 pb-1 border-t border-slate-100">
          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-200 rounded-full" style={{ width: `${uploadPct}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">Enviando… {uploadPct}%</p>
        </div>
      )}
      {uploadError && <p className="px-3 pb-1 text-[10px] text-red-500">{uploadError}</p>}

      {voice.recording ? (
        // Barra de gravação de voz: cancelar · timer · enviar
        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
          <button onClick={voice.cancel} title="Cancelar"
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
            <Trash2 size={15} />
          </button>
          <div className="flex-1 flex items-center gap-2 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="font-medium tabular-nums">{fmtDur(voice.seconds)}</span>
            <span className="text-slate-400">Gravando…</span>
          </div>
          <button onClick={sendVoice} disabled={uploading}
                  title="Enviar áudio"
                  className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full transition-colors flex-shrink-0">
            <Send size={12} />
          </button>
        </div>
      ) : (
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-slate-100">
        <input type="file" ref={fileRef} onChange={handleFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
                title="Enviar arquivo"
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40">
          <Paperclip size={14} />
        </button>
        <div className="relative flex-shrink-0">
          <button onClick={() => setShowEmoji(v => !v)} disabled={uploading}
                  title="Emoji"
                  className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${showEmoji ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
            <Smile size={14} />
          </button>
          {showEmoji && (
            <FullEmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} align="left" position="bottom" />
          )}
        </div>
        <textarea ref={inputRef} value={input} onChange={handleChange}
               rows={1}
               onKeyDown={e => {
                 if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                 if (e.key === 'Escape') { setMentionQuery(null); setIssueQuery(null); clearPendingFile(); onCancelReply(); onCancelEdit?.(); }
               }}
               onPaste={handlePaste}
               placeholder={
                 editValue !== undefined ? 'Editando mensagem…'
                 : pendingFile ? 'Adicione uma descrição… (opcional)'
                 : 'Mensagem… (@nome para mencionar)'
               }
               className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder-slate-400 resize-none max-h-32 overflow-y-auto scrollbar-thin leading-relaxed"
        />
        {input.trim() || pendingFile ? (
          <button onClick={submit} disabled={isPending || uploading}
                  className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full transition-colors flex-shrink-0">
            <Send size={12} />
          </button>
        ) : (
          <button onClick={startVoice} disabled={uploading}
                  title="Gravar mensagem de voz"
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-full transition-colors flex-shrink-0 disabled:opacity-40">
            <Mic size={15} />
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Janela de chat ───────────────────────────────────────────────────────────

function ChatWindow({ room, onClose, onMinimize, myId, onIssueClick, hasNewMsg, onOpenRoom }: {
  room: TalkRoom;
  onClose: () => void;
  onMinimize: () => void;
  myId: string;
  onIssueClick?: (id: number) => void;
  hasNewMsg: boolean;
  onOpenRoom: (room: TalkRoom) => void;
}) {
  const qc = useQueryClient();
  const { data: messages = [], isLoading } = useTalkMessages(room.token);
  const { data: me } = useTalkCurrentUser();
  const send = useSendMessage(room.token, myId, me?.displayName ?? '');
  const editMsg = useEditMessage(room.token);
  const deleteMsg = useDeleteMessage(room.token);
  const react = useReaction(room.token);
  const { startCall, activeCall, poppedOut } = useJitsi();

  // Inicia uma chamada de vídeo na sala da conversa e avisa no chat com um card.
  // Se já estiver nessa sala, só foca a chamada (não posta outro card).
  const startVideoCall = useCallback(() => {
    const jitsiRoom = makeTalkRoom(room.token);
    const alreadyHere = activeCall?.room === jitsiRoom || poppedOut?.room === jitsiRoom;
    startCall({ room: jitsiRoom, title: room.displayName, kind: 'adhoc' });
    if (!alreadyHere) {
      send.mutate({ message: `📞 Iniciei uma chamada de vídeo — entre: ${jitsiRoomUrl(jitsiRoom)}` });
    }
  }, [room.token, room.displayName, startCall, activeCall, poppedOut, send]);

  // Participantes — para "visto por" e @todos
  const { data: participants = [] } = useQuery({
    queryKey: ['talk-participants', room.token],
    queryFn: () => fetchParticipants(room.token),
    // Recibos de leitura dependem do lastReadMessage destes participantes;
    // intervalo mais curto + refetch ao focar deixam ✓ → ✓✓ mais responsivo.
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    enabled: !!getTalkAuth(),
  });

  // Participantes ativos (exceto eu mesmo)
  const activeParticipants = useMemo(() => 
    participants.filter(p => p.actorId !== myId && p.actorType === 'users'),
  [participants, myId]);
  const numActiveParticipants = activeParticipants.length;

  const getReadersForMessage = useCallback((msgId: number) => {
    return activeParticipants
      .filter(p => (p.lastReadMessage ?? 0) >= msgId)
      .map(p => p.displayName.split(' ')[0]);
  }, [activeParticipants]);

  // Alguns servidores/versões do Talk NÃO expõem `lastReadMessage` nos participantes
  // (recurso de read-status desativado/ausente). Detectamos isso para não exibir um
  // recibo de leitura enganoso (✓✓ que nunca acende) — caindo para "Enviada" (✓).
  const readStatusAvailable = useMemo(
    () => participants.some(p => typeof p.lastReadMessage === 'number'),
    [participants],
  );

  // Mute por sala
  const [muted, setMuted] = useState(() => talkMute.isMuted(room.token));
  const [menuOpen, setMenuOpen] = useState(false);

  // Drag-and-drop de arquivo
  const [isDragging, setIsDragging] = useState(false);
  const [dropUploading, setDropUploading] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if ([...e.dataTransfer.types].includes('Files')) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragging(false); }
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setDropUploading(true);
    try {
      const result = await uploadFileToTalk(room.token, file);
      if (result.success) qc.invalidateQueries({ queryKey: ['talk-messages', room.token] });
    } catch { /* silencia — o upload já mostra erro no MessageInput */ }
    finally { setDropUploading(false); }
  };

  const scrollRef  = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 420 });
  const sizeRef = useRef(size);

  // Load more (mensagens mais antigas)
  const [olderMessages, setOlderMessages] = useState<TalkMessage[]>([]);
  // Se a carga inicial retornou < 50, não há mais mensagens para buscar
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!isLoading && messages.length > 0 && messages.length < 50) setHasMore(false);
  }, [isLoading, messages.length]);

  // "Nova mensagem" badge quando scrollado para cima
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const prevMsgCount = useRef(0);

  // Reply / edit
  const [replyTo, setReplyTo] = useState<TalkMessage | null>(null);
  const [editTarget, setEditTarget] = useState<TalkMessage | null>(null);
  // O Talk nem sempre devolve `parent` nas mensagens do próprio autor; guardamos
  // a citação localmente (por id da mensagem enviada) p/ mostrar a referência.
  const [replyParents, setReplyParents] = useState<Record<number, NonNullable<TalkMessage['parent']>>>({});

  // Divisor "Novas mensagens": fixa o id da 1ª não-lida ao abrir a sala (estável,
  // não se move conforme você lê). Usa a contagem de não-lidas da sala no momento.
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  const unreadComputed = useRef(false);
  const initialUnread = useRef(room.unreadMessages);
  useEffect(() => {
    if (unreadComputed.current || isLoading || messages.length === 0) return;
    unreadComputed.current = true;
    const count = initialUnread.current;
    if (count > 0) {
      const newestFirst = [...messages].sort((a, b) => b.id - a.id);
      const target = newestFirst[Math.min(count, newestFirst.length) - 1];
      // não mostra "novas" se a 1ª não-lida for minha própria mensagem
      if (target && target.actorId !== myId) setFirstUnreadId(target.id);
    }
  }, [isLoading, messages, myId]);

  // Indica que estamos carregando o contexto de uma mensagem antiga p/ pular até ela.
  const [jumpingTo, setJumpingTo] = useState<number | null>(null);

  // Rola até uma mensagem e a destaca. Se ela ainda não estiver carregada na tela,
  // busca o contexto histórico (50 msgs até ela) e então rola.
  const jumpToMessage = useCallback(async (id: number) => {
    let el = document.getElementById(`talk-msg-${id}`);
    if (!el) {
      setJumpingTo(id);
      try {
        // lastKnownMessageId = id+1 → retorna as 50 mensagens até (e incluindo) a alvo
        const ctx = await fetchMessages(room.token, { lastKnownMessageId: id + 1 });
        setOlderMessages(prev => {
          const ids = new Set(prev.map(m => m.id));
          return [...prev, ...ctx.filter(m => !ids.has(m.id))];
        });
        setHasMore(true);
      } catch { /* sem permissão de contexto — ignora */ }
      finally { setJumpingTo(null); }
      await new Promise(r => setTimeout(r, 350)); // espera o render do contexto
      el = document.getElementById(`talk-msg-${id}`);
    }
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('talk-flash');
    setTimeout(() => el!.classList.remove('talk-flash'), 1200);
  }, [room.token]);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Busca global (servidor) — debounce p/ não disparar a cada tecla
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const { data: serverResults = [], isFetching: searching } = useQuery({
    queryKey: ['talk-search', room.token, debouncedSearch],
    queryFn: () => searchMessages(room.token, debouncedSearch),
    enabled: searchOpen && debouncedSearch.length >= 2,
    staleTime: 30_000,
  });

  // Pula até um resultado da busca: fecha a busca e delega ao jumpToMessage
  // (que já carrega o contexto histórico se necessário).
  const jumpToSearchResult = useCallback((messageId: number) => {
    setSearchOpen(false);
    setSearchQuery('');
    jumpToMessage(messageId);
  }, [jumpToMessage]);

  // Pop-up de perfil de usuário
  const [profileUser, setProfileUser] = useState<{ actorId: string; displayName: string } | null>(null);

  // Painel de informações do grupo
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const isGroup = room.type !== 1;

  // Painel de arquivos e links compartilhados
  const [showMedia, setShowMedia] = useState(false);

  // Painel "Informações da mensagem" (recibos de leitura)
  const [infoMsg, setInfoMsg] = useState<TalkMessage | null>(null);

  // Presença (DM)
  const { data: statuses } = useUserStatuses();
  const dmStatus = room.type === 1 ? statuses?.get(room.name)?.status : undefined;

  // Abre (ou cria) uma DM com o usuário e a traz para frente.
  const openDM = useCallback(async (userId: string) => {
    try {
      const dm = await createRoom(1, userId);
      qc.invalidateQueries({ queryKey: ['talk-rooms'] });
      onOpenRoom(dm);
    } catch { /* falha silenciosa — usuário pode tentar pela lista */ }
  }, [qc, onOpenRoom]);

  // Conexão
  const [connected, setConnected] = useState(true);

  // SSE para tempo real
  // SSE começa pelo lastMessage.id da sala (já disponível no listing de rooms),
  // garantindo que nunca faça catch-up por mensagens históricas. Só recebe mensagens futuras.
  const sseStartId = room.lastMessage?.id ?? 0;
  const { typingUsers } = useTalkSSE(room.token, sseStartId);

  // Combina recentes + antigas, deduplica por ID e ordena newest-first.
  // Ordenação explícita garante exibição correta independente da ordem da API.
  const allMessages = useMemo(() => {
    const byId = new Map([...messages, ...olderMessages].map(m => [m.id, m]));
    return [...byId.values()].sort((a, b) => b.id - a.id);
  }, [messages, olderMessages]);

  const visibleMessages = useMemo(() => {
    // reverse() converte newest-first → oldest-first para renderização top→bottom
    // Busca agora é global (painel de resultados + pular), então não filtramos a
    // lista inline — a conversa permanece visível durante a pesquisa.
    return [...allMessages]
      .reverse()
      .filter(m => {
        // Mensagens de voz são um tipo próprio ('voice-message') — sempre exibir.
        if (m.messageType === 'voice-message') return true;
        // file_shared é um systemMessage legítimo de arquivo — nunca excluir
        const hasFile = m.message === '{file}' || !!Object.values(m.messageParameters ?? {}).find(p => p.type === 'file');
        return m.messageType === 'comment' && (!m.systemMessage || hasFile);
      });
  }, [allMessages]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || allMessages.length === 0) return;
    // allMessages está newest-first; o mais antigo está no último índice
    const oldestId = allMessages[allMessages.length - 1].id;
    setLoadingMore(true);
    try {
      const older = await fetchMessages(room.token, { lastKnownMessageId: oldestId });
      const existingIds = new Set(allMessages.map(m => m.id));
      const toAdd = older.filter(m => m.id < oldestId && !existingIds.has(m.id));
      if (toAdd.length === 0) {
        setHasMore(false);
      } else {
        setOlderMessages(prev => {
          const ids = new Set(prev.map(m => m.id));
          return [...prev, ...toAdd.filter(m => !ids.has(m.id))];
        });
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const startResize = useCallback((e: React.MouseEvent, dir: 'top' | 'left' | 'both') => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const { w: sw, h: sh } = sizeRef.current;
    const onMove = (ev: MouseEvent) => {
      const w = dir !== 'top'  ? Math.max(260, sw + (startX - ev.clientX)) : sw;
      const h = dir !== 'left' ? Math.max(300, sh + (startY - ev.clientY)) : sh;
      sizeRef.current = { w, h };
      setSize({ w, h });
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Marca como lido apenas se a janela estiver visível. Depende do id da última
  // mensagem (não só da contagem) — re-marca quando chega/edita a última via SSE.
  // Ignora bolhas otimistas (id temporário) para não marcar um id inexistente.
  const lastMsgId = messages.find(m => !m._status)?.id ?? 0;
  useEffect(() => {
    if (!lastMsgId) return;

    const tryMarkRead = () => {
      if (!document.hidden) {
        markMessagesRead(room.token, lastMsgId)
          .then(() => qc.invalidateQueries({ queryKey: ['talk-rooms'] }))
          .catch(() => {});
      }
    };

    tryMarkRead();

    const onVisibilityChange = () => {
      if (!document.hidden) tryMarkRead();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [lastMsgId, room.token]);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (force || dist < 300) el.scrollTop = el.scrollHeight;
  }, []);

  // Só força scroll no carregamento inicial (0 → N). Depois, apenas rola se já
  // estiver perto do fim — evita perder a posição ao carregar mensagens antigas.
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (messages.length === 0) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      prevMsgCount.current = messages.length;
      scrollToBottom(true);
      return;
    }
    const el = scrollRef.current;
    const dist = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
    const newMsgs = messages.length - prevMsgCount.current;
    prevMsgCount.current = messages.length;
    if (dist < 300) {
      scrollToBottom(false);
      setUnreadWhileScrolled(0);
    } else if (newMsgs > 0) {
      setUnreadWhileScrolled(p => p + newMsgs);
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => scrollToBottom());
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const handleSend = (text: string, replyId?: number) => {
    if (editTarget) {
      editMsg.mutate({ messageId: editTarget.id, message: text });
      setEditTarget(null);
    } else {
      const repliedTo = replyTo;
      const parentForTemp = repliedTo ? {
        id: repliedTo.id,
        actorDisplayName: repliedTo.actorDisplayName,
        message: repliedTo.message,
        messageParameters: repliedTo.messageParameters,
        messageType: repliedTo.messageType,
      } : undefined;
      send.mutate({ message: text, replyTo: replyId, _parent: parentForTemp, _text: text }, {
        onSuccess: (data) => {
          // Persiste a citação da própria mensagem: usa o parent do servidor se vier,
          // senão sintetiza a partir da mensagem que estava sendo respondida.
          if (!replyId || !data?.id) return;
          const parent = data.parent ?? parentForTemp ?? null;
          if (parent) setReplyParents(prev => ({ ...prev, [data.id]: parent }));
        },
      });
    }
    setReplyTo(null);
  };

  // Reenvia uma mensagem que falhou: remove a bolha de erro e dispara novo envio.
  const retrySend = useCallback((msg: TalkMessage) => {
    qc.setQueryData(['talk-messages', room.token], (old: TalkMessage[] = []) =>
      old.filter(m => m.id !== msg.id));
    const text = msg._clientText ?? msg.message;
    send.mutate({ message: text, replyTo: msg._clientReplyTo, _parent: msg.parent, _text: text });
  }, [qc, room.token, send]);

  // Copiar texto da mensagem + feedback efêmero ("Copiado!")
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyMessage = useCallback((msg: TalkMessage) => {
    navigator.clipboard?.writeText(resolveMessageText(msg))
      .then(() => { setCopiedId(msg.id); setTimeout(() => setCopiedId(null), 1500); })
      .catch(() => {});
  }, []);

  // Encaminhar: escolhe uma sala de destino num diálogo
  const [forwardMsg, setForwardMsg] = useState<TalkMessage | null>(null);

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-t-xl shadow-2xl overflow-hidden relative"
         style={{ width: size.w, height: size.h }}
         onDragEnter={handleDragEnter}
         onDragOver={e => e.preventDefault()}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}>

      {/* Overlay drag-and-drop */}
      {isDragging && (
        <div className="talk-drag-overlay absolute inset-0 z-50 flex flex-col items-center justify-center bg-blue-50/90 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none">
          <Paperclip size={28} className="text-blue-500 mb-2" />
          <p className="text-sm font-semibold text-blue-600">Soltar para enviar</p>
        </div>
      )}
      {dropUploading && (
        <div className="talk-upload-overlay absolute inset-0 z-50 flex items-center justify-center bg-white/70 rounded-xl">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-500">Enviando…</span>
          </div>
        </div>
      )}

      {/* Alças de redimensionamento */}
      <div className="absolute top-0 left-6 right-0 h-1.5 cursor-ns-resize z-20 group"
           onMouseDown={e => startResize(e, 'top')}>
        <div className="absolute inset-x-0 top-0 h-px group-hover:bg-blue-400 transition-colors" />
      </div>
      <div className="absolute top-6 left-0 bottom-0 w-1.5 cursor-ew-resize z-20 group"
           onMouseDown={e => startResize(e, 'left')}>
        <div className="absolute inset-y-0 left-0 w-px group-hover:bg-blue-400 transition-colors" />
      </div>
      <div className="absolute top-0 left-0 w-6 h-6 cursor-nwse-resize z-30 flex items-center justify-center"
           onMouseDown={e => startResize(e, 'both')} title="Arrastar para redimensionar">
        <svg width="8" height="8" viewBox="0 0 8 8" className="text-slate-300 hover:text-blue-400 transition-colors">
          {[1,4,7].flatMap(x => [1,4,7].map(y => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor"/>
          )))}
        </svg>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-100 flex-shrink-0">
        {isGroup ? (
          <button onClick={() => setShowGroupInfo(true)}
                  className="flex items-center gap-2 flex-1 min-w-0 group/hdr text-left"
                  title="Informações do grupo">
            <RoomAvatar room={room} size={28} />
            <span className="flex-1 text-xs font-semibold text-slate-800 truncate group-hover/hdr:text-blue-600 transition-colors">{room.displayName}</span>
          </button>
        ) : (
          <>
            <RoomAvatar room={room} size={28} status={dmStatus} />
            <span className="flex-1 text-xs font-semibold text-slate-800 truncate">{room.displayName}</span>
          </>
        )}
        {hasNewMsg && (
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" title="Nova mensagem" />
        )}
        {/* Status de conexão */}
        <span title={connected ? 'Conectado' : 'Sem conexão'}>
          {connected
            ? <Wifi size={11} className="text-green-400 flex-shrink-0" />
            : <WifiOff size={11} className="text-red-400 flex-shrink-0" />
          }
        </span>
        <div className="relative">
          <button onClick={() => setMenuOpen(v => !v)}
                  className={`p-1 rounded transition-colors ${menuOpen ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                  title="Mais ações">
            <MoreVertical size={13} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1 overflow-hidden" onClick={() => setMenuOpen(false)}>
                <button onClick={() => setSearchOpen(v => !v)} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                  <Search size={13} className="text-slate-400" /> Buscar
                </button>
                <button onClick={() => setShowMedia(true)} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                  <Files size={13} className="text-slate-400" /> Arquivos e Links
                </button>
                <button onClick={startVideoCall} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                  <Video size={13} className="text-slate-400" /> Iniciar Chamada
                </button>
                <button onClick={() => setMuted(talkMute.toggle(room.token))} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                  {muted ? <BellOff size={13} className="text-amber-500" /> : <Bell size={13} className="text-slate-400" />} {muted ? 'Ativar Notificações' : 'Silenciar Sala'}
                </button>
              </div>
            </>
          )}
        </div>
        <button onClick={onMinimize} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <Minus size={12} />
        </button>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Busca */}
      {searchOpen && (
        <div className="border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <div className="px-3 py-2 flex items-center gap-2">
            <Search size={12} className="text-slate-400 flex-shrink-0" />
            <input
              autoFocus
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }}}
              placeholder="Buscar em todo o histórico…"
              className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400"
            />
            {searching && <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                <X size={11} />
              </button>
            )}
          </div>

          {/* Resultados no histórico (servidor) */}
          {debouncedSearch.length >= 2 && (
            <div className="max-h-48 overflow-y-auto border-t border-slate-100 scrollbar-thin">
              {jumpingTo !== null && (
                <p className="text-[11px] text-blue-500 text-center py-2 flex items-center justify-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Carregando contexto…
                </p>
              )}
              {!searching && serverResults.length === 0 && (
                <p className="text-[11px] text-slate-400 text-center py-3">Nenhum resultado no histórico</p>
              )}
              {serverResults.map(r => (
                <button key={r.id} onClick={() => jumpToSearchResult(r.id)}
                        className="w-full flex flex-col gap-0.5 px-3 py-2 hover:bg-blue-50 text-left border-b border-slate-100 last:border-0 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 truncate">{r.actorDisplayName}</span>
                    {r.timestamp > 0 && (
                      <span className="text-[9px] text-slate-400 flex-shrink-0">
                        {format(new Date(r.timestamp * 1000), "d MMM yyyy", { locale: ptBR })}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500 line-clamp-2">{r.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Badge "↓ nova mensagem" quando scrollado para cima */}
      {unreadWhileScrolled > 0 && (
        <div className="relative flex-shrink-0">
          <button
            onClick={() => { scrollToBottom(true); setUnreadWhileScrolled(0); }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium rounded-full shadow-lg hover:bg-blue-700 transition-colors"
          >
            ↓ {unreadWhileScrolled} nova{unreadWhileScrolled > 1 ? 's' : ''} mensagem{unreadWhileScrolled > 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin" ref={scrollRef}
           onScroll={() => {
             const el = scrollRef.current;
             if (!el) return;
             const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
             if (dist < 50) setUnreadWhileScrolled(0);
           }}>
        <div ref={contentRef}>
          {/* Carregar mais */}
          {hasMore && (
            <div className="flex justify-center mb-3">
              <button onClick={loadMore} disabled={loadingMore}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-1 transition-colors disabled:opacity-50">
                <ChevronUp size={12} />
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center h-20 text-slate-400 text-xs">Carregando…</div>
          )}
          {!isLoading && visibleMessages.length === 0 && (
            <div className="flex items-center justify-center h-20 text-slate-400 text-xs">Nenhuma mensagem ainda</div>
          )}
          {visibleMessages.map((m, idx) => {
            const isMe = m.actorId === myId;
            const prev = visibleMessages[idx - 1];
            const next = visibleMessages[idx + 1];
            const divider = dividerLabel(prev, m);
            const grouped = !divider && !!prev && prev.actorId === m.actorId && (m.timestamp - prev.timestamp) < 5 * 60;
            // Agrupada com a próxima? (mesmo autor, <5min e sem divisor entre elas)
            // Controla a margem inferior e a exibição do horário (sempre visível na última do bloco).
            const groupedWithNext = !!next && next.actorId === m.actorId
              && (next.timestamp - m.timestamp) < 5 * 60
              && !dividerLabel(m, next);
            const isDM = room.type === 1;
            const showSender = !isMe && !grouped && !isDM;
            // Completa a citação caso o servidor não tenha mandado o parent (msgs próprias)
            const msg = m.parent || !replyParents[m.id] ? m : { ...m, parent: replyParents[m.id] };
            return (
              <Fragment key={m.id}>
                {divider && <DateDivider label={divider} />}
                {m.id === firstUnreadId && <UnreadDivider />}
                <Bubble msg={msg} isMe={isMe} myId={myId}
                        showSender={showSender} grouped={grouped} groupedWithNext={groupedWithNext} isDM={isDM}
                        onIssueClick={onIssueClick}
                        onJumpTo={jumpToMessage}
                        onReply={msg => { setReplyTo(msg); setEditTarget(null); }}
                        onEdit={msg => { setEditTarget(msg); setReplyTo(null); }}
                        onDelete={msg => deleteMsg.mutate(msg.id)}
                        onReact={(msgId, emoji, remove) => react.mutate({ messageId: msgId, reaction: emoji, remove })}
                        onRetry={retrySend}
                        onCopy={copyMessage}
                        onForward={setForwardMsg}
                        onAvatarClick={(actorId, displayName) => setProfileUser({ actorId, displayName })}
                        onShowInfo={setInfoMsg}
                        mentionsMe={messageMentionsMe(m, myId)}
                        readers={getReadersForMessage(m.id)}
                        numActiveParticipants={numActiveParticipants}
                        readStatusAvailable={readStatusAvailable}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Indicador de digitação */}
      <TypingIndicator users={typingUsers} myId={myId} />

      {/* Edit mode banner */}
      {editTarget && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-t border-amber-100">
          <Pencil size={11} className="text-amber-500 flex-shrink-0" />
          <span className="text-[10px] text-amber-600 flex-1 truncate">Editando mensagem</span>
          <button onClick={() => setEditTarget(null)} className="text-amber-400 hover:text-amber-600">
            <X size={11} />
          </button>
        </div>
      )}

      <MessageInput
        token={room.token}
        onSend={handleSend}
        isPending={send.isPending || editMsg.isPending}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editValue={editTarget ? resolveMessageText(editTarget) : undefined}
        onCancelEdit={() => setEditTarget(null)}
      />

      {profileUser && (
        <UserProfilePopup
          actorId={profileUser.actorId}
          displayName={profileUser.displayName}
          myId={myId}
          onClose={() => setProfileUser(null)}
          onOpenDM={openDM}
        />
      )}

      {showGroupInfo && (
        <GroupInfoPanel
          room={room}
          myId={myId}
          onClose={() => setShowGroupInfo(false)}
          onLeft={() => { setShowGroupInfo(false); onClose(); }}
        />
      )}

      {showMedia && (
        <MediaPanel token={room.token} messages={allMessages} onClose={() => setShowMedia(false)} />
      )}

      {infoMsg && (
        <MessageInfoPanel msg={infoMsg} participants={participants} myId={myId}
                          readStatusAvailable={readStatusAvailable} onClose={() => setInfoMsg(null)} />
      )}

      {forwardMsg && (
        <ForwardDialog msg={forwardMsg} onClose={() => setForwardMsg(null)} />
      )}

      {copiedId !== null && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-slate-800 text-white text-[11px] px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
          Copiado!
        </div>
      )}
    </div>
  );
}

// ─── Painel de informações do grupo (self-service) ───────────────────────────

// participantType: 1=dono 2=moderador 3=usuário 4=convidado 5=auto-entrou 6=conv.mod
function roleLabel(type: number): string | null {
  if (type === 1) return 'Dono';
  if (type === 2 || type === 6) return 'Moderador';
  return null;
}

function GroupInfoPanel({ room, myId, onClose, onLeft }: {
  room: TalkRoom;
  myId: string;
  onClose: () => void;
  onLeft: () => void;
}) {
  const qc = useQueryClient();
  const canModerate = room.participantType === 1 || room.participantType === 2;

  const { data: participants = [] } = useQuery({
    queryKey: ['talk-participants', room.token],
    queryFn: () => fetchParticipants(room.token),
    staleTime: 10_000,
  });
  const { data: statuses } = useUserStatuses();

  const [name, setName] = useState(room.displayName);
  const [editingName, setEditingName] = useState(false);
  const [desc, setDesc] = useState((room as unknown as { description?: string }).description ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const avatarRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['talk-participants', room.token] });
    qc.invalidateQueries({ queryKey: ['talk-rooms'] });
    qc.invalidateQueries({ queryKey: ['talk-room-avatar', room.token] });
  };

  const { data: searchResults = [] } = useQuery({
    queryKey: ['talk-search-users', addQuery],
    queryFn: () => searchNCUsers(addQuery),
    enabled: addOpen && addQuery.length >= 2,
    staleTime: 30_000,
  });

  const existingIds = new Set(participants.map(p => p.actorId));

  const saveName = async () => {
    const v = name.trim();
    if (!v || v === room.displayName) { setEditingName(false); return; }
    setBusy(true);
    try { await renameRoom(room.token, v); refresh(); } finally { setBusy(false); setEditingName(false); }
  };
  const saveDesc = async () => {
    setBusy(true);
    try { await setRoomDescription(room.token, desc.trim()); refresh(); } finally { setBusy(false); setEditingDesc(false); }
  };
  const handleAdd = async (userId: string) => {
    setBusy(true);
    try { await addParticipant(room.token, userId); refresh(); setAddQuery(''); } finally { setBusy(false); }
  };
  const handleRemove = async (attendeeId?: number) => {
    if (!attendeeId) return;
    setBusy(true);
    try { await removeAttendee(room.token, attendeeId); refresh(); } finally { setBusy(false); }
  };
  const handleToggleMod = async (p: TalkParticipant) => {
    if (!p.attendeeId) return;
    setBusy(true);
    const isMod = p.participantType === 2 || p.participantType === 6;
    try {
      isMod ? await demoteModerator(room.token, p.attendeeId) : await promoteModerator(room.token, p.attendeeId);
      refresh();
    } finally { setBusy(false); }
  };
  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { await uploadRoomAvatar(room.token, file); refresh(); } finally { setBusy(false); if (avatarRef.current) avatarRef.current.value = ''; }
  };
  const handleLeave = async () => {
    setBusy(true);
    try { await leaveRoom(room.token); qc.invalidateQueries({ queryKey: ['talk-rooms'] }); onLeft(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-80 max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Cabeçalho com avatar e nome */}
        <div className="relative flex flex-col items-center pt-6 pb-4 px-5 bg-gradient-to-b from-indigo-50 to-white flex-shrink-0">
          <button onClick={onClose}
                  className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={14} />
          </button>
          <div className="relative">
            <RoomAvatar room={room} size={72} />
            {canModerate && (
              <>
                <input type="file" accept="image/*" ref={avatarRef} onChange={handleAvatar} className="hidden" />
                <button onClick={() => avatarRef.current?.click()} disabled={busy}
                        title="Trocar imagem do grupo"
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-md">
                  <Camera size={13} />
                </button>
              </>
            )}
          </div>

          {editingName ? (
            <div className="mt-3 flex items-center gap-1 w-full">
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(room.displayName); setEditingName(false); } }}
                     className="flex-1 text-sm font-semibold text-center bg-white border border-blue-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={saveName} disabled={busy} className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                <Check size={13} />
              </button>
            </div>
          ) : (
            <button onClick={() => canModerate && setEditingName(true)}
                    className={`mt-3 text-base font-semibold text-slate-800 text-center flex items-center gap-1.5 ${canModerate ? 'hover:text-blue-600' : 'cursor-default'}`}>
              {room.displayName}
              {canModerate && <Pencil size={11} className="text-slate-300" />}
            </button>
          )}
          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
            <Users size={11} /> {participants.length} participante{participants.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-3 space-y-4">
          {/* Descrição / tópico */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Descrição</span>
              {canModerate && !editingDesc && (
                <button onClick={() => setEditingDesc(true)} className="text-slate-300 hover:text-blue-500">
                  <Pencil size={11} />
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="space-y-1.5">
                <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
                          placeholder="Tópico do grupo…"
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
                <div className="flex gap-1.5 justify-end">
                  <button onClick={() => { setDesc((room as unknown as { description?: string }).description ?? ''); setEditingDesc(false); }}
                          className="px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 rounded-lg">Cancelar</button>
                  <button onClick={saveDesc} disabled={busy}
                          className="px-2 py-1 text-[11px] bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 whitespace-pre-wrap">{desc || <span className="text-slate-300 italic">Sem descrição</span>}</p>
            )}
          </div>

          {/* Participantes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Participantes</span>
              {canModerate && (
                <button onClick={() => setAddOpen(v => !v)}
                        className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium">
                  <UserPlus size={12} /> Adicionar
                </button>
              )}
            </div>

            {/* Busca para adicionar */}
            {addOpen && canModerate && (
              <div className="mb-2 border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border-b border-slate-100">
                  <Search size={12} className="text-slate-400" />
                  <input autoFocus value={addQuery} onChange={e => setAddQuery(e.target.value)}
                         placeholder="Buscar usuário…"
                         className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400" />
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {addQuery.length < 2 && <p className="text-[11px] text-slate-400 text-center py-2">Digite 2+ caracteres</p>}
                  {searchResults.filter(u => !existingIds.has(u.id)).map(u => (
                    <button key={u.id} onClick={() => handleAdd(u.id)} disabled={busy}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-blue-50 text-left">
                      <TalkAvatar actorId={u.id} displayName={u.label} size={22} />
                      <span className="text-xs text-slate-700 truncate">{u.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-0.5">
              {participants.filter(p => p.actorType === 'users').map(p => {
                const isMe = p.actorId === myId;
                const role = roleLabel(p.participantType);
                const isMod = p.participantType === 2 || p.participantType === 6;
                return (
                  <div key={p.actorId} className="flex items-center gap-2 py-1 group">
                    <TalkAvatar actorId={p.actorId} displayName={p.displayName} size={28} status={statuses?.get(p.actorId)?.status} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-slate-700 truncate block">
                        {p.displayName}{isMe && <span className="text-slate-400"> (você)</span>}
                      </span>
                      {role && <span className="text-[9px] text-amber-600 flex items-center gap-0.5"><Crown size={9} /> {role}</span>}
                    </div>
                    {canModerate && !isMe && p.participantType !== 1 && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleToggleMod(p)} disabled={busy}
                                title={isMod ? 'Remover moderador' : 'Tornar moderador'}
                                className={`p-1 rounded-lg ${isMod ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-100'}`}>
                          <Crown size={12} />
                        </button>
                        <button onClick={() => handleRemove(p.attendeeId)} disabled={busy}
                                title="Remover do grupo"
                                className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50">
                          <UserMinus size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sair do grupo */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-slate-100">
          {confirmLeave ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 flex-1">Sair deste grupo?</span>
              <button onClick={() => setConfirmLeave(false)} className="px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button onClick={handleLeave} disabled={busy} className="px-2 py-1 text-[11px] bg-red-600 text-white rounded-lg hover:bg-red-700">Sair</button>
            </div>
          ) : (
            <button onClick={() => setConfirmLeave(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors">
              <LogOut size={14} /> Sair do grupo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Painel de Arquivos e Links ───────────────────────────────────────────────

function fileParamOf(m: TalkMessage) {
  return m.messageParameters?.file
    ?? Object.values(m.messageParameters ?? {}).find(p => p.type === 'file')
    ?? null;
}

// Miniatura de um arquivo compartilhado (imagem com preview; senão ícone).
function ShareThumb({ msg }: { msg: TalkMessage }) {
  const auth = getTalkAuth();
  const file = fileParamOf(msg);
  const isImage = !!file?.mimetype?.startsWith('image/');
  const [src, setSrc] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auth || !isImage || !file?.id) return;
    let active = true;
    const params = new URLSearchParams({ fileId: file.id });
    if (file.path) params.set('path', file.path);
    if (msg.actorId) params.set('actorId', msg.actorId);
    fetch(`/api/talk/file-preview?${params}`, {
      headers: { 'x-nextcloud-url': auth.url, 'x-nextcloud-user': auth.user, 'x-nextcloud-token': auth.token },
    })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => { if (!active) return; const u = URL.createObjectURL(blob); urlRef.current = u; setSrc(u); })
      .catch(() => {});
    return () => { active = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [file?.id, isImage]);

  const handleClick = () => {
    if (!file) return;
    // Imagem: abre no Nextcloud (visualização); outros: baixa direto.
    if (isImage && auth && file.id) window.open(`${auth.url}/index.php/f/${file.id}`, '_blank', 'noopener');
    else downloadTalkFile(file, msg.actorId);
  };

  return (
    <button onClick={handleClick} title={file?.name}
            className="group/sh flex flex-col gap-1 text-left">
      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center border border-slate-200 group-hover/sh:border-blue-300 transition-colors">
        {src
          ? <img src={src} alt={file?.name} className="w-full h-full object-cover" />
          : <FileText size={22} className="text-slate-400" />}
        {!isImage && (
          <span className="absolute bottom-1 right-1 text-slate-400 group-hover/sh:text-blue-500">
            <Download size={12} />
          </span>
        )}
      </div>
      <span className="text-[10px] text-slate-500 truncate">{file?.name}</span>
    </button>
  );
}

function MediaPanel({ token, messages, onClose }: {
  token: string;
  messages: TalkMessage[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'files' | 'links'>('files');

  const { data: shares = {}, isLoading } = useQuery({
    queryKey: ['talk-shares', token],
    queryFn: () => fetchRoomShares(token),
    staleTime: 30_000,
  });

  // Combina todos os tipos de arquivo em uma única lista (mais recente primeiro).
  // Fonte 1: overview do servidor (todo o histórico). Fonte 2: mensagens já
  // carregadas — garante que arquivos visíveis no chat apareçam mesmo se o
  // overview não os retornar (ex.: versão/permissão do Talk).
  const files = useMemo(() => {
    const fromShares = [
      ...(shares.media ?? []), ...(shares.file ?? []),
      ...(shares.voice ?? []), ...(shares.audio ?? []), ...(shares.other ?? []),
    ];
    const fromMessages = messages.filter(m => m.messageType === 'comment' && !!fileParamOf(m));
    const all = [...fromShares, ...fromMessages].filter(m => !!fileParamOf(m));
    const byId = new Map(all.map(m => [m.id, m]));
    return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [shares, messages]);

  // Links extraídos das mensagens carregadas (texto, ignorando anexos).
  const links = useMemo(() => {
    const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const seen = new Set<string>();
    const out: Array<{ url: string; actor: string; timestamp: number }> = [];
    for (const m of messages) {
      if (m.messageType !== 'comment' || fileParamOf(m)) continue;
      const text = resolveMessageText(m);
      let mt: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((mt = re.exec(text)) !== null) {
        const url = mt[0].replace(/[.,;!?)]+$/, '');
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, actor: m.actorDisplayName.split(' ')[0], timestamp: m.timestamp });
      }
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }, [messages]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-80 max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-800">Compartilhados</span>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-slate-100 flex-shrink-0">
          <button onClick={() => setTab('files')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                    tab === 'files' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'
                  }`}>
            <Files size={13} /> Arquivos {files.length > 0 && `(${files.length})`}
          </button>
          <button onClick={() => setTab('links')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                    tab === 'links' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'
                  }`}>
            <Link2 size={13} /> Links {links.length > 0 && `(${links.length})`}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
          {tab === 'files' && (
            <>
              {isLoading && <p className="text-xs text-slate-400 text-center py-6">Carregando…</p>}
              {!isLoading && files.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">Nenhum arquivo compartilhado</p>
              )}
              {files.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {files.map(m => <ShareThumb key={m.id} msg={m} />)}
                </div>
              )}
            </>
          )}

          {tab === 'links' && (
            <>
              {links.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">Nenhum link nas mensagens carregadas</p>
              )}
              <div className="space-y-1">
                {links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                     className="block px-2.5 py-2 rounded-lg hover:bg-blue-50 transition-colors border border-slate-100">
                    <span className="text-[11px] text-blue-600 truncate block break-all">{l.url}</span>
                    <span className="text-[9px] text-slate-400">
                      {l.actor} · {format(new Date(l.timestamp * 1000), "d MMM yyyy", { locale: ptBR })}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Painel "Informações da mensagem" (recibos de leitura) ────────────────────

function MessageInfoPanel({ msg, participants, myId, readStatusAvailable, onClose }: {
  msg: TalkMessage;
  participants: TalkParticipant[];
  myId: string;
  readStatusAvailable: boolean;
  onClose: () => void;
}) {
  const others = participants.filter(p => p.actorId !== myId && p.actorType === 'users');
  const read = others.filter(p => (p.lastReadMessage ?? 0) >= msg.id);
  const unread = others.filter(p => (p.lastReadMessage ?? 0) < msg.id);
  const preview = resolveMessageText(msg);

  const Row = ({ p }: { p: TalkParticipant }) => (
    <div className="flex items-center gap-2 py-1">
      <TalkAvatar actorId={p.actorId} displayName={p.displayName} size={26} />
      <span className="text-xs text-slate-700 truncate">{p.displayName}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-80 max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-800">Informações da mensagem</span>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>

        {/* Prévia da mensagem */}
        <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="bg-blue-600 text-white text-xs rounded-2xl rounded-br-sm px-3 py-1.5 break-words [overflow-wrap:anywhere] max-h-24 overflow-y-auto scrollbar-thin">
            {preview}
          </div>
          <p className="text-[10px] text-slate-400 mt-1 text-right">
            Enviada {format(new Date(msg.timestamp * 1000), "d 'de' MMM 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
          {!readStatusAvailable ? (
            <div className="text-center py-4 px-2">
              <Check size={22} className="mx-auto text-slate-300 mb-2" />
              <p className="text-xs text-slate-500 font-medium">Confirmação de leitura indisponível</p>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Os participantes desta conversa estão com o <b>status de leitura privado</b> no Nextcloud.
                Para ver quem leu, cada pessoa precisa ativar “Compartilhar status de leitura” nas
                configurações de privacidade do Nextcloud.
              </p>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckCheck size={13} className="text-blue-500" />
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Lido por ({read.length})</span>
                </div>
                {read.length > 0
                  ? read.map(p => <Row key={p.actorId} p={p} />)
                  : <p className="text-[11px] text-slate-400">Ninguém leu ainda</p>}
              </div>
              {unread.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Check size={13} className="text-slate-400" />
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Ainda não leu ({unread.length})</span>
                  </div>
                  {unread.map(p => <Row key={p.actorId} p={p} />)}
                </div>
              )}
            </>
          )}
        </div>

        {readStatusAvailable && (
          <p className="px-4 py-2 text-[9px] text-slate-300 border-t border-slate-100 flex-shrink-0">
            O Nextcloud Talk não informa o horário exato de leitura por pessoa.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Dialog: nova conversa ────────────────────────────────────────────────────

function NewConversationDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (room: TalkRoom) => void;
}) {
  const [query, setQuery] = useState('');
  const { data: users = [], isLoading } = useSearchNCUsers(query);
  const createRoom = useCreateRoom();

  const handleSelect = (user: { id: string; label: string }) => {
    createRoom.mutate(
      { roomType: 1, invite: user.id },
      { onSuccess: (room) => { onCreate(room); onClose(); } }
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-end pb-16 pr-4">
      <div className="w-72 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-800">Nova conversa</span>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-slate-100">
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5">
            <Search size={13} className="text-slate-400 flex-shrink-0" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Buscar usuário…"
                   className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400" />
          </div>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {isLoading && <div className="text-center py-4 text-xs text-slate-400">Buscando…</div>}
          {!isLoading && query.length >= 2 && users.length === 0 && (
            <div className="text-center py-4 text-xs text-slate-400">Nenhum usuário encontrado</div>
          )}
          {query.length < 2 && (
            <div className="text-center py-4 text-xs text-slate-400">Digite pelo menos 2 caracteres</div>
          )}
          {users.map(u => (
            <button key={u.id} onClick={() => handleSelect(u)}
                    disabled={createRoom.isPending}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left transition-colors border-b border-slate-50 last:border-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {(u.label || u.id).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{u.label}</p>
                <p className="text-[10px] text-slate-400 truncate">{u.id}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Menu do meu status (presença + mensagem personalizada) ───────────────────

const STATUS_TYPES: Array<{ type: UserStatusType; label: string; color: string }> = [
  { type: 'online',    label: 'Online',       color: 'bg-green-500' },
  { type: 'away',      label: 'Ausente',      color: 'bg-amber-400' },
  { type: 'dnd',       label: 'Não perturbe', color: 'bg-red-500' },
  { type: 'invisible', label: 'Invisível',    color: 'bg-slate-300' },
];

function MyStatusMenu({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const { data: my } = useQuery({ queryKey: ['talk-my-status'], queryFn: fetchMyStatus, staleTime: 30_000 });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMessage(my?.message ?? ''); }, [my?.message]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['talk-my-status'] });
    qc.invalidateQueries({ queryKey: ['talk-user-statuses'] });
  };
  const pickType = async (type: UserStatusType) => {
    setBusy(true);
    try { await setMyStatusType(type); refresh(); onClose(); } finally { setBusy(false); }
  };
  const saveMsg = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try { await setMyStatusMessage(message.trim()); refresh(); onClose(); } finally { setBusy(false); }
  };
  const clearMsg = async () => {
    setBusy(true);
    try { await clearMyStatusMessage(); setMessage(''); refresh(); onClose(); } finally { setBusy(false); }
  };

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl z-[70] overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Disponibilidade</p>
        <div className="grid grid-cols-2 gap-1">
          {STATUS_TYPES.map(s => (
            <button key={s.type} onClick={() => pickType(s.type)} disabled={busy}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                      my?.status === s.type ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50 text-slate-600'
                    }`}>
              <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-3 py-2">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Status personalizado</p>
        <input value={message} onChange={e => setMessage(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') saveMsg(); }}
               placeholder="Em reunião, Focado 🎧…"
               className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-slate-400" />
        <div className="flex gap-1.5 mt-1.5">
          <button onClick={saveMsg} disabled={busy}
                  className="flex-1 py-1.5 text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            Salvar
          </button>
          {my?.message && (
            <button onClick={clearMsg} disabled={busy}
                    className="px-2.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">
              Limpar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Painel de conversas ──────────────────────────────────────────────────────

function ConversationsPanel({ onSelect, openTokens, onClose, newAlerts, myId }: {
  onSelect: (room: TalkRoom) => void;
  openTokens: string[];
  onClose: () => void;
  newAlerts: Set<string>;
  myId: string;
}) {
  const { data: rooms = [], isLoading, isError } = useTalkRooms();
  const { data: statuses } = useUserStatuses();
  const { data: me } = useTalkCurrentUser();
  const [showNewConv, setShowNewConv] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const myStatus = statuses?.get(myId)?.status;

  const sorted = rooms.filter(r => r.type !== 6).sort((a, b) => b.lastActivity - a.lastActivity);

  return (
    <>
      {showNewConv && (
        <NewConversationDialog
          onClose={() => setShowNewConv(false)}
          onCreate={room => { onSelect(room); }}
        />
      )}
      <div className="flex flex-col bg-white border border-slate-200 rounded-t-xl shadow-2xl overflow-hidden"
           style={{ width: 300, height: 420 }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0 relative">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">Mensagens</span>
            <span title={isError ? 'Nextcloud inacessível' : 'Conectado'}>
              {isError
                ? <WifiOff size={12} className="text-red-400" />
                : <Wifi size={12} className="text-green-400" />
              }
            </span>
          </div>
          <div className="flex items-center gap-1">
            {myId && (
              <button onClick={() => setShowStatusMenu(v => !v)} title="Meu status"
                      className="mr-0.5">
                <TalkAvatar actorId={myId} displayName={me?.displayName ?? myId} size={24} status={myStatus} />
              </button>
            )}
            {showStatusMenu && <MyStatusMenu onClose={() => setShowStatusMenu(false)} />}
            <button onClick={() => setShowNewConv(true)}
                    className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600 transition-colors" title="Nova conversa">
              <Plus size={14} />
            </button>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading && (
            <div className="flex items-center justify-center h-20 text-slate-400 text-xs">Carregando conversas…</div>
          )}
          {isError && !isLoading && (
            <div className="flex flex-col items-center justify-center h-20 gap-1">
              <WifiOff size={20} className="text-red-300" />
              <span className="text-xs text-slate-400">Nextcloud inacessível</span>
            </div>
          )}
          {sorted.map(room => {
            const isOpen = openTokens.includes(room.token);
            const hasAlert = newAlerts.has(room.token);
            const lastText = room.lastMessage ? resolveMessageText(room.lastMessage) : '';
            const lastName = room.lastMessage?.actorDisplayName.split(' ')[0];
            return (
              <button key={room.token} onClick={() => onSelect(room)}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 text-left transition-colors ${
                        isOpen ? 'bg-blue-50' : ''
                      }`}>
                <div className="relative">
                  <RoomAvatar room={room} size={36} status={room.type === 1 ? statuses?.get(room.name)?.status : undefined} />
                  {hasAlert && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-blue-500 rounded-full border border-white animate-pulse" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs truncate ${room.unreadMessages > 0 || hasAlert ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                      {room.displayName}
                    </span>
                    {room.lastActivity && (
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {formatDistanceToNow(new Date(room.lastActivity * 1000), { locale: ptBR })}
                      </span>
                    )}
                  </div>
                  {lastText && (
                    <p className={`text-[11px] truncate mt-0.5 ${room.unreadMessages > 0 || hasAlert ? 'text-slate-600' : 'text-slate-400'}`}>
                      {lastName ? `${lastName}: ` : ''}{lastText}
                    </p>
                  )}
                </div>
                {(room.unreadMessages > 0 || hasAlert) && (
                  <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {room.unreadMessages > 9 ? '9+' : room.unreadMessages || '•'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Widget principal ─────────────────────────────────────────────────────────

export function TalkChat({ onIssueClick, openRoomToken, onRoomOpened, onOpenSettings }: {
  onIssueClick?: (id: number) => void;
  openRoomToken?: string | null;
  onRoomOpened?: () => void;
  onOpenSettings?: () => void;
}) {
  const auth = getTalkAuth();
  const [authExpired, setAuthExpired] = useState(false);

  // Token (senha de app) revogado/expirado → o servidor responde 401 e o interceptor
  // dispara este evento. Mostramos um aviso para reconectar nas Configurações.
  useEffect(() => {
    const onExpired = () => setAuthExpired(true);
    window.addEventListener(TALK_AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(TALK_AUTH_EXPIRED_EVENT, onExpired);
  }, []);
  const { data: rooms = [] } = useTalkRooms();
  const { data: me } = useTalkCurrentUser();
  const myId = me?.id ?? auth?.user ?? '';
  const [panelOpen, setPanelOpen] = useState(false);
  const [openChats, setOpenChats] = useState<TalkRoom[]>([]);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());

  // Registra uploader na bridge para IssueModal compartilhar anexos no Talk
  useEffect(() => {
    const activeToken = openChats.find(r => !minimized.has(r.token))?.token ?? null;
    if (activeToken) {
      talkBridge.register(file => uploadFileToTalk(activeToken, file).then(() => {}));
    } else {
      talkBridge.register(null);
    }
    return () => talkBridge.register(null);
  }, [openChats, minimized]);

  // Abre sala a partir de notificação push (openRoomToken vem do App.tsx)
  useEffect(() => {
    if (!openRoomToken || rooms.length === 0) return;
    const room = rooms.find(r => r.token === openRoomToken);
    if (!room) return;
    setOpenChats(prev => prev.find(r => r.token === room.token) ? prev : [...prev, room].slice(-2));
    setMinimized(prev => { const s = new Set(prev); s.delete(room.token); return s; });
    setPanelOpen(false);
    onRoomOpened?.();
  }, [openRoomToken, rooms]);

  // Alertas de novas mensagens (aba sem foco)
  const prevUnread = useRef<Map<string, number>>(new Map());
  const [newAlerts, setNewAlerts] = useState<Set<string>>(new Set());

  useEffect(() => {
    rooms.forEach(room => {
      const prev = prevUnread.current.get(room.token) ?? -1;
      const curr = room.unreadMessages;
      if (prev >= 0 && curr > prev && !document.hasFocus() && !talkMute.isMuted(room.token)) {
        setNewAlerts(s => new Set([...s, room.token]));
      }
      prevUnread.current.set(room.token, curr);
    });
  }, [rooms]);

  // Título do documento quando há alertas
  useEffect(() => {
    if (newAlerts.size > 0) {
      document.title = `(${newAlerts.size}) Nova mensagem — Bluemine`;
    } else {
      document.title = 'Bluemine';
    }
    return () => { document.title = 'Bluemine'; };
  }, [newAlerts.size]);

  if (!auth) return null;

  const totalUnread = rooms.reduce((sum, r) => sum + r.unreadMessages, 0);
  const totalAlerts = newAlerts.size;

  const openChat = (room: TalkRoom) => {
    setOpenChats(prev => {
      if (prev.find(r => r.token === room.token)) return prev;
      return [...prev, room].slice(-2);
    });
    setMinimized(prev => { const s = new Set(prev); s.delete(room.token); return s; });
    setNewAlerts(prev => { const s = new Set(prev); s.delete(room.token); return s; });
    setPanelOpen(false);
  };

  const closeChat = (token: string) => {
    setOpenChats(prev => prev.filter(r => r.token !== token));
    setMinimized(prev => { const s = new Set(prev); s.delete(token); return s; });
    setNewAlerts(prev => { const s = new Set(prev); s.delete(token); return s; });
  };

  const toggleMinimize = (token: string) => {
    setMinimized(prev => {
      const s = new Set(prev);
      s.has(token) ? s.delete(token) : s.add(token);
      return s;
    });
    setNewAlerts(prev => { const s = new Set(prev); s.delete(token); return s; });
  };

  return (
    <div className="fixed bottom-0 right-4 z-50 flex items-end gap-2">
      {[...openChats].reverse().map(room => {
        const hasNewMsg = newAlerts.has(room.token);
        return (
          <div key={room.token} className="flex flex-col items-stretch">
            {minimized.has(room.token) ? (
              <div
                className={`flex items-center gap-2 px-3 py-2 bg-white border border-b-0 border-slate-200 rounded-t-xl shadow-lg cursor-pointer hover:bg-slate-50 transition-colors ${
                  hasNewMsg ? 'ring-2 ring-blue-400' : ''
                }`}
                onClick={() => toggleMinimize(room.token)}
              >
                <div className="relative">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                    {room.displayName.charAt(0).toUpperCase()}
                  </div>
                  {hasNewMsg && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full border border-white animate-pulse" />
                  )}
                </div>
                <span className="text-xs font-medium text-slate-700 truncate max-w-[140px]">
                  {room.displayName}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); closeChat(room.token); }}
                  className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <ChatWindow
                room={room}
                onClose={() => closeChat(room.token)}
                onMinimize={() => toggleMinimize(room.token)}
                myId={myId}
                onIssueClick={onIssueClick}
                hasNewMsg={hasNewMsg}
                onOpenRoom={openChat}
              />
            )}
          </div>
        );
      })}

      <div className="flex flex-col items-stretch">
        {authExpired && (
          <div className="mb-1 w-64 bg-amber-50 border border-amber-300 rounded-xl shadow-lg px-3 py-2.5 text-xs text-amber-800">
            <p className="font-semibold mb-1">Conexão com o Talk expirou</p>
            <p className="mb-2 text-amber-700">O token (senha de app) parece ter sido revogado. Reconecte para voltar a receber mensagens.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setAuthExpired(false); onOpenSettings?.(); }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
              >
                Reconectar
              </button>
              <button
                onClick={() => setAuthExpired(false)}
                className="px-2 py-1 text-amber-600 hover:text-amber-800 transition-colors"
              >
                Dispensar
              </button>
            </div>
          </div>
        )}
        {panelOpen ? (
          <ConversationsPanel
            onSelect={openChat}
            openTokens={openChats.map(r => r.token)}
            onClose={() => setPanelOpen(false)}
            newAlerts={newAlerts}
            myId={myId}
          />
        ) : (
          <button
            onClick={() => setPanelOpen(v => !v)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-b-0 border-slate-200 rounded-t-xl shadow-lg hover:bg-slate-50 transition-colors"
          >
            <MessageSquare size={15} className="text-blue-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-slate-700">Mensagens</span>
            {(totalUnread > 0 || totalAlerts > 0) && (
              <span className={`min-w-[18px] h-[18px] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 ${
                totalAlerts > 0 ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
              }`}>
                {totalUnread > 9 ? '9+' : totalUnread || '•'}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
