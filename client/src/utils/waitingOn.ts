import { useSyncExternalStore } from 'react';

/**
 * "Aguardando resposta" (waiting-on) 100% local: marca tarefas onde você está
 * esperando alguém. Quando a tarefa recebe atividade nova (updated_on > desde),
 * um aviso dispara e a marca some; se ficar parada demais, um nudge lembra.
 * Segue o padrão do snooze/localWatches.
 */
const KEY = 'bluemine_waiting_on';

interface Entry {
  since: number;
  nudgedAt?: number;
}
type Map_ = Record<number, Entry>;

function read(): Map_ {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (!obj || typeof obj !== 'object') return {};
    const out: Map_ = {};
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (Number.isFinite(id) && v && typeof (v as Entry).since === 'number') out[id] = v as Entry;
    }
    return out;
  } catch {
    return {};
  }
}

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function write(map: Map_) {
  current = map;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
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

export const waitingStore = {
  getMap: () => current,
  isWaiting: (id: number) => id in current,
  toggle: (id: number) => {
    if (id in current) {
      const { [id]: _drop, ...rest } = current;
      write(rest);
    } else {
      write({ ...current, [id]: { since: Date.now() } });
    }
  },
  clear: (id: number) => {
    if (!(id in current)) return;
    const { [id]: _drop, ...rest } = current;
    write(rest);
  },
  markNudged: (id: number) => {
    if (!(id in current)) return;
    write({ ...current, [id]: { ...current[id], nudgedAt: Date.now() } });
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function useWaitingOn(): Map_ {
  return useSyncExternalStore(waitingStore.subscribe, waitingStore.getMap, waitingStore.getMap);
}

/** "há Nd" / "há Nh" desde que começou a aguardar. */
export function waitingLabel(since: number): string {
  const ms = Date.now() - since;
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'agora';
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
