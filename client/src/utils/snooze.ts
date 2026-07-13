import { useSyncExternalStore } from 'react';

/**
 * "Adiar" (snooze) 100% local: guarda no localStorage um mapa { issueId: até (ms) }.
 * Enquanto adiada, a tarefa some do Inbox; quando o horário chega, ela volta e um
 * lembrete é disparado (ver useSnoozeReminders). Segue o padrão do localWatches.
 */
const KEY = 'bluemine_snoozes';

type SnoozeMap = Record<number, number>; // issueId -> timestamp (ms) de retorno

function read(): SnoozeMap {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (!obj || typeof obj !== 'object') return {};
    const out: SnoozeMap = {};
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (Number.isFinite(id) && typeof v === 'number') out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function write(map: SnoozeMap) {
  current = map;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
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

export const snoozeStore = {
  getMap: () => current,
  isSnoozed: (id: number) => (current[id] ?? 0) > Date.now(),
  snooze: (id: number, until: number) => write({ ...current, [id]: until }),
  unsnooze: (id: number) => {
    if (!(id in current)) return;
    const { [id]: _drop, ...rest } = current;
    write(rest);
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

/** Mapa reativo de snoozes. */
export function useSnoozes(): SnoozeMap {
  return useSyncExternalStore(snoozeStore.subscribe, snoozeStore.getMap, snoozeStore.getMap);
}

// ── Presets de horário ──────────────────────────────────────────────────────
export interface SnoozePreset {
  key: string;
  label: string;
  at: () => number;
}

function atTime(d: Date, h: number, m = 0): number {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.getTime();
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { key: '1h', label: 'Em 1 hora', at: () => Date.now() + 60 * 60 * 1000 },
  { key: 'evening', label: 'Hoje, 18h', at: () => atTime(new Date(), 18) },
  { key: 'tomorrow', label: 'Amanhã, 9h', at: () => atTime(new Date(Date.now() + 864e5), 9) },
  {
    key: 'nextweek',
    label: 'Próxima segunda',
    at: () => {
      const d = new Date();
      const day = d.getDay(); // 0=dom
      const add = (8 - day) % 7 || 7; // próxima segunda
      return atTime(new Date(d.getTime() + add * 864e5), 9);
    },
  },
];

/** Rótulo curto de quando a tarefa volta (ex.: "amanhã 9h"). */
export function snoozeLabel(until: number): string {
  const d = new Date(until);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 864e5).toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  if (sameDay) return `hoje ${hm}`;
  if (tomorrow) return `amanhã ${hm}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}
