import { useSyncExternalStore } from 'react';

/**
 * "Observar" 100% local: guarda no localStorage os IDs das tarefas que o usuário
 * marcou para acompanhar, sem depender da API de watchers do Redmine (que exige
 * permissão que o usuário não tem). A aba "Observadas" lê esses IDs e busca os
 * detalhes das tarefas no Redmine por ID.
 */

const KEY = 'redmine_local_watches';

function read(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

let current = read();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

function write(ids: number[]) {
  current = ids;
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* quota/private mode */ }
  emit();
}

// Sincroniza entre abas do navegador
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === KEY) { current = read(); emit(); }
  });
}

export const localWatches = {
  getIds: () => current,
  isWatching: (id: number) => current.includes(id),
  toggle: (id: number) =>
    write(current.includes(id) ? current.filter(x => x !== id) : [...current, id]),
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};

/** Hook reativo: re-renderiza quando a lista de observadas muda. */
export function useLocalWatches(): number[] {
  return useSyncExternalStore(localWatches.subscribe, localWatches.getIds, localWatches.getIds);
}
