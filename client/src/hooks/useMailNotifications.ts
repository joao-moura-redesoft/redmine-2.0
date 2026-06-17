import { useEffect, useRef, useState } from 'react';
import { useBrowserNotifications } from './useBrowserNotifications';
import type { AppNotification } from './useActivityNotifications';

export function useMailNotifications(unreadData: { unread: number } | undefined) {
  const { notify } = useBrowserNotifications();
  const prevUnread = useRef<number | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (unreadData === undefined) return;
    const count = unreadData.unread;

    if (prevUnread.current === null) {
      prevUnread.current = count;
      return;
    }

    const prev = prevUnread.current;
    prevUnread.current = count;
    if (count <= prev) return;

    const delta = count - prev;
    const msg = `${delta} nova${delta !== 1 ? 's mensagens' : ' mensagem'} na Caixa de Entrada`;
    const now = new Date();

    setNotifications(p => [{
      id: `mail-${now.getTime()}`,
      type: 'mail' as const,
      tab: 'mail',
      seenAt: now,
      snippet: msg,
    }, ...p]);

    notify('✉️ Novo e-mail', { body: msg, tag: 'rk-mail-unread' });
  }, [unreadData, notify]);

  const dismiss = (id: string) => setNotifications(p => p.filter(n => n.id !== id));
  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
