/**
 * Busca fuzzy leve, sem dependências: ignora acentos/caixa e casa por
 * subsequência (tolera caracteres faltando e ordem parcial), com pontuação
 * por proximidade. Retorna score >= 0 quando casa, ou -1 quando não casa.
 */
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

export function fuzzyScore(text: string, query: string): number {
  const q = normalizeText(query.trim());
  if (!q) return 0;
  const t = normalizeText(text);

  // Match direto de substring é o melhor (quanto mais ao início, melhor)
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx;

  // Subsequência: cada caractere da query precisa aparecer em ordem
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const c of q) {
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === c) { found = j; break; }
    }
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 2 - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}

/** Melhor score entre vários campos (ex.: título, corpo, tags). */
export function fuzzyBest(query: string, ...fields: string[]): number {
  let best = -1;
  for (const f of fields) {
    const s = fuzzyScore(f, query);
    if (s > best) best = s;
  }
  return best;
}
