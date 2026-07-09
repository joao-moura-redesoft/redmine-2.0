import { useSyncExternalStore } from 'react';

/**
 * Sessão de foco (Pomodoro) atada a uma tarefa. Ao terminar (ou parar), o tempo
 * é apontado automaticamente no Redmine (ver FocusWidget + useStopAndLog).
 * Uma sessão por vez; persistida no localStorage.
 */
const KEY = 'bluemine_focus';
export const FOCUS_MINUTES = 25;

export interface FocusSession {
  issueId: number;
  subject: string;
  startedAt: number;
  minutes: number;
}

function read(): FocusSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o.issueId === 'number' && typeof o.startedAt === 'number' ? o : null;
  } catch {
    return null;
  }
}

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function write(s: FocusSession | null) {
  current = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* quota */
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      current = read();
      emit();
    }
  });
}

export const focusStore = {
  get: () => current,
  start: (issueId: number, subject: string, minutes = FOCUS_MINUTES) =>
    write({ issueId, subject, startedAt: Date.now(), minutes }),
  clear: () => write(null),
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function useFocus(): FocusSession | null {
  return useSyncExternalStore(focusStore.subscribe, focusStore.get, focusStore.get);
}
