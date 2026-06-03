import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../types/redmine';

export interface NewAssignment {
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

function showBrowserNotification(issue: Issue) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(`📋 Nova tarefa atribuída a você`, {
    body: `#${issue.id} — ${issue.subject}\n${issue.project.name}`,
    icon: '/favicon.ico',
    tag: `rk-issue-${issue.id}`,
  });
  n.onclick = () => { window.focus(); n.close(); };
}

export function useNewAssignments(issues: Issue[] | undefined) {
  const seenIds = useRef<Set<number> | null>(null);
  const [notifications, setNotifications] = useState<NewAssignment[]>([]);

  useEffect(() => { requestNotificationPermission(); }, []);

  useEffect(() => {
    if (!issues) return;

    const currentIds = new Set(issues.map(i => i.id));

    // Primeira carga — apenas registra, sem alertar
    if (seenIds.current === null) {
      seenIds.current = currentIds;
      return;
    }

    const newOnes = issues.filter(i => !seenIds.current!.has(i.id));
    seenIds.current = currentIds;

    if (newOnes.length === 0) return;

    const now = new Date();
    setNotifications(prev => [
      ...newOnes.map(issue => ({ issue, seenAt: now })),
      ...prev,
    ]);

    newOnes.forEach(showBrowserNotification);
  }, [issues]);

  const dismiss = (issueId: number) =>
    setNotifications(prev => prev.filter(n => n.issue.id !== issueId));

  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
