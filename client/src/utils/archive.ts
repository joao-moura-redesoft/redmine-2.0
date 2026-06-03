export const ARCHIVE_KEY = 'redmine-kanban-archived';

export function loadArchived(): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]')); }
  catch { return new Set(); }
}

export function saveArchived(ids: Set<number>) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...ids]));
}
