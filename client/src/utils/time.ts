// Datas e horas do apontamento. Tudo aqui trabalha no fuso local: o Redmine
// grava `spent_on` como um dia de calendário, sem hora nem timezone.

/** `YYYY-MM-DD` no fuso local. Não use toISOString(): ele converte para UTC e
 *  desloca o dia em qualquer fuso a leste de Greenwich. */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Soma dias pelo calendário (não por milissegundos, que erra em mudança de horário de verão). */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Segunda-feira da semana de `d`, à meia-noite local. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 = domingo
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1));
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Um `spent_on` (`YYYY-MM-DD`) como Date local ao meio-dia — imune a offset de fuso. */
export function parseSpentOn(spentOn: string): Date {
  const [y, m, d] = spentOn.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** Horas para leitura humana: `0h`, `15min`, `1.5h`, `8h`. */
export function fmtHours(h: number): string {
  if (!h) return '0h';
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${h % 1 === 0 ? h : Number(h.toFixed(2))}h`;
}
