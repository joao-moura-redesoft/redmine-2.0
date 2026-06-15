import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare, X, Minus, Send, Paperclip, Reply, Pencil, Trash2,
  Plus, Search, Wifi, WifiOff, ChevronUp, SmilePlus, Bell, BellOff,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useTalkRooms, useTalkMessages, useSendMessage, useTalkCurrentUser,
  useEditMessage, useDeleteMessage, useReaction, useCreateRoom,
  useSearchNCUsers, useTypingSender, useTalkSSE,
} from '../hooks/useTalk';
import {
  getTalkAuth, resolveMessageText, fetchParticipants, markMessagesRead,
  uploadFileToTalk, fetchMessages,
} from '../api/talk';
import { getStoredAuth, redmineApi } from '../api/redmine';
import { talkBridge } from '../utils/talkBridge';
import { talkMute } from '../utils/talkMute';
import type { TalkRoom, TalkMessage, TalkParticipant } from '../api/talk';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Som de notificação (Web Audio API, sem arquivo externo) ──────────────────
function playNotificationBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const play = (freq: number, start: number, dur: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    };
    const go = () => {
      play(880, ctx.currentTime,        0.18);  // nota 1 — sol5
      play(1100, ctx.currentTime + 0.12, 0.22); // nota 2 — dó6 (ascendente)
      setTimeout(() => ctx.close(), 600);
    };
    ctx.state === 'suspended' ? ctx.resume().then(go).catch(() => {}) : go();
  } catch {}
}

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
        headers: { 'x-redmine-url': auth!.url, 'x-redmine-key': auth!.apiKey },
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

function TalkAvatar({ actorId, displayName, size = 36 }: {
  actorId: string; displayName: string; size?: number;
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
  return (
    <div className="rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-blue-400 to-blue-600"
         style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt={displayName} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-white font-bold"
               style={{ fontSize: Math.round(size * 0.38) }}>
            {initials}
          </div>
      }
    </div>
  );
}

// ─── Avatar de sala (grupos usam avatar dedicado do Talk) ─────────────────────

