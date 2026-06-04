import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Minus, Send, Paperclip } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTalkRooms, useTalkMessages, useSendMessage, useTalkCurrentUser } from '../hooks/useTalk';
import { getTalkAuth, resolveMessageText, fetchParticipants, markMessagesRead, uploadFileToTalk } from '../api/talk';
import { getStoredAuth } from '../api/redmine';
import { useQueryClient } from '@tanstack/react-query';
import type { TalkRoom, TalkMessage, TalkParticipant } from '../api/talk';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Detecção de links do Redmine ─────────────────────────────────────────────

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type MessagePart = { type: 'text'; content: string } | { type: 'issue'; id: number };

function parseMessageParts(text: string): MessagePart[] {
  const auth = getStoredAuth();
  if (!auth?.url) return [{ type: 'text', content: text }];
  let host: string;
  try { host = new URL(auth.url).host; } catch { return [{ type: 'text', content: text }]; }
  const re = new RegExp(`https?://${escapeRegex(host)}/issues/(\\d+)`, 'g');
  const parts: MessagePart[] = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) });
    parts.push({ type: 'issue', id: parseInt(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });
  return parts;
}

function RedmineIssueChip({ id, isMe, onIssueClick }: {
  id: number;
  isMe: boolean;
  onIssueClick?: (id: number) => void;
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

// ─── Imagem inline (busca via proxy autenticado) ──────────────────────────────

function TalkImage({ fileId, path, name, actorId }: { fileId: string; path?: string; name: string; actorId: string }) {
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
      <img
        src={src}
        alt={name}
        className="rounded-xl max-w-full cursor-zoom-in block"
        style={{ maxHeight: 180 }}
        onClick={() => setLightbox(true)}
      />
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-w-3xl max-h-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(false)}
              className="absolute -top-3 -right-3 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-lg text-slate-700 hover:text-slate-900 z-10"
            >
              <X size={14} />
            </button>
            <img
              src={src}
              alt={name}
              className="rounded-xl max-w-full max-h-[85vh] object-contain shadow-2xl"
            />
            <p className="text-center text-xs text-slate-400 mt-2">{name}</p>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Bolha de mensagem ────────────────────────────────────────────────────────

function renderBubbleContent(text: string, isMe: boolean, onIssueClick?: (id: number) => void) {
  const parts = parseMessageParts(text);
  const nodes: React.ReactNode[] = [];

  parts.forEach((part, pi) => {
    if (part.type === 'issue') {
      nodes.push(
        <RedmineIssueChip key={pi} id={part.id} isMe={isMe} onIssueClick={onIssueClick} />
      );
    } else {
      part.content.split('\n').forEach((line, li, arr) => {
        nodes.push(<span key={`${pi}-${li}`}>{line}</span>);
        if (li < arr.length - 1) nodes.push(<br key={`${pi}-br${li}`} />);
      });
    }
  });

  return <>{nodes}</>;
}

function Bubble({ msg, isMe, onIssueClick }: {
  msg: TalkMessage;
  isMe: boolean;
  onIssueClick?: (id: number) => void;
}) {
  const file = msg.message === '{file}' ? msg.messageParameters?.file : null;
  const isImage = !!file && file.type === 'file' && !!file.mimetype?.startsWith('image/');

  return (
    <div className={`flex flex-col mb-2 ${isMe ? 'items-end' : 'items-start'}`}>
      {!isMe && (
        <span className="text-[10px] text-slate-400 mb-0.5 px-1">
          {msg.actorDisplayName.split(' ')[0]}
        </span>
      )}
      <div className={`max-w-[82%] rounded-2xl text-xs leading-relaxed break-words overflow-hidden ${
        isImage ? 'p-1' : 'px-3 py-1.5'
      } ${
        isMe
          ? 'bg-blue-600 text-white rounded-br-sm'
          : 'bg-slate-100 text-slate-800 rounded-bl-sm'
      }`}>
        {file ? (
          isImage
            ? <TalkImage fileId={file.id!} path={file.path} name={file.name ?? 'imagem'} actorId={msg.actorId} />
            : <span className="flex items-center gap-1.5">📎 {file.name}</span>
        ) : (
          renderBubbleContent(resolveMessageText(msg), isMe, onIssueClick)
        )}
      </div>
      <span className="text-[9px] text-slate-300 mt-0.5 px-1">
        {formatDistanceToNow(new Date(msg.timestamp * 1000), { addSuffix: true, locale: ptBR })}
      </span>
    </div>
  );
}

// ─── Input com autocomplete de @menção ───────────────────────────────────────

function MessageInput({ token, onSend, isPending }: {
  token: string;
  onSend: (msg: string) => void;
  isPending: boolean;
}) {
  const [input, setInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadPct(0);
    setUploadError('');
    try {
      await uploadFileToTalk(token, file, pct => setUploadPct(pct));
      qc.invalidateQueries({ queryKey: ['talk-messages', token] });
    } catch {
      setUploadError('Falha ao enviar arquivo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const { data: participants = [] } = useQuery({
    queryKey: ['talk-participants', token],
    queryFn: () => fetchParticipants(token),
    enabled: mentionQuery !== null,
    staleTime: 60_000,
  });

  const filtered = mentionQuery !== null
    ? participants
        .filter(p => p.actorType === 'users' &&
          p.displayName.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
    : [];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx >= 0) {
      const q = before.slice(atIdx + 1);
      if (!q.includes(' ')) {
        setMentionStart(atIdx);
        setMentionQuery(q);
        return;
      }
    }
    setMentionQuery(null);
  };

  const insertMention = (p: TalkParticipant) => {
    const before = input.slice(0, mentionStart);
    const after = input.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    setInput(`${before}@${p.actorId} ${after}`);
    setMentionQuery(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submit = () => {
    const text = input.trim();
    if (!text || isPending) return;
    onSend(text);
    setInput('');
    setMentionQuery(null);
  };

  return (
    <div className="relative flex-shrink-0">
      {filtered.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-10">
          {filtered.map(p => (
            <button
              key={p.actorId}
              onMouseDown={e => { e.preventDefault(); insertMention(p); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                {p.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-medium text-slate-700 truncate block">{p.displayName}</span>
                <span className="text-[10px] text-slate-400">{p.actorId}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {/* Progresso de upload */}
      {uploading && (
        <div className="px-3 pt-2 pb-1 border-t border-slate-100">
          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-200 rounded-full" style={{ width: `${uploadPct}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">Enviando… {uploadPct}%</p>
        </div>
      )}
      {uploadError && (
        <p className="px-3 pb-1 text-[10px] text-red-500">{uploadError}</p>
      )}

      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-slate-100">
        {/* Input de arquivo oculto */}
        <input type="file" ref={fileRef} onChange={handleFile} className="hidden" />

        {/* Botão de anexo */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Enviar arquivo"
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40"
        >
          <Paperclip size={14} />
        </button>

        <input
          ref={inputRef}
          value={input}
          onChange={handleChange}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') setMentionQuery(null);
          }}
          placeholder="Mensagem... (@nome para mencionar)"
          className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder-slate-400"
        />
        <button
          onClick={submit}
          disabled={!input.trim() || isPending}
          className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full transition-colors flex-shrink-0"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Janela de chat ───────────────────────────────────────────────────────────

function ChatWindow({
  room, onClose, onMinimize, myId, onIssueClick,
}: {
  room: TalkRoom;
  onClose: () => void;
  onMinimize: () => void;
  myId: string;
  onIssueClick?: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { data: messages = [], isLoading } = useTalkMessages(room.token);
  const send = useSendMessage(room.token);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 420 });
  const sizeRef = useRef(size);

  const startResize = useCallback((e: React.MouseEvent, dir: 'top' | 'left' | 'both') => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const { w: sw, h: sh } = sizeRef.current;
    const onMove = (ev: MouseEvent) => {
      const w = dir !== 'top'  ? Math.max(260, sw + (startX - ev.clientX)) : sw;
      const h = dir !== 'left' ? Math.max(300, sh + (startY - ev.clientY)) : sh;
      sizeRef.current = { w, h };
      setSize({ w, h });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const visibleMessages = [...messages]
    .reverse()
    .filter(m => m.messageType === 'comment' && !m.systemMessage);

  // Marca como lido quando a janela está aberta com mensagens
  useEffect(() => {
    if (messages.length === 0) return;
    const lastId = messages[0].id; // API retorna mais recente primeiro (índice 0)
    markMessagesRead(room.token, lastId)
      .then(() => qc.invalidateQueries({ queryKey: ['talk-rooms'] }))
      .catch(() => {});
  }, [messages.length, room.token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-t-xl shadow-2xl overflow-hidden relative"
         style={{ width: size.w, height: size.h }}>

      {/* Alça topo — redimensiona altura */}
      <div
        className="absolute top-0 left-6 right-0 h-1.5 cursor-ns-resize z-20 group"
        onMouseDown={e => startResize(e, 'top')}
      >
        <div className="absolute inset-x-0 top-0 h-px group-hover:bg-blue-400 transition-colors" />
      </div>

      {/* Alça esquerda — redimensiona largura */}
      <div
        className="absolute top-6 left-0 bottom-0 w-1.5 cursor-ew-resize z-20 group"
        onMouseDown={e => startResize(e, 'left')}
      >
        <div className="absolute inset-y-0 left-0 w-px group-hover:bg-blue-400 transition-colors" />
      </div>

      {/* Canto superior esquerdo — redimensiona os dois */}
      <div
        className="absolute top-0 left-0 w-6 h-6 cursor-nwse-resize z-30 flex items-center justify-center"
        onMouseDown={e => startResize(e, 'both')}
        title="Arraste para redimensionar"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" className="text-slate-300 hover:text-blue-400 transition-colors">
          <circle cx="1" cy="1" r="1" fill="currentColor"/>
          <circle cx="4" cy="1" r="1" fill="currentColor"/>
          <circle cx="1" cy="4" r="1" fill="currentColor"/>
          <circle cx="4" cy="4" r="1" fill="currentColor"/>
          <circle cx="7" cy="1" r="1" fill="currentColor"/>
          <circle cx="7" cy="4" r="1" fill="currentColor"/>
          <circle cx="1" cy="7" r="1" fill="currentColor"/>
          <circle cx="4" cy="7" r="1" fill="currentColor"/>
          <circle cx="7" cy="7" r="1" fill="currentColor"/>
        </svg>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-100 flex-shrink-0">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
          {room.displayName.charAt(0).toUpperCase()}
        </div>
        <span className="flex-1 text-xs font-semibold text-slate-800 truncate">
          {room.displayName}
        </span>
        <button onClick={onMinimize} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <Minus size={12} />
        </button>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {isLoading && (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            Carregando...
          </div>
        )}
        {!isLoading && visibleMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            Nenhuma mensagem ainda
          </div>
        )}
        {visibleMessages.map(m => (
          <Bubble key={m.id} msg={m} isMe={m.actorId === myId} onIssueClick={onIssueClick} />
        ))}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        token={room.token}
        onSend={text => send.mutate(text)}
        isPending={send.isPending}
      />
    </div>
  );
}

// ─── Painel de conversas ──────────────────────────────────────────────────────

function ConversationsPanel({
  onSelect, openTokens, onClose,
}: {
  onSelect: (room: TalkRoom) => void;
  openTokens: string[];
  onClose: () => void;
}) {
  const { data: rooms = [], isLoading } = useTalkRooms();

  const sorted = rooms
    .filter(r => r.type !== 6)
    .sort((a, b) => b.lastActivity - a.lastActivity);

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-t-xl shadow-2xl overflow-hidden"
         style={{ width: 300, height: 420 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <span className="text-sm font-semibold text-slate-800">Mensagens</span>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading && (
          <div className="flex items-center justify-center h-20 text-slate-400 text-xs">
            Carregando conversas...
          </div>
        )}
        {sorted.map(room => {
          const isOpen = openTokens.includes(room.token);
          const lastText = room.lastMessage ? resolveMessageText(room.lastMessage) : '';
          const lastName = room.lastMessage?.actorDisplayName.split(' ')[0];
          return (
            <button
              key={room.token}
              onClick={() => onSelect(room)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 text-left transition-colors ${
                isOpen ? 'bg-blue-50' : ''
              }`}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                room.type === 2 || room.type === 3
                  ? 'bg-gradient-to-br from-indigo-400 to-indigo-600'
                  : 'bg-gradient-to-br from-blue-400 to-blue-600'
              }`}>
                {room.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-xs truncate ${room.unreadMessages > 0 ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                    {room.displayName}
                  </span>
                  {room.lastActivity && (
                    <span className="text-[10px] text-slate-400 flex-shrink-0">
                      {formatDistanceToNow(new Date(room.lastActivity * 1000), { locale: ptBR })}
                    </span>
                  )}
                </div>
                {lastText && (
                  <p className={`text-[11px] truncate mt-0.5 ${room.unreadMessages > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                    {lastName ? `${lastName}: ` : ''}{lastText}
                  </p>
                )}
              </div>
              {room.unreadMessages > 0 && (
                <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {room.unreadMessages > 9 ? '9+' : room.unreadMessages}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Widget principal ─────────────────────────────────────────────────────────

export function TalkChat({ onIssueClick }: { onIssueClick?: (id: number) => void }) {
  const auth = getTalkAuth();
  const { data: rooms = [] } = useTalkRooms();
  const { data: me } = useTalkCurrentUser();
  const myId = me?.id ?? auth?.user ?? '';
  const [panelOpen, setPanelOpen] = useState(false);
  const [openChats, setOpenChats] = useState<TalkRoom[]>([]);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());

  if (!auth) return null;

  const totalUnread = rooms.reduce((sum, r) => sum + r.unreadMessages, 0);

  const openChat = (room: TalkRoom) => {
    setOpenChats(prev => {
      if (prev.find(r => r.token === room.token)) return prev;
      return [...prev, room].slice(-2);
    });
    setMinimized(prev => { const s = new Set(prev); s.delete(room.token); return s; });
    setPanelOpen(false);
  };

  const closeChat = (token: string) => {
    setOpenChats(prev => prev.filter(r => r.token !== token));
    setMinimized(prev => { const s = new Set(prev); s.delete(token); return s; });
  };

  const toggleMinimize = (token: string) => {
    setMinimized(prev => {
      const s = new Set(prev);
      s.has(token) ? s.delete(token) : s.add(token);
      return s;
    });
  };

  return (
    <div className="fixed bottom-0 right-4 z-50 flex items-end gap-2">
      {[...openChats].reverse().map(room => (
        <div key={room.token} className="flex flex-col items-stretch">
          {minimized.has(room.token) ? (
            <div
              className="flex items-center gap-2 px-3 py-2 bg-white border border-b-0 border-slate-200 rounded-t-xl shadow-lg cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => toggleMinimize(room.token)}
            >
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                {room.displayName.charAt(0).toUpperCase()}
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
            />
          )}
        </div>
      ))}

      <div className="flex flex-col items-stretch">
        {panelOpen && (
          <ConversationsPanel
            onSelect={openChat}
            openTokens={openChats.map(r => r.token)}
            onClose={() => setPanelOpen(false)}
          />
        )}
        <button
          onClick={() => setPanelOpen(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-b-0 border-slate-200 rounded-t-xl shadow-lg hover:bg-slate-50 transition-colors"
        >
          <MessageSquare size={15} className="text-blue-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-700">Mensagens</span>
          {totalUnread > 0 && (
            <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
