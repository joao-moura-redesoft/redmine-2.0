// Catálogo dos campos de condição (nós `filter` e `if`), compartilhado entre o
// painel de configuração e o card do nó no canvas — os dois precisam saber o
// mesmo: que campos existem, de que tipo são e como escrever uma regra por extenso.
//
// Cada campo tem um tipo, que define quais operadores e que controle de valor
// aparecem. Campos vão além da tarefa: evento, mensagem do Talk, saída de ações,
// e horário — úteis quando o gatilho não é de issue.
import type { TriggerContext } from './nodeCatalog';

export type Opt = { id: number | string; name: string };

export type FType = 'issueSelect' | 'text' | 'bool' | 'number' | 'weekday' | 'category' | 'aiLabel';

export interface FieldDef {
  id: string;
  name: string;
  type: FType;
  group: string;
}

export const G_EVENT = 'Evento';
export const G_OUTPUT = 'Saída de ações';

export const FILTER_FIELD_DEFS: FieldDef[] = [
  { id: 'project', name: 'Projeto', type: 'issueSelect', group: 'Tarefa' },
  { id: 'tracker', name: 'Tipo (tracker)', type: 'issueSelect', group: 'Tarefa' },
  { id: 'status', name: 'Status', type: 'issueSelect', group: 'Tarefa' },
  { id: 'priority', name: 'Prioridade', type: 'issueSelect', group: 'Tarefa' },
  { id: 'assignee', name: 'Responsável', type: 'issueSelect', group: 'Tarefa' },
  { id: 'subject', name: 'Título', type: 'text', group: 'Tarefa' },
  {
    id: 'issue.updated_days',
    name: 'Dias sem atualização',
    type: 'number',
    group: 'Prazo & idade',
  },
  {
    id: 'issue.created_days',
    name: 'Dias desde a criação',
    type: 'number',
    group: 'Prazo & idade',
  },
  {
    id: 'issue.due_days',
    name: 'Dias até o prazo (− = atrasada)',
    type: 'number',
    group: 'Prazo & idade',
  },
  // Dados da MUDANÇA que disparou o workflow (só no gatilho que a produz).
  { id: 'event.from_status', name: 'Status de origem', type: 'issueSelect', group: G_EVENT },
  { id: 'event.to_status', name: 'Status de destino', type: 'issueSelect', group: G_EVENT },
  { id: 'event.category', name: 'Categoria da tarefa', type: 'category', group: G_EVENT },
  { id: 'event.new_assignee', name: 'Novo responsável', type: 'issueSelect', group: G_EVENT },
  { id: 'message.text', name: 'Texto da mensagem', type: 'text', group: 'Mensagem (Talk)' },
  { id: 'message.actor', name: 'Autor da mensagem', type: 'text', group: 'Mensagem (Talk)' },
  { id: 'message.mention', name: 'É menção a mim', type: 'bool', group: 'Mensagem (Talk)' },
  { id: 'room.name', name: 'Nome da sala', type: 'text', group: 'Mensagem (Talk)' },
  { id: 'comment.text', name: 'Texto do comentário', type: 'text', group: 'Comentário' },
  { id: 'comment.author', name: 'Autor do comentário', type: 'text', group: 'Comentário' },
  { id: 'email.subject', name: 'Assunto do e-mail', type: 'text', group: 'E-mail' },
  { id: 'email.from', name: 'Remetente (endereço)', type: 'text', group: 'E-mail' },
  { id: 'email.snippet', name: 'Trecho do e-mail', type: 'text', group: 'E-mail' },
  // Saídas publicadas por nós ANTERIORES (ver ACTION_OUTPUTS).
  { id: 'ai.label', name: 'IA › Rótulo', type: 'aiLabel', group: G_OUTPUT },
  { id: 'ai.text', name: 'IA › Texto', type: 'text', group: G_OUTPUT },
  { id: 'ai.summary', name: 'IA › Resumo', type: 'text', group: G_OUTPUT },
  { id: 'webhook.status', name: 'Webhook › Status HTTP', type: 'number', group: G_OUTPUT },
  { id: 'created.id', name: 'Tarefa criada › Id', type: 'number', group: G_OUTPUT },
  { id: 'assigned.id', name: 'Atribuído a › Id', type: 'number', group: G_OUTPUT },
  { id: 'timer.hours', name: 'Cronômetro › Horas', type: 'number', group: G_OUTPUT },
  { id: 'totp.code', name: 'TOTP › Código', type: 'text', group: G_OUTPUT },
  { id: 'now.hour', name: 'Hora do dia (0–23)', type: 'number', group: 'Horário' },
  { id: 'now.weekday', name: 'Dia da semana', type: 'weekday', group: 'Horário' },
];

export const FIELD_GROUPS = [
  'Tarefa',
  'Prazo & idade',
  G_EVENT,
  'Mensagem (Talk)',
  'Comentário',
  'E-mail',
  G_OUTPUT,
  'Horário',
];

export const CATEGORY_OPTS: Opt[] = [
  { id: 'assigned', name: 'Atribuída a mim' },
  { id: 'review', name: 'Para revisão' },
  { id: 'monitored', name: 'Monitorada' },
];

