import { useState, useRef, useEffect, useCallback } from 'react';

export type RecStatus = 'idle' | 'recording';

// Grava o áudio da reunião compartilhando uma aba/janela (getDisplayMedia com áudio).
// Captura TODOS os participantes (não só o microfone local). Ao parar — manualmente
// ou quando o usuário encerra o compartilhamento pela barra do navegador — entrega
// o Blob de áudio via onComplete.
export function useMeetingRecorder(onComplete: (blob: Blob) => void) {
  const [status, setStatus] = useState<RecStatus>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Seu navegador não suporta captura de tela/áudio.');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        setError('Marque "compartilhar áudio da aba" ao escolher a janela da reunião.');
        return false;
      }
      streamRef.current = stream;
      // Encerrou o compartilhamento pela barra do navegador → para a gravação.
      stream.getVideoTracks().forEach((t) =>
        t.addEventListener('ended', () => {
          if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
        }),
      );

      const audioStream = new MediaStream(audioTracks);
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(audioStream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        cleanup();
        if (blob.size > 0) onCompleteRef.current(blob);
      };
      recRef.current = rec;
      rec.start(1000);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      setStatus('recording');
      return true;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Permissão para compartilhar negada.'
          : 'Não foi possível iniciar a gravação.',
      );
      cleanup();
      return false;
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }, []);

  // Garante limpeza se o componente desmontar gravando.
  useEffect(
    () => () => {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { status, seconds, error, start, stop };
}
