import type { SprintStatus } from '../../api/sprints';

export const STATUS_META: Record<SprintStatus, { label: string; cls: string }> = {
  planned: { label: 'Planejada', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  active:  { label: 'Ativa',     cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  closed:  { label: 'Concluída', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
};

export const STATUS_ORDER: SprintStatus[] = ['planned', 'active', 'closed'];
export const STATUS_RANK: Record<SprintStatus, number> = { active: 0, planned: 1, closed: 2 };

// Chave da raia "Sem projeto" e chave de persistência do estado recolhido.
export const NONE = '__none__';
export const COLLAPSE_KEY = 'bluemine.sprintLanesCollapsed';

export const PRIORITY_DOTS: Record<string, string> = {
  Baixa: 'bg-slate-400', Normal: 'bg-blue-500', Média: 'bg-blue-500',
  Alta: 'bg-orange-500', Urgente: 'bg-red-500', Imediata: 'bg-red-700',
};
