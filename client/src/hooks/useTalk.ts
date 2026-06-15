import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRooms, fetchMessages, sendMessage, fetchTalkMe, getTalkAuth,
  editMessage, deleteMessage, addReaction, removeReaction, createRoom, searchNCUsers,
} from '../api/talk';
import type { TalkMessage } from '../api/talk';
import { useCallback, useEffect, useRef, useState } from 'react';

function talkEnabled() { return !!getTalkAuth(); }

export function useTalkCurrentUser() {
  return useQuery({
    queryKey: ['talk-me'],
    queryFn: fetchTalkMe,
    enabled: talkEnabled(),
    staleTime: Infinity,
  });
}

export function useTalkRooms() {
  return useQuery({
    queryKey: ['talk-rooms'],
    queryFn: fetchRooms,
    enabled: talkEnabled(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useTalkMessages(token: string | null) {
  return useQuery({
    queryKey: ['talk-messages', token],
    queryFn: () => fetchMessages(token!),
    enabled: !!token && talkEnabled(),
    refetchInterval: 30_000, // SSE handles real-time; this is just a sync fallback
    staleTime: 4_000,
  });
}

export function useSendMessage(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, replyTo }: { message: string; replyTo?: number }) =>
      sendMessage(token!, message, replyTo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talk-messages', token] });
      qc.invalidateQueries({ queryKey: ['talk-rooms'] });
    },
  });
}

export function useEditMessage(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, message }: { messageId: number; message: string }) =>
      editMessage(token!, messageId, message),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talk-messages', token] }),
  });
}

export function useDeleteMessage(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => deleteMessage(token!, messageId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['talk-messages', token] }),
  });
}

export function useReaction(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, reaction, remove }: { messageId: number; reaction: string; remove?: boolean }) =>
      remove
        ? removeReaction(token!, messageId, reaction)
        : addReaction(token!, messageId, reaction),
    onSettled: () => qc.invalidateQueries({ queryKey: ['talk-messages', token] }),
  });
}

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomType, invite, roomName }: { roomType: number; invite: string; roomName?: string }) =>
      createRoom(roomType, invite, roomName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talk-rooms'] }),
  });
}

export function useSearchNCUsers(query: string) {
  return useQuery({
    queryKey: ['talk-search-users', query],
    queryFn: () => searchNCUsers(query),
    enabled: query.length >= 2 && talkEnabled(),
    staleTime: 30_000,
  });
}

// Debounced typing sender — chama sendTyping sem sobrecarregar a API.
export function useTypingSender(token: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  const onType = useCallback(() => {
    if (!token) return;
    if (!isTyping.current) {
      isTyping.current = true;
      fetch(`/api/talk/rooms/${encodeURIComponent(token)}/typing`, {
        method: 'POST',
        headers: (() => {
          const auth = getTalkAuth();
          return {
            'Content-Type': 'application/json',
            ...(auth ? {
              'x-nextcloud-url': auth.url,
              'x-nextcloud-user': auth.user,
              'x-nextcloud-token': auth.token,
            } : {}),
          };
        })(),
        body: JSON.stringify({ typing: true }),
      }).catch(() => {});
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isTyping.current = false;
      fetch(`/api/talk/rooms/${encodeURIComponent(token)}/typing`, {
        method: 'POST',
        headers: (() => {
          const auth = getTalkAuth();
          return {
            'Content-Type': 'application/json',
            ...(auth ? {
              'x-nextcloud-url': auth.url,
              'x-nextcloud-user': auth.user,
              'x-nextcloud-token': auth.token,
            } : {}),
          };
        })(),
        body: JSON.stringify({ typing: false }),
      }).catch(() => {});
    }, 3000);
  }, [token]);

  const stopTyping = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (isTyping.current && token) {
      isTyping.current = false;
      fetch(`/api/talk/rooms/${encodeURIComponent(token)}/typing`, {
        method: 'POST',
        headers: (() => {
          const auth = getTalkAuth();
          return {
            'Content-Type': 'application/json',
            ...(auth ? {
              'x-nextcloud-url': auth.url,
              'x-nextcloud-user': auth.user,
              'x-nextcloud-token': auth.token,
            } : {}),
          };
        })(),
        body: JSON.stringify({ typing: false }),
      }).catch(() => {});
    }
  }, [token]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { onType, stopTyping };
}

// SSE hook — atualiza o cache de mensagens em tempo real via long-poll do Talk.
// initialMessageId: ID da mensagem mais recente já carregada; 0 = SSE desativado.
// Usar Math.max(...messages.map(m=>m.id)) no caller para funcionar com qualquer ordem da API.
export function useTalkSSE(token: string | null, initialMessageId: number) {
  const qc = useQueryClient();
  const [typingUsers, setTypingUsers] = useState<Array<{ actorId: string; actorDisplayName: string }>>([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Booleano como dep: SSE só (re)inicia quando passa de 0 para >0, evita restart a cada mensagem.
  const active = initialMessageId > 0;

  useEffect(() => {
    if (!token || !active || !talkEnabled()) return;
    const auth = getTalkAuth();
    if (!auth) return;

    const params = new URLSearchParams({
      ncUrl:   auth.url,
      ncUser:  auth.user,
      ncToken: auth.token,
      lastKnownMessageId: String(initialMessageId),
    });

    const sse = new EventSource(`/api/talk/rooms/${encodeURIComponent(token)}/sse?${params}`);

    sse.onmessage = (e) => {
      let event: { type: string; data: unknown };
      try { event = JSON.parse(e.data); } catch { return; }

      if (event.type === 'messages') {
        const msgs = event.data as TalkMessage[];
        let hadNew = false;
        qc.setQueryData(['talk-messages', token], (old: TalkMessage[] = []) => {
          const ids = new Set(old.map(m => m.id));
          const toAdd = [...msgs].reverse().filter(m => !ids.has(m.id));
          if (toAdd.length === 0) return old;
          hadNew = true;
          return [...toAdd, ...old];
        });
        // invalidateQueries fora do updater para evitar efeito colateral em função pura
        if (hadNew) qc.invalidateQueries({ queryKey: ['talk-rooms'] });
      }

      if (event.type === 'typing') {
        const users = event.data as Array<{ actorId: string; actorDisplayName: string }>;
        setTypingUsers(prev => {
          const map = new Map(prev.map(u => [u.actorId, u]));
          users.forEach(u => map.set(u.actorId, u));
          return [...map.values()];
        });
        // Auto-remove typing indicator after 5s
        users.forEach(u => {
          const prev = typingTimers.current.get(u.actorId);
          if (prev) clearTimeout(prev);
          typingTimers.current.set(u.actorId, setTimeout(() => {
            setTypingUsers(p => p.filter(x => x.actorId !== u.actorId));
            typingTimers.current.delete(u.actorId);
          }, 5000));
        });
      }
    };

    sse.onerror = () => {
      // EventSource reconecta automaticamente; sem ação necessária.
    };

    return () => {
      sse.close();
      typingTimers.current.forEach(t => clearTimeout(t));
      typingTimers.current.clear();
      setTypingUsers([]);
    };
  }, [token, active]); // active é booleano: muda só 1x (0→>0), nunca reinicia por nova mensagem

  return { typingUsers };
}
