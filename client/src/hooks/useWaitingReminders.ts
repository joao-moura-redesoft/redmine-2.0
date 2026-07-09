import { useEffect, useRef } from 'react';
import { waitingStore, waitingLabel } from '../utils/waitingOn';
import { useBrowserNotifications } from './useBrowserNotifications';
import type { Issue } from '../types/redmine';

const STALL_MS = 7 * 24 * 60 * 60 * 1000; // nudge se aguardando há +7 dias
const NUDGE_COOLDOWN = 24 * 60 * 60 * 1000; // no máximo 1 nudge/dia por tarefa

/**
 * Vigia as tarefas marcadas como "aguardando resposta":
 *  - se a tarefa recebeu atividade (updated_on > desde) → avisa e tira a marca;
 *  - se está parada há muito tempo → um nudge (no máx. 1x/dia).
 * Roda com o app aberto (a marca é local). Mesmo mecanismo de notificação do
 * snooze/atividade.
 */
export function useWaitingReminders(issues?: Issue[]) {
  const { notify } = useBrowserNotifications();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const [k, entry] of Object.entries(waitingStore.getMap())) {
        const id = Number(k);
        const issue = issuesRef.current?.find((i) => i.id === id);
        const subj = issue?.subject;
        if (issue && new Date(issue.updated_on).getTime() > entry.since) {
          notifyRef.current('🔔 Resposta na tarefa', {
            body: subj ? `#${id} — ${subj}` : `A tarefa #${id} teve atividade nova.`,
            tag: `waiting-hit-${id}`,
          });
          waitingStore.clear(id);
        } else if (
          now - entry.since > STALL_MS &&
          (!entry.nudgedAt || now - entry.nudgedAt > NUDGE_COOLDOWN)
        ) {
          notifyRef.current('⏳ Ainda aguardando', {
            body: `#${id}${subj ? ` — ${subj}` : ''} · parado ${waitingLabel(entry.since)}`,
            tag: `waiting-nudge-${id}`,
          });
          waitingStore.markNudged(id);
        }
      }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);
}
