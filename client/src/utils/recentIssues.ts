/**
 * Tarefas abertas recentemente — guardadas no localStorage pra aparecerem no
 * command palette (Ctrl+K) quando o campo está vazio. Mais recente primeiro.
 */
const KEY = 'bluemine_recent_issues';
const MAX = 8;

export interface RecentIssue {
  id: number;
  subject: string;
  status: string;
}

export function getRecentIssues(): RecentIssue[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r.id === 'number').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function recordRecentIssue(issue: RecentIssue) {
  try {
    const cur = getRecentIssues().filter((r) => r.id !== issue.id);
    const next = [{ id: issue.id, subject: issue.subject, status: issue.status }, ...cur].slice(
      0,
      MAX,
    );
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}
