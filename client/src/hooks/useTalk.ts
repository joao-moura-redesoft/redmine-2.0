import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchRooms, fetchMessages, sendMessage, fetchTalkMe, getTalkAuth } from '../api/talk';

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
    refetchInterval: 8_000,
    staleTime: 4_000,
  });
}

export function useSendMessage(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => sendMessage(token!, message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talk-messages', token] });
      qc.invalidateQueries({ queryKey: ['talk-rooms'] });
    },
  });
}
