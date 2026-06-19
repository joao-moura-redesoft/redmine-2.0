import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jitsiApi, type LiveRoom } from '../api/jitsi';

// Polling leve das salas de vídeo ativas. Todos os cards compartilham a mesma
// query (dedupe do React Query), então é uma requisição só a cada 15s.
export function useJitsiPresence() {
  const { data, isSuccess } = useQuery({
    queryKey: ['jitsi-presence'],
    queryFn: jitsiApi.getPresence,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    staleTime: 10000,
  });

  const byIssue = useMemo(() => {
    const m = new Map<number, LiveRoom>();
    for (const r of data ?? []) if (r.issueId != null) m.set(r.issueId, r);
    return m;
  }, [data]);

  return {
    rooms: data ?? [],
    isLoaded: isSuccess,
    isLive: (issueId: number) => byIssue.has(issueId),
    liveRoom: (issueId: number) => byIssue.get(issueId),
  };
}
