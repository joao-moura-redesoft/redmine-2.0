import { useCallback, useEffect, useState } from 'react';

/**
 * Séries de calendário silenciadas, por `uid`. Silenciar é um ato de VISÃO, não
 * um ato social: esconde a série do PANORAMA MENSAL e não fala com o organizador
 * — ao contrário de recusar, que dispara SendInviteReply com updateOrganizer=TRUE.
 *
 * Na visão Semana a série continua aparecendo como chip: lá ela é o seu dia, não
 * ruído. É a resposta para "eu vou à daily, mas não quero vê-la 22 vezes no mês".
 *
 * Local-only (localStorage), como o watch. O app roda como exe por usuário, então
 * não há necessidade de sincronizar entre máquinas.
 */
const KEY = 'calendar.mutedSeries';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return []; // localStorage corrompido/indisponível: melhor mostrar tudo do que quebrar a agenda
  }
}

// Um evento por aba: o storage nativo só dispara em OUTRAS abas, e o popover de
// silenciar precisa que o grid re-renderize na mesma aba.
const CHANGED = 'calendar.mutedSeries.changed';

export function useMutedSeries() {
  const [muted, setMuted] = useState<Set<string>>(() => new Set(read()));

  useEffect(() => {
    const sync = () => setMuted(new Set(read()));
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const write = useCallback((next: Set<string>) => {
    localStorage.setItem(KEY, JSON.stringify([...next]));
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  const mute = useCallback(
    (uid: string) => {
      const next = new Set(read());
      next.add(uid);
      write(next);
    },
    [write],
  );

  const unmute = useCallback(
    (uid: string) => {
      const next = new Set(read());
      next.delete(uid);
      write(next);
    },
    [write],
  );

  return { muted, mute, unmute, isMuted: (uid: string | null) => !!uid && muted.has(uid) };
}
