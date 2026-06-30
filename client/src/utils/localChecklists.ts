import { useSyncExternalStore } from 'react';

/**
 * Checklist por tarefa, 100% local (localStorage). Não vai para o Redmine —
 * é um bloco de notas/sub-passos pessoal por tarefa, por navegador.
 */

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

const KEY = 'redmine_local_checklists';
const EMPTY: ChecklistItem[] = [];

function readAll(): Record<string, ChecklistItem[]> {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

let store = readAll();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota/private */
  }
  emit();
}

function setItems(issueId: number, items: ChecklistItem[]) {
  store = { ...store, [issueId]: items };
  persist();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      store = readAll();
      emit();
    }
  });
}

export const localChecklists = {
  get: (issueId: number): ChecklistItem[] => store[issueId] ?? EMPTY,
  add: (issueId: number, text: string) => {
    const t = text.trim();
    if (!t) return;
    setItems(issueId, [
      ...(store[issueId] ?? []),
      { id: Date.now().toString(36), text: t, done: false },
    ]);
  },
  toggle: (issueId: number, itemId: string) =>
    setItems(
      issueId,
      (store[issueId] ?? []).map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
    ),
  remove: (issueId: number, itemId: string) =>
    setItems(
      issueId,
      (store[issueId] ?? []).filter((i) => i.id !== itemId),
    ),
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function useChecklist(issueId: number): ChecklistItem[] {
  return useSyncExternalStore(
    localChecklists.subscribe,
    () => store[issueId] ?? EMPTY,
    () => store[issueId] ?? EMPTY,
  );
}
