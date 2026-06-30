const KEY = 'rk_wiki_links';

export interface WikiLink {
  id: string;
  title: string;
  namespace: string;
}

type Store = Record<string, WikiLink[]>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function save(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export const wikiLinks = {
  get(issueId: number): WikiLink[] {
    return load()[String(issueId)] ?? [];
  },

  add(issueId: number, link: WikiLink) {
    const store = load();
    const key = String(issueId);
    const existing = store[key] ?? [];
    if (existing.some((l) => l.id === link.id)) return;
    store[key] = [...existing, link];
    save(store);
  },

  remove(issueId: number, linkId: string) {
    const store = load();
    const key = String(issueId);
    store[key] = (store[key] ?? []).filter((l) => l.id !== linkId);
    if (store[key].length === 0) delete store[key];
    save(store);
  },
};
