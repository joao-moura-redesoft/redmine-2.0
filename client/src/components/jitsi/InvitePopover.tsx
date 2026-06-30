import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Send, Check, Loader2, Users, User as UserIcon } from 'lucide-react';
import {
  fetchRooms,
  searchNCUsers,
  createRoom,
  sendMessage,
  type TalkRoom,
  type NCUser,
} from '../../api/talk';
import { getJitsiDomain } from '../../utils/jitsiConfig';

interface Props {
  room: string;
  title: string;
  coords: { top: number; left: number };
  onClose: () => void;
}

// Monta o texto do convite com o link direto da sala no Jitsi.
function inviteText(title: string, room: string): string {
  const url = `https://${getJitsiDomain()}/${room}`;
  return `📹 Convite para reunião: ${title}\nEntre por aqui: ${url}`;
}

// Normaliza para comparação acento-insensível e case-insensível.
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Descarta conversas sem nome útil: tokens/UUID, changelog (4) e nota pessoal (6).
function isRealRoom(r: TalkRoom): boolean {
  const n = (r.displayName || '').trim();
  if (!n) return false;
  if (r.type === 4 || r.type === 6) return false;
  if (UUID_RE.test(n) || /^[0-9a-f]{16,}$/i.test(n)) return false;
  return true;
}

export function InvitePopover({ room, title, coords, onClose }: Props) {
  const [rooms, setRooms] = useState<TalkRoom[]>([]);
  const [users, setUsers] = useState<NCUser[]>([]);
  const [search, setSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [sending, setSending] = useState<string | null>(null); // id do alvo em envio
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Carrega conversas recentes ao abrir (filtra tokens/UUID e mantém as 8 reais).
  useEffect(() => {
    fetchRooms()
      .then((rs) => setRooms(rs.filter(isRealRoom).slice(0, 8)))
      .catch(() => {});
  }, []);

  // Busca usuários conforme digita (debounce).
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setUsers([]);
      setLoadingUsers(false);
      return;
    }
    setLoadingUsers(true);
    const t = setTimeout(() => {
      searchNCUsers(q)
        .then(setUsers)
        .catch(() => setUsers([]))
        .finally(() => setLoadingUsers(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const send = async (key: string, getToken: () => Promise<string>) => {
    setSending(key);
    setError(null);
    try {
      const token = await getToken();
      await sendMessage(token, inviteText(title, room));
      setSentTo(key);
      setTimeout(onClose, 900);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Não foi possível enviar o convite.');
      setSending(null);
    }
  };

  const sendToRoom = (r: TalkRoom) => send(`room-${r.token}`, async () => r.token);
  const sendToUser = (u: NCUser) =>
    send(`user-${u.id}`, async () => {
      const dm = await createRoom(1, u.id); // 1 = conversa 1:1
      return dm.token;
    });

  const q = norm(search.trim());
  const filteredRooms = q ? rooms.filter((r) => norm(r.displayName).includes(q)) : rooms;

  // Evita listar em "Pessoas" alguém que já apareceu em "Conversas" (DM existente).
  const roomNames = new Set(filteredRooms.map((r) => norm(r.displayName)));
  const filteredUsers = users.filter((u) => !roomNames.has(norm(u.label)));

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        className="fixed z-[101] w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ top: coords.top, left: coords.left, maxHeight: 360 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
            Convidar para a reunião
          </p>
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg px-2">
            <Search size={13} className="text-slate-400 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pessoa ou conversa…"
              className="w-full bg-transparent text-sm py-1.5 focus:outline-none text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>

        <div className="overflow-y-auto scrollbar-thin py-1">
          {/* Conversas */}
          {filteredRooms.length > 0 && (
            <>
              <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                Conversas
              </p>
              {filteredRooms.map((r) => {
                const key = `room-${r.token}`;
                return (
                  <button
                    key={r.token}
                    onClick={() => sendToRoom(r)}
                    disabled={!!sending}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {r.type === 1 ? (
                      <UserIcon size={13} className="text-slate-400 flex-shrink-0" />
                    ) : (
                      <Users size={13} className="text-slate-400 flex-shrink-0" />
                    )}
                    <span className="flex-1 text-left truncate">{r.displayName}</span>
                    {sentTo === key ? (
                      <Check size={14} className="text-green-600" />
                    ) : sending === key ? (
                      <Loader2 size={14} className="animate-spin text-slate-400" />
                    ) : (
                      <Send size={13} className="text-slate-300" />
                    )}
                  </button>
                );
              })}
            </>
          )}

          {/* Pessoas (resultado da busca) */}
          {loadingUsers && (
            <p className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Buscando…
            </p>
          )}
          {filteredUsers.length > 0 && (
            <>
              <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                Pessoas
              </p>
              {filteredUsers.map((u) => {
                const key = `user-${u.id}`;
                return (
                  <button
                    key={u.id}
                    onClick={() => sendToUser(u)}
                    disabled={!!sending}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    <UserIcon size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{u.label}</span>
                    {sentTo === key ? (
                      <Check size={14} className="text-green-600" />
                    ) : sending === key ? (
                      <Loader2 size={14} className="animate-spin text-slate-400" />
                    ) : (
                      <Send size={13} className="text-slate-300" />
                    )}
                  </button>
                );
              })}
            </>
          )}

          {!loadingUsers && filteredRooms.length === 0 && filteredUsers.length === 0 && (
            <p className="px-3 py-3 text-xs text-slate-400 text-center">
              {search.trim().length >= 2 ? 'Nada encontrado.' : 'Digite para buscar uma pessoa.'}
            </p>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border-t border-red-100 dark:border-red-900/30">
            {error}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
