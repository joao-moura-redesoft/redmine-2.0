/**
 * Parser heurístico pra captura rápida em linguagem natural (funciona sem IA).
 * Ex.: "sex revisar deploy #123 prioridade alta" →
 *   { title: "revisar deploy #123", dueDate: "2026-07-10", priorityName: "Alta", issueRefs: [123] }
 */
export interface Parsed {
  title: string;
  dueDate?: string;
  priorityName?: string;
  issueRefs: number[];
}

const WD: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  dom: 0,
  seg: 1,
  ter: 2,
  qua: 3,
  qui: 4,
  sex: 5,
  sab: 6,
};

const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const deaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function nextWeekday(target: number): Date {
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7 || 7; // sempre a PRÓXIMA
  d.setDate(d.getDate() + diff);
  return d;
}

export function quickParse(input: string): Parsed {
  const raw = input.trim();
  const issueRefs = [...raw.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

  const lower = deaccent(raw.toLowerCase());

  let priorityName: string | undefined;
  const pm = lower.match(/\b(imediata|urgente|alta|normal|baixa)\b/);
  if (pm) priorityName = pm[1].charAt(0).toUpperCase() + pm[1].slice(1);

  const now = new Date();
  let dueDate: string | undefined;
  const dm = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (/\bhoje\b/.test(lower)) dueDate = ymd(now);
  else if (/\bamanha\b/.test(lower)) dueDate = ymd(new Date(now.getTime() + 864e5));
  else if (dm) dueDate = ymd(new Date(now.getFullYear(), Number(dm[2]) - 1, Number(dm[1])));
  else {
    const wm = lower.match(
      /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom)\b/,
    );
    if (wm && WD[wm[1]] != null) dueDate = ymd(nextWeekday(WD[wm[1]]));
  }

  // Título: remove os tokens reconhecidos (priоridade/data), mantém os #refs.
  let title = raw
    .replace(/\bprioridade\b/gi, '')
    .replace(/\b(imediata|urgente|alta|normal|baixa)\b/gi, '')
    .replace(/\b(hoje|amanh[ãa])\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, '')
    .replace(
      /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|seg|ter|qua|qui|sex|s[áa]b|dom)\b/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!title) title = raw;

  return { title, dueDate, priorityName, issueRefs };
}
