import type { Issue } from '../types/redmine';

export const CF_IDS = {
  BRANCH: 140,
  IMPACTO: 229,
  NOTA_VERSAO: 213,
  PREVISAO_REVISAO: 228,
  REVISOR: 210,
} as const;

const CF_LABELS: Record<number, string> = {
  [CF_IDS.BRANCH]: 'Branch',
  [CF_IDS.IMPACTO]: 'Impacto',
  [CF_IDS.NOTA_VERSAO]: 'Nota de Versão',
  [CF_IDS.PREVISAO_REVISAO]: 'Previsão Revisão',
  [CF_IDS.REVISOR]: 'Revisor',
};

// Status ID → campos customizados obrigatórios
const FIELD_RULES: Record<number, number[]> = {
  8: [CF_IDS.BRANCH], // Em andamento
  34: [CF_IDS.BRANCH], // Pendente Correção
  71: [CF_IDS.BRANCH, CF_IDS.REVISOR, CF_IDS.PREVISAO_REVISAO], // Pendente Revisão
  44: [CF_IDS.IMPACTO, CF_IDS.NOTA_VERSAO], // Pendente Teste
  35: [CF_IDS.IMPACTO, CF_IDS.NOTA_VERSAO], // Pendente Integração
  36: [CF_IDS.IMPACTO, CF_IDS.NOTA_VERSAO], // Pendente Atualização
  29: [CF_IDS.IMPACTO, CF_IDS.NOTA_VERSAO], // Pendente Fechamento
};

// Status IDs onde Tempo Estimado é obrigatório (Pendente Desenvolvimento em diante)
const ESTIMATED_HOURS_REQUIRED = new Set([32, 8, 34, 71, 44, 35, 36, 29]);

function cfValue(issue: Issue, cfId: number): string {
  const v = issue.custom_fields?.find((cf) => cf.id === cfId)?.value;
  if (!v) return '';
  if (Array.isArray(v)) return v.join('');
  return v;
}

function isClosed(issue: Issue): boolean {
  const n = issue.status.name.toLowerCase();
  return n.includes('fechad') || n.includes('cancelad');
}

export function getMissingFields(issue: Issue): string[] {
  if (isClosed(issue)) return [];

  const missing: string[] = [];

  const rules = FIELD_RULES[issue.status.id] ?? [];
  rules.forEach((cfId) => {
    if (cfValue(issue, cfId) === '') missing.push(CF_LABELS[cfId]);
  });

  if (ESTIMATED_HOURS_REQUIRED.has(issue.status.id) && !issue.estimated_hours) {
    missing.push('Tempo Estimado');
  }

  return missing;
}

export type ReviewAlert = 'today' | 'overdue' | null;

export function getReviewAlert(issue: Issue): ReviewAlert {
  if (isClosed(issue) || issue.done_ratio === 100) return null;
  const val = cfValue(issue, CF_IDS.PREVISAO_REVISAO);
  if (!val) return null;
  const today = new Date().toISOString().split('T')[0];
  if (val === today) return 'today';
  if (val < today) return 'overdue';
  return null;
}

export function getBranch(issue: Issue): string {
  return cfValue(issue, CF_IDS.BRANCH);
}

export function getPrevisaoRevisao(issue: Issue): string {
  return cfValue(issue, CF_IDS.PREVISAO_REVISAO);
}
