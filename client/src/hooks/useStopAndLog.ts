import { useCallback } from 'react';
import { useTimeEntryActivities, useCreateTimeEntry } from './useRedmine';

export interface LogResult {
  /** Whether the hours were actually posted to Redmine. */
  logged: boolean;
  /** Elapsed hours that were measured (may be > 0 even when not logged). */
  hours: number;
  /** Id of the created time entry, when logged — useful for an undo. */
  entryId?: number;
}

// Tempo abaixo deste limiar (~1 min) é considerado irrisório e não é apontado.
const MIN_HOURS = 0.02;

/**
 * Auto-apontamento de horas reutilizável.
 *
 * Centraliza a lógica que vivia só no TimeTracker (`handleStopAndLog`): ao parar
 * um timer, lançar as horas medidas no Redmine usando a atividade padrão. Como
 * o `useTimer` é multi-instância (cada componente tem o seu, sincronizados via
 * localStorage), este hook NÃO para o timer — quem chama passa as horas já
 * obtidas de `timer.stop()`. Assim qualquer ponto (TimeTracker, Meu Dia, widget
 * global) aponta de forma consistente, sem perder o tempo medido.
 *
 * Devolve `logged: false` quando o tempo é irrisório, não há atividade carregada
 * ou o POST falha — cabe a quem chama decidir o fallback (abrir form manual,
 * avisar, etc.) para que o tempo nunca se perca silenciosamente.
 */
export function useStopAndLog() {
  const { data: activities } = useTimeEntryActivities();
  const createEntry = useCreateTimeEntry();
  const defaultActivity = activities?.find((a) => a.is_default) ?? activities?.[0];

  const logHours = useCallback(
    async (
      issueId: number,
      hours: number,
      opts?: { activityId?: number; comments?: string },
    ): Promise<LogResult> => {
      const activityId = opts?.activityId ?? defaultActivity?.id;
      if (!hours || hours < MIN_HOURS || !activityId) {
        return { logged: false, hours };
      }
      try {
        const entry = await createEntry.mutateAsync({
          issue_id: issueId,
          hours,
          activity_id: activityId,
          comments: opts?.comments,
          spent_on: new Date().toISOString().split('T')[0],
        });
        return { logged: true, hours, entryId: entry?.id };
      } catch {
        return { logged: false, hours };
      }
    },
    [defaultActivity, createEntry],
  );

  return { logHours, isLogging: createEntry.isPending, defaultActivity };
}
