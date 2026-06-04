import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../types/redmine';
import { useBrowserNotifications } from './useBrowserNotifications';

export type NotifType = 'assigned' | 'activity' | 'review';

export interface AppNotification {
  id: string;
  type: NotifType;
  issue: Issue;
  seenAt: Date;
}

function issueBody(issue: Issue): string {
  return `#${issue.id} — ${issue.subject}\n${issue.project.name}`;
}

/**
 * Detecta:
 *  - 'assigned': novas tarefas atribuídas a mim (entram em assignedIssues)
 *  - 'review':   novas tarefas na fila de revisão
 *  - 'activity': mudança de updated_on em tarefas monitoradas/observadas
 */
export function useActivityNotifications(
  assignedIssues: Issue[] | undefined,
  activityIssues: Issue[] | undefined,
  reviewIssues?: Issue[] | undefined,
) {
  const { notify } = useBrowserNotifications();

  const seenAssigned = useRef<Set<number> | null>(null);
  const seenReview = useRef<Set<number> | null>(null);
  const lastUpdated = useRef<Map<number, string> | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // ── Novas atribuições ──────────────────────────────────────────────────
  useEffect(() => {
    if (!assignedIssues) return;
    const ids = new Set(assignedIssues.map(i => i.id));
    if (seenAssigned.current === null) { seenAssigned.current = ids; return; }

    const novos = assignedIssues.filter(i => !seenAssigned.current!.has(i.id));
    seenAssigned.current = ids;
    if (novos.length === 0) return;

    const now = new Date();
    setNotifications(prev => [
      ...novos.map(issue => ({
        id: `a-${issue.id}-${now.getTime()}`,
        type: 'assigned' as NotifType,
        issue,
        seenAt: now,
      })),
      ...prev,
    ]);
    novos.forEach(issue =>
      notify('📋 Nova tarefa atribuída a você', {
        body: issueBody(issue),
        tag: `rk-a-${issue.id}`,
      }),
    );
  }, [assignedIssues, notify]);

  // ── Novos pedidos de revisão ───────────────────────────────────────────
  useEffect(() => {
    if (!reviewIssues) return;
    const ids = new Set(reviewIssues.map(i => i.id));
    if (seenReview.current === null) { seenReview.current = ids; return; }

    const novos = reviewIssues.filter(i => !seenReview.current!.has(i.id));
    seenReview.current = ids;
    if (novos.length === 0) return;

    const now = new Date();
    setNotifications(prev => [
      ...novos.map(issue => ({
        id: `r-${issue.id}-${now.getTime()}`,
        type: 'review' as NotifType,
        issue,
        seenAt: now,
      })),
      ...prev,
    ]);
    novos.forEach(issue =>
      notify('🔍 Pedido de revisão', {
        body: issueBody(issue),
        tag: `rk-r-${issue.id}`,
      }),
    );
  }, [reviewIssues, notify]);

  // ── Atividade em tarefas monitoradas/observadas ────────────────────────
  useEffect(() => {
    if (!activityIssues) return;
    const map = new Map(activityIssues.map(i => [i.id, i.updated_on]));
    if (lastUpdated.current === null) { lastUpdated.current = map; return; }

    const changed = activityIssues.filter(i => {
      const prev = lastUpdated.current!.get(i.id);
      return prev !== undefined && prev !== i.updated_on;
    });
    lastUpdated.current = map;
    if (changed.length === 0) return;

    const now = new Date();
    setNotifications(prev => [
      ...changed.map(issue => ({
        id: `c-${issue.id}-${now.getTime()}`,
        type: 'activity' as NotifType,
        issue,
        seenAt: now,
      })),
      ...prev,
    ]);
    changed.forEach(issue =>
      notify('💬 Nova atividade em tarefa que você acompanha', {
        body: issueBody(issue),
        tag: `rk-c-${issue.id}-${issue.updated_on}`,
      }),
    );
  }, [activityIssues, notify]);

  const dismiss = (id: string) =>
    setNotifications(prev => prev.filter(n => n.id !== id));
  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
