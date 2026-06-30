const KEY = 'talk-muted-rooms';

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function save(s: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...s]));
}

export const talkMute = {
  isMuted: (token: string) => load().has(token),
  toggle: (token: string): boolean => {
    const s = load();
    s.has(token) ? s.delete(token) : s.add(token);
    save(s);
    return s.has(token);
  },
};
