import { useSyncExternalStore } from 'react';

/**
 * Templates de texto (respostas prontas / modelos de descrição) — cadastráveis
 * pelo usuário, guardados no localStorage. Usados no compositor de comentário e
 * (futuro) na descrição de nova tarefa. Nada hardcoded.
 */
const KEY = 'bluemine_templates';

export interface Template {
  id: string;
  name: string;
  body: string;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function read(): Template[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((t) => t && typeof t.id === 'string' && typeof t.body === 'string')
      : [];
  } catch {
    return [];
  }
}

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function write(list: Template[]) {
  current = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
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

export const templatesStore = {
  getAll: () => current,
  add: (name: string, body: string): Template => {
    const t = { id: newId(), name: name.trim() || 'Sem título', body };
    write([...current, t]);
    return t;
  },
  update: (id: string, patch: Partial<Pick<Template, 'name' | 'body'>>) =>
    write(current.map((t) => (t.id === id ? { ...t, ...patch } : t))),
  remove: (id: string) => write(current.filter((t) => t.id !== id)),
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function useTemplates(): Template[] {
  return useSyncExternalStore(templatesStore.subscribe, templatesStore.getAll, templatesStore.getAll);
}
