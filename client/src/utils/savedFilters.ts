export interface SavedFilter {
  id: string;
  name: string;
  projectId?: number;
  sortBy: 'priority' | 'due_date' | 'updated';
  priorityFilter: string;
  alertFilter: string | null;
}

const LS_KEY = 'kanban-saved-filters';

export function loadSavedFilters(): SavedFilter[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

export function persistFilter(filter: SavedFilter): void {
  const all = loadSavedFilters();
  const idx = all.findIndex(f => f.id === filter.id);
  if (idx >= 0) all[idx] = filter; else all.push(filter);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

export function removeFilter(id: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(loadSavedFilters().filter(f => f.id !== id)));
}
