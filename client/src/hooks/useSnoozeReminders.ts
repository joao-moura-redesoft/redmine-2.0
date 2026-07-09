import { useEffect, useRef } from 'react';
import { snoozeStore } from '../utils/snooze';
import { useBrowserNotifications } from './useBrowserNotifications';
import type { Issue } from '../types/redmine';

/**
 * Verifica periodicamente os snoozes vencidos: dispara um lembrete (notificação
 * do navegador) e "desadia" a tarefa — que volta a aparecer no Inbox. Roda no App
 * (independente da aba aberta). O lembrete só aparece com o app aberto; adiar com
 * o app fechado voltaria a exigir push server-side (fora do escopo desta v1).
 */
export function useSnoozeReminders(issues?: Issue[]) {
  const { notify } = useBrowserNotifications();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const [k, until] of Object.entries(snoozeStore.getMap())) {
        if (until > now) continue;
        const id = Number(k);
        const subj = issuesRef.current?.find((i) => i.id === id)?.subject;
        notifyRef.current('⏰ Lembrete do Bluemine', {
          body: subj ? `#${id} — ${subj}` : `A tarefa #${id} voltou pra sua fila.`,
          tag: `snooze-${id}`,
        });
        snoozeStore.unsnooze(id);
      }
    };
    check(); // ao montar
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, []);
}
