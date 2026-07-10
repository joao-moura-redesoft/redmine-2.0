import type { CalendarEvent } from '../api/mail';

/**
 * Séries recorrentes no calendário.
 *
 * Uma daily com 22 ocorrências no mês não pode ocupar 22 chips: a agenda vira
 * ruído e as tarefas somem atrás dela. Uma SÉRIE ocupa espaço de série — um
 * filete de 3px no topo da célula, nomeado uma única vez na legenda.
 */

/**
 * "Densa" = mais de uma ocorrência a cada 3 dias da janela visível.
 *
 * O limiar é calibrado para que o SEMANAL sobreviva como chip nos dias (você quer
 * ver seu 1:1 de sexta no dia certo) e só o diário colapse. Num mês de ~35 dias,
 * exige mais de 11 ocorrências.
 *
 * Só faz sentido na visão de mês: a de semana nunca colapsa (ver CalendarView).
 */
export function isDenseSeries(ev: CalendarEvent, windowDays: number): boolean {
  return ev.recurring && ev.occurrencesInWindow * 3 > windowDays;
}

export interface Series {
  uid: string;
  sample: CalendarEvent; // uma ocorrência qualquer: assunto, horário, ptst, invId…
  days: Set<string>; // 'yyyy-MM-dd' em que ocorre, na janela visível
}
