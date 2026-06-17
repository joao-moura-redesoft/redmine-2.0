import { useSyncExternalStore } from 'react';

/**
 * "Meu Dia": plano de foco diário, 100% local. Guarda os IDs das tarefas que o
 * usuário escolheu trabalhar hoje (em ordem) e quais marcou como concluídas no
 * plano. Mantém o histórico de poucos dias para permitir "puxar" pendências do
 * dia anterior. A view busca os detalhes das tarefas por ID.
 */

const KEY = 'rk_my_day';

interface DayPlan {
  ids: number[];
  done: number[];
}
type Store = Record<string, DayPlan>;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

let store = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function persist() {
  // Mantém só os últimos 7 dias para não crescer indefinidamente.
  const keys = Object.keys(store).sort().slice(-7);
  store = Object.fromEntries(keys.map(k => [k, store[k]]));
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota */ }
  emit();
}

function plan(): DayPlan {
  return store[todayKey()] ?? { ids: [], done: [] };
}

function setPlan(p: DayPlan) {
  store = { ...store, [todayKey()]: p };
  persist();
}

let cachedKey = '';
let cachedSnapshot: DayPlan = { ids: [], done: [] };
// useSyncExternalStore exige snapshot estável (mesma referência se nada mudou).
function snapshot(): DayPlan {
  const key = todayKey() + '|' + JSON.stringify(store[todayKey()] ?? {});
  if (key !== cachedKey) { cachedKey = key; cachedSnapshot = plan(); }
  return cachedSnapshot;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === KEY) { store = read(); emit(); }
  });
}

export const myDay = {
  get: () => plan(),
  has: (id: number) => plan().ids.includes(id),
  add: (id: number) => {
    const p = plan();
    if (p.ids.includes(id)) return;
    setPlan({ ...p, ids: [...p.ids, id] });
  },
  remove: (id: number) => {
    const p = plan();
    setPlan({ ids: p.ids.filter(x => x !== id), done: p.done.filter(x => x !== id) });
  },
  toggleDone: (id: number) => {
    const p = plan();
    const done = p.done.includes(id) ? p.done.filter(x => x !== id) : [...p.done, id];
    setPlan({ ...p, done });
  },
  move: (id: number, dir: -1 | 1) => {
    const p = plan();
    const idx = p.ids.indexOf(id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= p.ids.length) return;
    const ids = [...p.ids];
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    setPlan({ ...p, ids });
  },
  clearDone: () => {
    const p = plan();
    setPlan({ ids: p.ids.filter(x => !p.done.includes(x)), done: [] });
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};

/** Hook reativo: re-renderiza quando o plano de hoje muda. */
export function useMyDay(): DayPlan {
  return useSyncExternalStore(myDay.subscribe, snapshot, snapshot);
}
