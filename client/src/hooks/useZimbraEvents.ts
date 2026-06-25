import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mailApi, type InviteVerb } from '../api/mail';
import { isMailAvailable } from '../utils/mailConfig';

/**
 * Compromissos do calendário Zimbra numa janela [start, end] (epoch ms).
 * Só ativa quando há credenciais de e-mail (reaproveita o login do Redmine).
 */
export function useZimbraEvents(start: number, end: number) {
  return useQuery({
    queryKey: ['zimbra-calendar', start, end],
    queryFn: () => mailApi.getCalendar(start, end),
    enabled: isMailAvailable() && Number.isFinite(start) && Number.isFinite(end),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Participantes de um compromisso e a resposta de cada um. Busca sob demanda
 * (só quando `enabled`, ex.: ao abrir o evento) — não pesa o load da agenda.
 */
export function useEventAttendees(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['zimbra-attendees', id],
    queryFn: () => mailApi.getEventAttendees(id!),
    enabled: enabled && isMailAvailable() && !!id,
    staleTime: 2 * 60 * 1000,
  });
}

/** Responde a um convite (aceitar/recusar/talvez) e revalida a agenda. */
export function useReplyToInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verb, compNum }: { id: string; verb: InviteVerb; compNum?: number }) =>
      mailApi.replyToInvite(id, verb, compNum),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zimbra-calendar'] });
      qc.invalidateQueries({ queryKey: ['zimbra-attendees'] });
    },
  });
}
