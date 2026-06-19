import { useEffect, useRef, useState, useMemo } from 'react';
import { Video, X, Users } from 'lucide-react';
import { useJitsi } from './JitsiContext';
import { useJitsiPresence } from '../../hooks/useJitsiPresence';
import { useIssues, useAuthoredIssues, useMonitoredIssues } from '../../hooks/useRedmine';
import { useLocalWatches } from '../../utils/localWatches';
import { makeTaskRoom } from '../../utils/jitsiConfig';

interface LiveToast {
  room: string;
  issueId: number;
  participants: string[];
}

// Avisa quando uma reunião começa numa tarefa relevante (atribuída/criada/
// monitorada/observada), sem spammar: prima o estado no primeiro carregamento
// (reuniões já em andamento aparecem só no badge AO VIVO) e notifica apenas as
// que começarem depois.
export function MeetingLiveToasts() {
  const { rooms, isLoaded } = useJitsiPresence();
  const { startCall, activeCall, poppedOut } = useJitsi();

  const { data: myIssues } = useIssues();
  const { data: authored } = useAuthoredIssues();
  const { data: monitored } = useMonitoredIssues();
  const watchedIds = useLocalWatches();

  const relevant = useMemo(() => {
    const s = new Set<number>();
    [myIssues, authored, monitored].forEach(list => list?.forEach(i => s.add(i.id)));
    watchedIds.forEach(id => s.add(id));
    return s;
  }, [myIssues, authored, monitored, watchedIds]);

  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const [toasts, setToasts] = useState<LiveToast[]>([]);

  const dismiss = (room: string) => setToasts(t => t.filter(x => x.room !== room));

  const join = (t: LiveToast) => {
    startCall({ room: makeTaskRoom(t.issueId), title: `#${t.issueId}`, kind: 'task', issueId: t.issueId });
    dismiss(t.room);
  };

  useEffect(() => {
    if (!isLoaded) return;
    const myRoom = activeCall?.room ?? poppedOut?.room;
    const liveTask = rooms.filter(r => r.issueId != null);
    const liveKeys = new Set(liveTask.map(r => r.room));

    // Limpa salas que já encerraram (permite re-notificar se reabrirem depois).
    for (const k of [...seenRef.current]) if (!liveKeys.has(k)) seenRef.current.delete(k);

    // Primeiro carregamento: marca tudo como visto sem notificar.
    if (!primedRef.current) {
      primedRef.current = true;
      liveTask.forEach(r => seenRef.current.add(r.room));
      return;
    }

    for (const r of liveTask) {
      if (seenRef.current.has(r.room)) continue;
      seenRef.current.add(r.room);
      if (r.room === myRoom) continue;            // já estou nela
      if (!relevant.has(r.issueId as number)) continue; // não é tarefa minha

      const toast: LiveToast = { room: r.room, issueId: r.issueId as number, participants: r.participants };
      setToasts(prev => prev.some(p => p.room === r.room) ? prev : [...prev, toast]);
      // expira o toast sozinho
      setTimeout(() => dismiss(r.room), 30000);

      // Notificação do navegador (aba aberta).
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('🔴 Reunião ao vivo', {
            body: `${r.participants.join(', ')} em #${r.issueId}`,
            tag: r.room,
          });
          n.onclick = () => { window.focus(); join(toast); };
        } catch { /* ignore */ }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, isLoaded, relevant, activeCall, poppedOut]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[95] flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.room}
          className="w-72 flex items-start gap-2.5 p-3 rounded-xl shadow-2xl border border-red-200 dark:border-red-900/40 bg-white dark:bg-slate-900"
        >
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0 mt-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Reunião ao vivo · #{t.issueId}
            </p>
            <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5 truncate">
              <Users size={11} /> {t.participants.join(', ')}
            </p>
            <button
              onClick={() => join(t)}
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 transition-colors"
            >
              <Video size={13} /> Entrar
            </button>
          </div>
          <button
            onClick={() => dismiss(t.room)}
            title="Dispensar"
            className="p-1 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
