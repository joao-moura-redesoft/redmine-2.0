import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react';
import { useMeetingRecorder } from '../../hooks/useMeetingRecorder';
import { MeetingSummaryModal } from './MeetingSummaryModal';

export type CallKind = 'task' | 'daily' | 'adhoc';

export interface ActiveCall {
  room: string; // nome técnico da sala no Jitsi
  title: string; // rótulo exibido na janela (ex.: "#90688 Corrigir login")
  kind: CallKind;
  issueId?: number; // presente quando kind === 'task'
}

// Reunião destacada numa janela separada do navegador (página nativa do Jitsi).
export interface PoppedOutCall extends ActiveCall {
  win: Window | null;
}

interface JitsiContextValue {
  activeCall: ActiveCall | null;
  minimized: boolean;
  poppedOut: PoppedOutCall | null;
  startCall: (call: ActiveCall) => void;
  endCall: () => void;
  popOut: (call: PoppedOutCall) => void;
  closePopout: () => void;
  toggleMinimize: () => void;
  setMinimized: (v: boolean) => void;
  recorder: ReturnType<typeof useMeetingRecorder>;
}

const JitsiContext = createContext<JitsiContextValue | null>(null);

export function JitsiProvider({ children }: { children: ReactNode }) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [poppedOut, setPoppedOut] = useState<PoppedOutCall | null>(null);
  const poppedOutRef = useRef<PoppedOutCall | null>(null);
  useEffect(() => {
    poppedOutRef.current = poppedOut;
  }, [poppedOut]);

  // ── Gravação e Resumo de IA ──
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordedCall, setRecordedCall] = useState<ActiveCall | PoppedOutCall | null>(null);

  const currentCallRef = useRef<ActiveCall | PoppedOutCall | null>(null);
  useEffect(() => {
    currentCallRef.current = activeCall || poppedOut;
  }, [activeCall, poppedOut]);

  const recorder = useMeetingRecorder((blob) => {
    setAudioBlob(blob);
    setRecordedCall(currentCallRef.current);
    setSummaryOpen(true);
  });

  const closeSummary = useCallback(() => {
    setSummaryOpen(false);
    setAudioBlob(null);
  }, []);

  const startCall = useCallback((call: ActiveCall) => {
    // Se a sala já está numa janela separada, só foca nela — não reembute (evita
    // o mesmo usuário entrar duas vezes na sala).
    const popped = poppedOutRef.current;
    if (popped && popped.room === call.room) {
      try {
        popped.win?.focus();
      } catch {
        /* ignore */
      }
      return;
    }
    setActiveCall((prev) => {
      // Já está na mesma sala: só garante que esteja visível.
      if (prev && prev.room === call.room) return prev;
      return call;
    });
    setMinimized(false);
  }, []);

  const endCall = useCallback(() => {
    setActiveCall(null);
    setMinimized(false);
  }, []);

  // Destaca: a sala passa a viver na janela separada; o iframe embutido sai.
  const popOut = useCallback((call: PoppedOutCall) => {
    setActiveCall(null);
    setMinimized(false);
    setPoppedOut(call);
  }, []);

  const closePopout = useCallback(() => {
    setPoppedOut((prev) => {
      try {
        if (prev?.win && !prev.win.closed) prev.win.close();
      } catch {
        /* ignore */
      }
      return null;
    });
  }, []);

  const toggleMinimize = useCallback(() => setMinimized((v) => !v), []);

  return (
    <JitsiContext.Provider
      value={{
        activeCall,
        minimized,
        poppedOut,
        startCall,
        endCall,
        popOut,
        closePopout,
        toggleMinimize,
        setMinimized,
        recorder,
      }}
    >
      {children}
      <MeetingSummaryModal
        isOpen={summaryOpen}
        onClose={closeSummary}
        audioBlob={audioBlob}
        call={recordedCall}
      />
    </JitsiContext.Provider>
  );
}

export function useJitsi(): JitsiContextValue {
  const ctx = useContext(JitsiContext);
  if (!ctx) throw new Error('useJitsi precisa estar dentro de <JitsiProvider>');
  return ctx;
}