function RoomAvatar({ room, size = 36 }: { room: TalkRoom; size?: number }) {
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
    return <TalkAvatar actorId={room.name} displayName={room.displayName} size={size} />;
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

// ─── Mensagem citada (reply) ──────────────────────────────────────────────────

function QuotedMessage({ parent, isMe }: {
  parent: NonNullable<TalkMessage['parent']>;
  isMe: boolean;
}) {
  const text = parent.message === '{file}'
    ? '📎 Arquivo'
    : parent.message.replace(/\{([\w-]+)\}/g, (_, k) => {
        return parent.messageParameters?.[k]?.name ? `@${parent.messageParameters[k].name}` : k;
      });
  return (
    <div className={`text-[10px] rounded-lg px-2 py-1 mb-1 border-l-2 max-w-full truncate ${
      isMe
        ? 'bg-white/10 border-white/40 text-white/70'
        : 'bg-slate-200 border-slate-400 text-slate-500'
    }`}>
      <span className="font-semibold">{parent.actorDisplayName.split(' ')[0]}: </span>
      <span>{text}</span>
    </div>
  );
}

// ─── Seletor de emojis ────────────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🔥'];

function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  return (
    <div className="absolute z-50 bottom-full mb-1 right-0 bg-white border border-slate-200 rounded-xl shadow-xl p-2 flex gap-1.5"
         onMouseLeave={onClose}>
      {QUICK_EMOJIS.map(e => (
        <button key={e} onClick={() => { onPick(e); onClose(); }}
                className="text-lg hover:scale-125 transition-transform leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100">
          {e}
        </button>
      ))}
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

function SeenBy({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5 mt-0.5 justify-end" title={`Visto por: ${names.join(', ')}`}>
      {names.slice(0, 4).map((n, i) => (
        <div key={i} className="w-3 h-3 rounded-full bg-slate-300 flex items-center justify-center text-[7px] text-slate-600 font-bold leading-none flex-shrink-0">
          {n[0]?.toUpperCase()}
        </div>
      ))}
      {names.length > 4 && <span className="text-[9px] text-slate-400">+{names.length - 4}</span>}
    </div>
  );
}

function Bubble({ msg, isMe, onIssueClick, onReply, onEdit, onDelete, onReact, myId, seenBy, showSender, isDM }: {
  msg: TalkMessage;
  isMe: boolean;
  myId: string;
  onIssueClick?: (id: number) => void;
  onReply: (msg: TalkMessage) => void;
  onEdit: (msg: TalkMessage) => void;
  onDelete: (msg: TalkMessage) => void;
  onReact: (msgId: number, emoji: string, remove: boolean) => void;
  seenBy: string[];
  showSender: boolean;
  isDM: boolean;
}) {
  const file = msg.message === '{file}'
    ? msg.messageParameters?.file
    : Object.values(msg.messageParameters ?? {}).find(p => p.type === 'file') ?? null;
  const isImage = !!file && !!file.mimetype?.startsWith('image/');
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
  const reactions = msg.reactions ?? {};
  const reactionsSelf = msg.reactionsSelf ?? [];

  return (
    <div className={`relative flex ${showSender ? 'mb-2' : 'mb-0.5'} gap-1.5 group ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end ${
           showMenu || showEmoji ? 'z-30' : ''
         }`}
         onMouseLeave={() => { setShowMenu(false); setShowEmoji(false); }}>
      {!isMe && !isDM && (
        showSender
          ? <TalkAvatar actorId={msg.actorId} displayName={msg.actorDisplayName} size={24} />
          : <div style={{ width: 24, flexShrink: 0 }} />
      )}
      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[80%] min-w-0 relative`}>
        {!isMe && showSender && (
          <span className="text-[10px] text-slate-400 mb-0.5 px-1">
            {msg.actorDisplayName.split(' ')[0]}
          </span>
        )}
        {/* Barra de ações (hover) */}
        <div className={`absolute ${isMe ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1'} top-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}>
          <div className="relative">
            <button onClick={() => setShowEmoji(v => !v)}
                    className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 shadow-sm"
                    title="Reagir">
              <SmilePlus size={11} />
            </button>
            {showEmoji && (
              <EmojiPicker
                onPick={e => onReact(msg.id, e, reactionsSelf.includes(e))}
                onClose={() => setShowEmoji(false)}
              />
            )}
          </div>
          {msg.isReplyable && (
            <button onClick={() => onReply(msg)}
                    className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 shadow-sm"
                    title="Responder">
              <Reply size={11} />
            </button>
          )}
          {isMe && (
            <>
              <button onClick={() => { setShowMenu(v => !v); }}
                      className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 shadow-sm"
                      title="Editar">
                <Pencil size={11} />
              </button>
              {showMenu && (
                <div className="absolute top-full mt-1 right-0 z-20 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden min-w-[120px]">
                  <button onClick={() => { onEdit(msg); setShowMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-xs text-slate-700">
                    <Pencil size={11} /> Editar
                  </button>
                  <button onClick={() => { onDelete(msg); setShowMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-xs text-red-600">
                    <Trash2 size={11} /> Excluir
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {msg.parent && <QuotedMessage parent={msg.parent} isMe={isMe} />}
        <div className={`rounded-2xl text-xs leading-relaxed break-words overflow-hidden ${
          isImage ? 'p-1' : 'px-3 py-1.5'
        } ${
          isMe
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'talk-bubble-in bg-slate-100 text-slate-800 rounded-bl-sm'
        }`}>
          {file ? (
            <>
              {isImage
                ? <TalkImage fileId={file.id!} path={file.path} name={file.name ?? 'imagem'} actorId={msg.actorId} />
                : <span className="flex items-center gap-1.5">📎 {file.name}</span>}
              {caption && (
                <div className={isImage ? 'px-2 pb-1 pt-1.5' : 'mt-1'}>
                  {renderBubbleContent(caption, isMe, onIssueClick)}
                </div>
              )}
            </>
          ) : (
            renderBubbleContent(resolveMessageText(msg), isMe, onIssueClick)
          )}
        </div>
        {/* OG preview — só para mensagens de texto com URL externa */}
        {!file && (() => {
          const text = resolveMessageText(msg);
          const url = findPreviewUrl(text);
          return url ? <OGPreview url={url} /> : null;
        })()}
        <ReactionBar reactions={reactions} reactionsSelf={reactionsSelf}
                     onToggle={(e, remove) => onReact(msg.id, e, remove)} />
        <span className="text-[9px] text-slate-300 mt-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatDistanceToNow(new Date(msg.timestamp * 1000), { addSuffix: true, locale: ptBR })}
        </span>
        {isMe && <SeenBy names={seenBy} />}
      </div>
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
  const [input, setInput] = useState(editValue ?? '');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [issueQuery, setIssueQuery] = useState<string | null>(null);
  const [issueStart, setIssueStart] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { onType, stopTyping } = useTypingSender(token);

  // Revoga a URL de preview ao trocar/desmontar para evitar vazamento de memória
  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview); }, [pendingPreview]);

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
      setInput('');
    }
  }, [editValue]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stagePendingFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-slate-100">
        <input type="file" ref={fileRef} onChange={handleFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
                title="Enviar arquivo"
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40">
          <Paperclip size={14} />
        </button>
        <input ref={inputRef} value={input} onChange={handleChange}
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
               className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder-slate-400" />
        <button onClick={submit} disabled={(!input.trim() && !pendingFile) || isPending || uploading}
                className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full transition-colors flex-shrink-0">
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Janela de chat ───────────────────────────────────────────────────────────

function ChatWindow({ room, onClose, onMinimize, myId, onIssueClick, hasNewMsg }: {
  room: TalkRoom;
  onClose: () => void;
  onMinimize: () => void;
  myId: string;
  onIssueClick?: (id: number) => void;
  hasNewMsg: boolean;
}) {
  const qc = useQueryClient();
  const { data: messages = [], isLoading } = useTalkMessages(room.token);
  const send = useSendMessage(room.token);
  const editMsg = useEditMessage(room.token);
  const deleteMsg = useDeleteMessage(room.token);
  const react = useReaction(room.token);

  // Participantes — para "visto por" e @todos
  const { data: participants = [] } = useQuery({
    queryKey: ['talk-participants', room.token],
    queryFn: () => fetchParticipants(room.token),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !!getTalkAuth(),
  });

  // Map messageId → nomes de quem leu até aquela mensagem
  const seenByMap = useMemo(() => {
    const map = new Map<number, string[]>();
    participants
      .filter(p => p.actorId !== myId && p.actorType === 'users' && (p.lastReadMessage ?? 0) > 0)
      .forEach(p => {
        const id = p.lastReadMessage!;
        const name = p.displayName.split(' ')[0];
        map.set(id, [...(map.get(id) ?? []), name]);
      });
    return map;
  }, [participants, myId]);

  // Mute por sala
  const [muted, setMuted] = useState(() => talkMute.isMuted(room.token));

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

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
    const msgs = [...allMessages]
      .reverse()
      // file_shared é um systemMessage legítimo de arquivo — nunca excluir
      .filter(m => m.messageType === 'comment' && (!m.systemMessage || m.message === '{file}' || !!Object.values(m.messageParameters ?? {}).find(p => p.type === 'file')));
    if (!searchQuery.trim()) return msgs;
    const q = searchQuery.toLowerCase();
    return msgs.filter(m =>
      resolveMessageText(m).toLowerCase().includes(q) ||
      m.actorDisplayName.toLowerCase().includes(q)
    );
  }, [allMessages, searchQuery]);

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

  // Marca como lido
  useEffect(() => {
    if (messages.length === 0) return;
    const lastId = messages[0].id;
    markMessagesRead(room.token, lastId)
      .then(() => qc.invalidateQueries({ queryKey: ['talk-rooms'] }))
      .catch(() => {});
  }, [messages.length, room.token]);

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
      send.mutate({ message: text, replyTo: replyId });
    }
    setReplyTo(null);
  };

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-t-xl shadow-2xl overflow-hidden relative"
         style={{ width: size.w, height: size.h }}
         onDragEnter={handleDragEnter}
         onDragOver={e => e.preventDefault()}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}>

      {/* Overlay drag-and-drop */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-blue-50/90 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none">
          <Paperclip size={28} className="text-blue-400 mb-2" />
          <p className="text-sm font-semibold text-blue-600">Soltar para enviar</p>
        </div>
      )}
      {dropUploading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 rounded-xl">
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
        <RoomAvatar room={room} size={28} />
        <span className="flex-1 text-xs font-semibold text-slate-800 truncate">{room.displayName}</span>
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
        <button onClick={() => setSearchOpen(v => !v)}
                className={`p-1 rounded text-slate-400 hover:text-slate-600 transition-colors ${searchOpen ? 'bg-slate-100' : 'hover:bg-slate-100'}`}>
          <Search size={12} />
        </button>
        <button onClick={() => setMuted(talkMute.toggle(room.token))}
                title={muted ? 'Ativar notificações' : 'Silenciar sala'}
                className={`p-1 rounded transition-colors ${muted ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
          {muted ? <BellOff size={12} /> : <Bell size={12} />}
        </button>
        <button onClick={onMinimize} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <Minus size={12} />
        </button>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Busca */}
      {searchOpen && (
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Search size={12} className="text-slate-400 flex-shrink-0" />
          <input
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }}}
            placeholder="Buscar mensagens…"
            className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
              <X size={11} />
            </button>
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
          {hasMore && !searchQuery && (
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
          {!isLoading && visibleMessages.length === 0 && !searchQuery && (
            <div className="flex items-center justify-center h-20 text-slate-400 text-xs">Nenhuma mensagem ainda</div>
          )}
          {!isLoading && visibleMessages.length === 0 && searchQuery && (
            <div className="flex items-center justify-center h-20 text-slate-400 text-xs">Nenhuma mensagem encontrada</div>
          )}
          {visibleMessages.map((m, idx) => {
            const isMe = m.actorId === myId;
            const prev = visibleMessages[idx - 1];
            const grouped = !!prev && prev.actorId === m.actorId && (m.timestamp - prev.timestamp) < 5 * 60;
            const isDM = room.type === 1;
            const showSender = !isMe && !grouped && !isDM;
            return (
              <Bubble key={m.id} msg={m} isMe={isMe} myId={myId}
                      showSender={showSender} isDM={isDM}
                      onIssueClick={onIssueClick}
                      onReply={msg => { setReplyTo(msg); setEditTarget(null); }}
                      onEdit={msg => { setEditTarget(msg); setReplyTo(null); }}
                      onDelete={msg => { if (confirm('Excluir esta mensagem?')) deleteMsg.mutate(msg.id); }}
                      onReact={(msgId, emoji, remove) => react.mutate({ messageId: msgId, reaction: emoji, remove })}
                      seenBy={seenByMap.get(m.id) ?? []}
              />
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

// ─── Painel de conversas ──────────────────────────────────────────────────────

function ConversationsPanel({ onSelect, openTokens, onClose, newAlerts }: {
  onSelect: (room: TalkRoom) => void;
  openTokens: string[];
  onClose: () => void;
  newAlerts: Set<string>;
}) {
  const { data: rooms = [], isLoading, isError } = useTalkRooms();
  const [showNewConv, setShowNewConv] = useState(false);

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
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
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
                  <RoomAvatar room={room} size={36} />
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

export function TalkChat({ onIssueClick, openRoomToken, onRoomOpened }: {
  onIssueClick?: (id: number) => void;
  openRoomToken?: string | null;
  onRoomOpened?: () => void;
}) {
  const auth = getTalkAuth();
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
  const prevAlertSize = useRef(0);

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

  // Som quando chegam novos alertas
  useEffect(() => {
    if (newAlerts.size > prevAlertSize.current) playNotificationBeep();
    prevAlertSize.current = newAlerts.size;
  }, [newAlerts.size]);

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
              />
            )}
          </div>
        );
      })}

      <div className="flex flex-col items-stretch">
        {panelOpen && (
          <ConversationsPanel
            onSelect={openChat}
            openTokens={openChats.map(r => r.token)}
            onClose={() => setPanelOpen(false)}
            newAlerts={newAlerts}
          />
        )}
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
      </div>
    </div>
  );
}
