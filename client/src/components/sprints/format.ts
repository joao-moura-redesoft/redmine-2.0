import type { Issue } from '../../types/redmine';

// "Fechada" de forma confiável: o is_closed embutido na issue da listagem do
// Redmine nem sempre vem, então conferimos também contra o conjunto de IDs de
// status fechados (vindo de /issue_statuses via useStatuses).
export function isClosedStatus(issue: Issue, closedIds?: Set<number>): boolean {
  if (issue.status?.is_closed) return true;
  if (closedIds && issue.status?.id != null) return closedIds.has(issue.status.id);
  return false;
}

// Helpers de data para os cards de sprint.

export function daysLeftFrom(endDate: string | null): number | null {
  if (!endDate) return null;
  return Math.ceil((new Date(endDate + 'T00:00:00').getTime() - Date.now()) / 86_400_000);
}

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function fmtRange(start: string | null, end: string | null): string | null {
  if (start && end) return `${fmtDay(start)} – ${fmtDay(end)}`;
  if (end) return `até ${fmtDay(end)}`;
  if (start) return `de ${fmtDay(start)}`;
  return null;
}