export const WEEKDAYS: Opt[] = [
  { id: '1', name: 'Segunda' },
  { id: '2', name: 'Terça' },
  { id: '3', name: 'Quarta' },
  { id: '4', name: 'Quinta' },
  { id: '5', name: 'Sexta' },
  { id: '6', name: 'Sábado' },
  { id: '0', name: 'Domingo' },
];

export const BOOL_OPTS: Opt[] = [
  { id: 'true', name: 'Sim' },
  { id: 'false', name: 'Não' },
];

// Campos personalizados usam o id dinâmico "cf:<id>" (fora do catálogo estático);
// tratados como texto (contém/igual). defFor cobre só os campos fixos.
export const defFor = (id: string) => FILTER_FIELD_DEFS.find((f) => f.id === id);
export const typeForField = (id: string): FType =>
  id.startsWith('cf:') ? 'text' : (defFor(id)?.type ?? 'text');

// Um campo só está disponível se o contexto que o produz existe:
//  - campos de tarefa   ⇒ gatilho de tarefa
//  - campos de mensagem ⇒ gatilho de Talk
//  - campos de evento   ⇒ só o gatilho que produz AQUELA mudança
//  - saídas de ação     ⇒ um nó daquele tipo é ANCESTRAL deste (ver upstream)
//  - "Horário"          ⇒ ambiente, sempre disponível
export function fieldAvailable(
  fieldId: string,
  ctx: TriggerContext,
  outputs: Set<string>,
): boolean {
  if (fieldId.startsWith('cf:')) return ctx.issue;
  const d = defFor(fieldId);
  if (!d) return false;
  switch (d.group) {
    case 'Tarefa':
    case 'Prazo & idade':
      return ctx.issue;
    case G_EVENT:
      return ctx.eventFields.has(fieldId.replace('event.', ''));
    case 'Mensagem (Talk)':
      return ctx.talk;
    case 'Comentário':
      return ctx.comment;
    case 'E-mail':
      return ctx.email;
    case G_OUTPUT:
      return outputs.has(fieldId);
    case 'Horário':
      return true;
    default:
      return false;
  }
}

export const SELECT_OPERANDS: Opt[] = [
  { id: 'eq', name: 'é igual a' },
  { id: 'neq', name: 'é diferente de' },
  { id: 'in', name: 'está em (lista)' },
];
export const TEXT_OPERANDS: Opt[] = [
  { id: 'contains', name: 'contém' },
  { id: 'eq', name: 'é igual a' },
  { id: 'neq', name: 'é diferente de' },
];
export const NUMBER_OPERANDS: Opt[] = [
  { id: 'eq', name: 'é igual a' },
  { id: 'gt', name: 'maior que' },
  { id: 'gte', name: 'maior ou igual' },
  { id: 'lt', name: 'menor que' },
  { id: 'lte', name: 'menor ou igual' },
];

export function operandsForType(type: FType): Opt[] {
  switch (type) {
    case 'issueSelect':
    case 'weekday':
    case 'category':
    case 'aiLabel':
      return SELECT_OPERANDS;
    case 'number':
      return NUMBER_OPERANDS;
    case 'bool':
      return [{ id: 'eq', name: 'é' }];
    case 'text':
    default:
      return TEXT_OPERANDS;
  }
}

export interface Rule {
  field: string;
  operand: string;
  value: string;
}

export const labelForField = (id: string, customFields: Opt[]) =>
  defFor(id)?.name ?? customFields.find((c) => String(c.id) === id)?.name ?? id;

// ---------------------------------------------------------------------------
// Regra por extenso — usada no card do nó no canvas.
// ---------------------------------------------------------------------------

/** Listas do Redmine/Talk necessárias para traduzir ids em nomes. */
export interface FieldMeta {
  statuses: Opt[];
  priorities: Opt[];
  trackers: Opt[];
  projects: Opt[];
  members: Opt[];
  customFields: Opt[];
}

// Símbolos curtos: o card do nó é estreito, "é maior ou igual a" não cabe.
const OPERAND_SYMBOL: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contém',
  in: 'em',
};

/** Opções de valor de um campo, quando ele é uma escolha (não texto livre). */
export function optionsForField(field: string, meta: FieldMeta): Opt[] | undefined {
  switch (field) {
    case 'project':
      return meta.projects;
    case 'tracker':
      return meta.trackers;
    case 'status':
    case 'event.from_status':
    case 'event.to_status':
      return meta.statuses;
    case 'priority':
      return meta.priorities;
    case 'assignee':
    case 'event.new_assignee':
      return meta.members;
    case 'now.weekday':
      return WEEKDAYS;
    case 'event.category':
      return CATEGORY_OPTS;
    case 'message.mention':
      return BOOL_OPTS;
    default:
      return undefined;
  }
}

function valueLabel(field: string, value: string, meta: FieldMeta): string {
  if (value === 'me') return 'Eu';
  if (value === '' || value == null) return '?';
  const opts = optionsForField(field, meta);
  if (!opts) return String(value);
  return opts.find((o) => String(o.id) === String(value))?.name ?? String(value);
}

/** Ex.: `Status = Em andamento`, `Dias sem atualização > 3`. */
export function describeRule(rule: Rule, meta: FieldMeta): string {
  const field = labelForField(rule.field, meta.customFields);
  const op = OPERAND_SYMBOL[rule.operand] ?? rule.operand;
  return `${field} ${op} ${valueLabel(rule.field, rule.value, meta)}`;
}
