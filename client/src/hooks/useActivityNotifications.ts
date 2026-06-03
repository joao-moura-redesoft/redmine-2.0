import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../types/redmine';

export type NotifType = 'assigned' | 'activity' | 'review';

export interface AppNotification {
  id: string;
  type: NotifType;
  issue: Issue;
  seenAt: Date;
}

const PERM_ASKED_KEY = 'rk_notif_asked';

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default' && !localStorage.getItem(PERM_ASKED_KEY)) {
    localStorage.setItem(PERM_ASKED_KEY, '1');
    await Notification.requestPermission();
  }
}

function notify(title: string, issue: Issue) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body: `#${issue.id} — ${issue.subject}\n${issue.project.name}`,
    icon: '/favicon.ico',
    tag: `rk-${issue.id}-${issue.updated_on}`,
  });
  n.onclick = () => { window.focus(); n.close(); };
}

/**
 * Detecta:
 *  - 'assigned': novas tarefas atribuídas a mim (entram em assignedIssues)
 *  - 'activity': mudança de atividade (updated_on) em tarefas que monitoro/observo
 *    — exatamente onde estou esperando resposta de outra pessoa.
 */
export function useActivityNotifications(
  assignedIssues: Issue[] | undefined,
  activityIssues: Issue[] | undefined,
  reviewIssues?: Issue[] | undefined,
) {
  const seenAssigned = useRef<Set<number> | null>(null);
  const seenReview = useRef<Set<number> | null>(null);
  const lastUpdated = useRef<Map<number, string> | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => { requestNotificationPermission(); }, []);

  // Novas atribuições
  useEffect(() => {
    if (!assignedIssues) return;
    const ids = new Set(assignedIssues.map(i => i.id));
    if (seenAssigned.current === null) { seenAssigned.current = ids; return; }

    const novos = assignedIssues.filter(i => !seenAssigned.current!.has(i.id));
    seenAssigned.current = ids;
    if (novos.length === 0) return;

    const now = new Date();
    setNotifications(prev => [
      ...novos.map(issue => ({ id: `a-${issue.id}-${now.getTime()}`, type: 'assigned' as NotifType, issue, seenAt: now })),
      ...prev,
    ]);
    novos.forEach(i => notify('📋 Nova tarefa atribuída a você', i));
  }, [assignedIssues]);

  // Novos pedidos de revisão (entram na fila "Para revisar")
  useEffect(() => {
    if (!reviewIssues) return;
    const ids = new Set(reviewIssues.map(i => i.id));
    if (seenReview.current === null) { seenReview.current = ids; return; }

    const novos = reviewIssues.filter(i => !seenReview.current!.has(i.id));
    seenReview.current = ids;
    if (novos.length === 0) return;

    const now = new Date();
    setNotifications(prev => [
      ...novos.map(issue => ({ id: `r-${issue.id}-${now.getTime()}`, type: 'review' as NotifType, issue, seenAt: now })),
      ...prev,
    ]);
    novos.forEach(i => notify('🔍 Pedido de revisão', i));
  }, [reviewIssues]);

  // Atividade em tarefas monitoradas/observadas
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
      ...changed.map(issue => ({ id: `c-${issue.id}-${now.getTime()}`, type: 'activity' as NotifType, issue, seenAt: now })),
      ...prev,
    ]);
    changed.forEach(i => notify('💬 Nova atividade em tarefa que você acompanha', i));
  }, [activityIssues]);

  const dismiss = (id: string) => setNotifications(prev => prev.filter(n => n.id !== id));
  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
