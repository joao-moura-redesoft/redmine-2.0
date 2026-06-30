import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecordedPcm {
  samples: Float32Array;
  sampleRate: number;
}

// Grava áudio capturando PCM direto via Web Audio (ScriptProcessor). Isso evita o
// passo frágil de decodificar o webm do MediaRecorder — entregamos amostras prontas
// para encodar em MP3 (formato nativo de mensagem de voz do Talk).
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const lenRef = useRef(0);
  const sampleRateRef = useRef(48000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      procRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    procRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  };

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      chunksRef.current = [];
      lenRef.current = 0;
      proc.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
        lenRef.current += input.length;
      };
      source.connect(proc);
      // ScriptProcessor só dispara se conectado ao destino; gain 0 evita eco/feedback.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      proc.connect(sink);
      sink.connect(ctx.destination);

      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      return true;
    } catch {
      cleanup();
      return false;
    }
  }, []);

  const merge = (): RecordedPcm | null => {
    const total = lenRef.current;
    if (!total) return null;
    const out = new Float32Array(total);
    let off = 0;
    for (const c of chunksRef.current) {
      out.set(c, off);
      off += c.length;
    }
    return { samples: out, sampleRate: sampleRateRef.current };
  };

  const finish = useCallback((): RecordedPcm | null => {
    setRecording(false);
    const pcm = merge();
    cleanup();
    return pcm;
  }, []);

  const cancel = useCallback(() => {
    setRecording(false);
    chunksRef.current = [];
    lenRef.current = 0;
    cleanup();
  }, []);

  useEffect(() => () => cleanup(), []);

  return { recording, seconds, start, finish, cancel };
}
