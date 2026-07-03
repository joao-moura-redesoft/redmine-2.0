import type { EditField } from '../types/redmine';

// Ao mudar de status, o Redmine 4.2 recusa com 422 listando os campos
// obrigatórios em branco (ex.: "DEV Nota de Versão não pode ficar em branco").
// Precisamos casar cada mensagem de erro com o EditField correspondente.
//
// Cuidado: um `label.includes` ingênuo gera falso positivo — o rótulo "Versão"
// (campo padrão fixed_version_id, que costuma já estar preenchido) é substring
// do erro de "DEV Nota de Versão". Por isso, para cada erro escolhemos apenas o
// campo cujo rótulo é o MAIS específico (mais longo) contido na mensagem.
export function matchMissingFields(errors: string[], editFields: EditField[]): EditField[] {
  const picked = new Set<string>();
  for (const err of errors) {
    const lower = err.toLowerCase();
    let best: EditField | null = null;
    for (const f of editFields) {
      if (f.name === 'status_id') continue;
      if (!lower.includes(f.label.toLowerCase())) continue;
      if (!best || f.label.length > best.label.length) best = f;
    }
    if (best) picked.add(best.id);
  }
  return editFields.filter((f) => picked.has(f.id));
}
