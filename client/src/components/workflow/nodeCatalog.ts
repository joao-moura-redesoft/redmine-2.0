// Catálogo dos tipos de nó disponíveis no editor de automações. Cada descritor
// define metadados de UI (rótulo, ícone, cor) e o `config` padrão criado ao
// arrastar o nó para o canvas. O motor server-side (Fase 2) interpreta o mesmo
// `type`/`config`. Mantenha os dois lados em sincronia.
import {
  Bell,
  Filter,
  Send,
  MessageSquare,
  Clock,
  UserPlus,
  PlusCircle,
  RefreshCw,
  MonitorSmartphone,
  MessageCircle,
  Pencil,
  Webhook,
  Mail,
  GitBranch,
  Sparkles,
  ListChecks,
  Tags,
  FilePlus2,
  Timer,
  MessageSquareText,
  Hourglass,
  Briefcase,
  Volume2,
  CircleDot,
  MousePointerClick,
  Gauge,
  Shuffle,
  Link,
  TimerReset,
  Power,
  Inbox,
  Braces,
  ScrollText,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import type { NodeKind, WorkflowNode } from '../../api/workflows';

export interface NodeDescriptor {
  kind: NodeKind;
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Classes tailwind de destaque (borda/acento) por família de nó. */
  accent: string;
  defaultConfig: () => Record<string, unknown>;
}

// Cores por família (trigger = âmbar, filter/branch = violeta, action = azul).
const TRIGGER_ACCENT = 'border-amber-400 dark:border-amber-500';
const FILTER_ACCENT = 'border-violet-400 dark:border-violet-500';
const ACTION_ACCENT = 'border-sky-400 dark:border-sky-500';

export const TRIGGERS: NodeDescriptor[] = [
  {
    kind: 'trigger',
    type: 'issue.created',
    label: 'Tarefa criada / recebida',
    description: 'Dispara quando uma tarefa nova aparece (atribuída, revisão ou monitorada).',
    icon: PlusCircle,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ category: '' }),
  },
  {
    kind: 'trigger',
    type: 'issue.status_changed',
    label: 'Status mudou',
    description: 'Dispara quando o status de uma tarefa muda (opcionalmente de/para um status).',
    icon: RefreshCw,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ from: '', to: '' }),
  },
  {
    kind: 'trigger',
    type: 'issue.assigned_changed',
    label: 'Responsável mudou',
    description: 'Dispara quando o responsável de uma tarefa muda.',
    icon: UserPlus,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ toMe: false }),
  },
  {
    kind: 'trigger',
    type: 'issue.commented',
    label: 'Comentário na tarefa',
    description: 'Dispara quando alguém adiciona um comentário numa tarefa sua.',
    icon: MessageSquareText,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ fromOthers: true }),
  },
  {
    kind: 'trigger',
    type: 'talk.message',
    label: 'Mensagem no Talk',
    description: 'Dispara quando chega mensagem numa sala do Talk (ou só menções).',
    icon: MessageSquare,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ roomToken: '', mentionsOnly: false }),
  },
  {
    kind: 'trigger',
    type: 'schedule',
    label: 'Agendamento',
    description: 'Dispara num horário diário ou a cada N minutos.',
    icon: Clock,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ mode: 'daily', hour: 8, minute: 0, everyMinutes: 60 }),
  },
  {
    kind: 'trigger',
    type: 'issue.scan',
    label: 'Varredura de tarefas (agendada)',
    description:
      'No horário definido, percorre suas tarefas e roda o grafo por tarefa — ideal para condições de idade/prazo (ex.: paradas há N dias).',
    icon: ListChecks,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({
      mode: 'daily',
      hour: 8,
      minute: 0,
      everyMinutes: 60,
      scope: 'assigned',
      maxIssues: 20,
    }),
  },
  {
    kind: 'trigger',
    type: 'time.budget_exceeded',
    label: 'Orçamento de horas estourado',
    description:
      'Na varredura agendada, dispara para tarefas cujas horas apontadas passaram das estimadas.',
    icon: Gauge,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({
      mode: 'daily',
      hour: 8,
      minute: 0,
      everyMinutes: 60,
      scope: 'assigned',
      maxIssues: 20,
      repeat: 'once',
    }),
  },
  {
    kind: 'trigger',
    type: 'workflow.manual',
    label: 'Manual (sob demanda)',
    description: 'Não dispara sozinho — você executa por um botão (ex.: no card da tarefa).',
    icon: MousePointerClick,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({}),
  },
  {
    kind: 'trigger',
    type: 'app.startup',
    label: 'Ao iniciar o app',
    description: 'Dispara uma vez quando o backend do Bluemine inicia (e a cada reinício).',
    icon: Power,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({}),
  },
  {
    kind: 'trigger',
    type: 'email.received',
    label: 'E-mail recebido',
    description: 'Dispara quando chega um e-mail não lido (via Zimbra), opcionalmente filtrado.',
    icon: Inbox,
    accent: TRIGGER_ACCENT,
    defaultConfig: () => ({ fromContains: '', subjectContains: '' }),
  },
];

export const FILTERS: NodeDescriptor[] = [
  {
    kind: 'filter',
    type: 'filter',
    label: 'Condição',
    description: 'Segue o ramo apenas se as regras baterem (AND/OR).',
    icon: Filter,
    accent: FILTER_ACCENT,
    defaultConfig: () => ({ op: 'and', rules: [] }),
  },
  {
    kind: 'branch',
    type: 'if',
    label: 'Se / senão',
    description: 'Ramifica: saída "verdadeiro" se as regras baterem, senão "falso".',
    icon: GitBranch,
    accent: FILTER_ACCENT,
    defaultConfig: () => ({ op: 'and', rules: [] }),
  },
  {
    kind: 'branch',
    type: 'filter.is_business_hours',
    label: 'Horário comercial?',
    description: 'Ramifica: saída "verdadeiro" dentro do horário comercial, senão "falso".',
    icon: Briefcase,
    accent: FILTER_ACCENT,
    defaultConfig: () => ({ startHour: 8, endHour: 18, days: [1, 2, 3, 4, 5] }),
  },
];

export const ACTIONS: NodeDescriptor[] = [
  {
    kind: 'action',
    type: 'wait',
    label: 'Esperar',
    description: 'Pausa o ramo por um tempo e retoma depois (reavaliando a tarefa).',
    icon: Hourglass,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ amount: 1, unit: 'hours' }),
  },
  {
    kind: 'action',
    type: 'notify',
    label: 'Notificar (push)',
    description: 'Envia uma notificação Web Push para você.',
    icon: Bell,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ title: '', body: '' }),
  },
  {
    kind: 'action',
    type: 'k86.screen',
    label: 'Telinha do teclado (K86)',
    description: 'Mostra um aviso na telinha do teclado Attack Shark K86.',
    icon: MonitorSmartphone,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ title: '', subtitle: '' }),
  },
  {
    kind: 'action',
    type: 'talk.send',
    label: 'Enviar no Talk',
    description: 'Envia uma mensagem numa sala do Talk.',
    icon: Send,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ roomToken: '', message: '' }),
  },
  {
    kind: 'action',
    type: 'talk.change_status',
    label: 'Mudar status no Talk',
    description: 'Altera seu status no Nextcloud Talk (ex.: Em foco, Ausente).',
    icon: CircleDot,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ statusType: 'dnd', message: '' }),
  },
  {
    kind: 'action',
    type: 'sound.play',
    label: 'Tocar som',
    description: 'Emite um aviso sonoro nos alto-falantes desta máquina.',
    icon: Volume2,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ sound: 'alert' }),
  },
  {
    kind: 'action',
    type: 'issue.assign_next',
    label: 'Atribuir ao próximo (rodízio)',
    description: 'Distribui a tarefa por round-robin entre as pessoas da lista.',
    icon: Shuffle,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ users: [] }),
  },
  {
    kind: 'action',
    type: 'issue.link_issues',
    label: 'Vincular tarefas',
    description: 'Cria uma relação no Redmine (bloqueia, relaciona, duplica…) com outra tarefa.',
    icon: Link,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ relationType: 'relates', targetIssueId: '' }),
  },
  {
    kind: 'action',
    type: 'time.log_timer',
    label: 'Cronômetro de horas',
    description:
      'Na 1ª execução marca o início; na 2ª calcula o tempo decorrido e aponta as horas.',
    icon: TimerReset,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ activity_id: '', comments: '' }),
  },
  {
    kind: 'action',
    type: 'ai.extract_data',
    label: 'Extrair dados (IA → JSON)',
    description:
      'A IA extrai campos estruturados em JSON. Disponíveis como {{ai.data.campo}} nos nós seguintes.',
    icon: Braces,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ prompt: '', fields: [] }),
  },
  {
    kind: 'action',
    type: 'ai.summarize',
    label: 'Resumir com IA',
    description: 'Resume comentários da tarefa (ou um texto) e disponibiliza como {{ai.summary}}.',
    icon: ScrollText,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ source: 'comments', text: '' }),
  },
  {
    kind: 'action',
    type: 'totp.fetch',
    label: 'Buscar código TOTP',
    description: 'Gera o código TOTP atual de uma conta do cofre; fica em {{totp.code}}.',
    icon: KeyRound,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ service: '' }),
  },
  {
    kind: 'action',
    type: 'issue.update',
    label: 'Atualizar tarefa',
    description: 'Altera status/responsável/prioridade/prazo da tarefa do evento.',
    icon: Pencil,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ status_id: '', assigned_to_id: '', priority_id: '', due_date: '' }),
  },
  {
    kind: 'action',
    type: 'issue.comment',
    label: 'Comentar na tarefa',
    description: 'Adiciona um comentário na tarefa do evento.',
    icon: MessageCircle,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ body: '' }),
  },
  {
    kind: 'action',
    type: 'webhook',
    label: 'Webhook (HTTP)',
    description: 'Faz uma requisição HTTP para uma URL externa.',
    icon: Webhook,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ url: '', method: 'POST', body: '' }),
  },
  {
    kind: 'action',
    type: 'email.send',
    label: 'Enviar e-mail',
    description: 'Envia um e-mail (via Zimbra) para um destinatário.',
    icon: Mail,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ to: '', subject: '', text: '' }),
  },
  {
    kind: 'action',
    type: 'ai.generate',
    label: 'Gerar com IA',
    description:
      'Gera texto com IA; o resultado fica disponível como {{ai.text}} nos nós seguintes.',
    icon: Sparkles,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ prompt: '' }),
  },
  {
    kind: 'action',
    type: 'ai.classify',
    label: 'Classificar com IA',
    description:
      'A IA escolhe UM rótulo da sua lista. O resultado vira {{ai.label}} — feito para o Se/senão.',
    icon: Tags,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({ prompt: '', labels: ['urgente', 'normal'] }),
  },
  {
    kind: 'action',
    type: 'issue.create',
    label: 'Criar tarefa',
    description: 'Cria uma tarefa no Redmine. O id fica disponível como {{created.id}}.',
    icon: FilePlus2,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({
      project_id: '',
      tracker_id: '',
      subject: '',
      description: '',
      assigned_to_id: '',
      priority_id: '',
      due_date: '',
      parent: 'none',
    }),
  },
  {
    kind: 'action',
    type: 'time.log',
    label: 'Apontar horas',
    description: 'Lança horas numa tarefa (a do evento ou uma fixa).',
    icon: Timer,
    accent: ACTION_ACCENT,
    defaultConfig: () => ({
      issue: 'event',
      issue_id: '',
      hours: '',
      activity_id: '',
      comments: '',
      spent_on: '',
    }),
  },
];

export const ALL_DESCRIPTORS: NodeDescriptor[] = [...TRIGGERS, ...FILTERS, ...ACTIONS];

const BY_TYPE = new Map(ALL_DESCRIPTORS.map((d) => [d.type, d]));

export function descriptorFor(type: string): NodeDescriptor | undefined {
  return BY_TYPE.get(type);
}

// Cria um nó novo (id, posição, config padrão) a partir de um descritor.
export function makeNode(d: NodeDescriptor, position: { x: number; y: number }): WorkflowNode {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: d.kind,
    type: d.type,
    config: d.defaultConfig(),
    position,
    nextIds: [],
  };
}

// Resumo curto do gatilho para a lista de automações.
export function triggerSummary(nodes: WorkflowNode[]): string {
  const trigger = nodes.find((n) => n.kind === 'trigger');
  if (!trigger) return 'Sem gatilho';
  return descriptorFor(trigger.type)?.label ?? trigger.type;
}

// ---------------------------------------------------------------------------
// Contexto produzido por cada gatilho (o "output schema" do gatilho, como no
// Twenty). Só os dados que o gatilho realmente produz ficam disponíveis para as
// condições e variáveis {{ }} — um gatilho de tarefa não expõe `message`, e um
// gatilho de Talk não expõe `issue`.
// ---------------------------------------------------------------------------
export interface TriggerContext {
  issue: boolean;
  talk: boolean; // message + room
  comment: boolean; // comment.* (gatilho issue.commented)
  email: boolean; // email.* (gatilho email.received)
  /** Campos de `event.*` que ESTE gatilho produz (from_status, category, …). */
  eventFields: Set<string>;
}

export function triggerContext(type: string | undefined): TriggerContext {
  const base = (
    issue: boolean,
    talk: boolean,
    comment: boolean,
    eventFields: string[] = [],
    email = false,
  ) => ({
    issue,
    talk,
    comment,
    email,
    eventFields: new Set(eventFields),
  });
  switch (type) {
    case 'issue.status_changed':
      return base(true, false, false, ['from_status', 'to_status']);
    case 'issue.created':
      return base(true, false, false, ['category']);
    case 'issue.assigned_changed':
      return base(true, false, false, ['new_assignee']);
    case 'issue.commented':
      return base(true, false, true);
    case 'issue.scan':
    case 'time.budget_exceeded':
      return base(true, false, false); // varredura não tem "mudança", só a tarefa
    case 'workflow.manual':
      // Otimista: normalmente lançado a partir de um card, então oferece a tarefa.
      // Sem tarefa no disparo, regras/ações de issue falham graciosamente.
      return base(true, false, false);
    case 'talk.message':
      return base(false, true, false);
    case 'email.received':
      return base(false, false, false, [], true);
    default: // schedule, app.startup, ou sem gatilho
      return base(false, false, false);
  }
}

// Saídas que cada tipo de ação publica no contexto (namespaces nomeados).
// Usado para saber quais campos `ai.*` / `webhook.*` / `created.*` estão
// disponíveis num nó, olhando só os ANCESTRAIS dele.
// Ações que ESCREVEM em algum lugar (Redmine, Talk, e-mail, terceiros). São as
// que tornam uma varredura de escopo amplo perigosa: agem em muitas tarefas de
// uma vez e não têm desfazer.
export const WRITE_ACTIONS = new Set([
  'issue.update',
  'issue.comment',
  'issue.create',
  'issue.assign_next',
  'issue.link_issues',
  'time.log',
  'time.log_timer',
  'talk.send',
  'email.send',
  'webhook',
]);

export const hasWriteAction = (nodes: WorkflowNode[]) =>
  nodes.some((n) => n.kind === 'action' && WRITE_ACTIONS.has(n.type));

export const ACTION_OUTPUTS: Record<string, string[]> = {
  'ai.generate': ['ai.text'],
  'ai.classify': ['ai.text', 'ai.label'],
  webhook: ['webhook.status'],
  'issue.create': ['created.id'],
  'issue.assign_next': ['assigned.id'],
  'time.log_timer': ['timer.hours'],
  'ai.extract_data': ['ai.data'],
  'ai.summarize': ['ai.summary'],
  'totp.fetch': ['totp.code'],
};

// ---------------------------------------------------------------------------
// Resumo e validação de um nó — alimentam o card no canvas.
// ---------------------------------------------------------------------------
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const pad = (n: unknown) => String(Number(n) || 0).padStart(2, '0');

/** Linha curta abaixo do título do nó, resumindo a config. '' se não houver. */
export function summarize(node: WorkflowNode): string {
  const c = (node.config || {}) as Record<string, unknown>;
  const s = (k: string) => (c[k] == null || c[k] === '' ? '' : String(c[k]));

  switch (node.type) {
    case 'schedule':
    case 'issue.scan':
    case 'time.budget_exceeded': {
      const when =
        (s('mode') || 'daily') === 'interval'
          ? `a cada ${s('everyMinutes') || '60'} min`
          : `diariamente às ${pad(c.hour)}:${pad(c.minute)}`;
      if (node.type === 'schedule') return when;
      const scope =
        { assigned: 'atribuídas', review: 'para revisão', monitored: 'monitoradas', all: 'todas' }[
          s('scope') || 'assigned'
        ] ?? '';
      const suffix = node.type === 'time.budget_exceeded' ? ' · acima do orçamento' : '';
      return `${when} · ${scope}${suffix}`;
    }
    case 'issue.created':
      return s('category') ? `categoria: ${s('category')}` : 'qualquer nova tarefa';
    case 'issue.status_changed': {
      const from = s('from') ? `de #${s('from')}` : '';
      const to = s('to') ? `para #${s('to')}` : 'qualquer status';
      return [from, to].filter(Boolean).join(' ');
    }
    case 'issue.assigned_changed':
      return c.toMe ? 'quando for para mim' : 'qualquer responsável';
    case 'issue.commented':
      return c.fromOthers ? 'de outras pessoas' : 'qualquer comentário';
    case 'talk.message':
      return c.mentionsOnly
        ? 'somente menções'
        : s('roomToken')
          ? 'sala escolhida'
          : 'qualquer sala';
    case 'workflow.manual':
      return 'sob demanda (botão)';
    case 'app.startup':
      return 'ao iniciar o app';
    case 'email.received': {
      const parts = [];
      if (s('fromContains')) parts.push(`de "${s('fromContains')}"`);
      if (s('subjectContains')) parts.push(`assunto "${s('subjectContains')}"`);
      return parts.length ? parts.join(' · ') : 'qualquer e-mail não lido';
    }

    case 'filter':
    case 'if': {
      const n = Array.isArray(c.rules) ? c.rules.length : 0;
      if (n === 0) return 'sem regras (sempre passa)';
      return `${n} ${n === 1 ? 'regra' : 'regras'} (${(s('op') || 'and') === 'or' ? 'OU' : 'E'})`;
    }
    case 'filter.is_business_hours':
      return `dentro de ${s('startHour') || '8'}h–${s('endHour') || '18'}h`;

    case 'notify':
    case 'k86.screen':
      return s('title');
    case 'sound.play':
      return (
        { alert: 'Alerta', success: 'Sucesso', error: 'Erro' }[s('sound') || 'alert'] ?? s('sound')
      );
    case 'talk.change_status':
      return (
        {
          online: 'Disponível',
          away: 'Ausente',
          dnd: 'Em foco',
          invisible: 'Invisível',
        }[s('statusType') || 'dnd'] ?? ''
      );
    case 'talk.send':
      return s('roomToken') ? 'envia na sala escolhida' : '';
    case 'issue.comment':
      return s('body').slice(0, 40);
    case 'issue.update': {
      const parts = [];
      if (s('status_id')) parts.push('status');
      if (s('assigned_to_id')) parts.push('responsável');
      if (s('priority_id')) parts.push('prioridade');
      if (s('due_date')) parts.push('prazo');
      return parts.length ? `altera ${parts.join(', ')}` : '';
    }
    case 'webhook':
      return s('url') ? `${s('method') || 'POST'} ${s('url').slice(0, 28)}` : '';
    case 'email.send':
      return s('to');
    case 'ai.generate':
      return s('prompt').slice(0, 40);
    case 'ai.classify': {
      const labels = Array.isArray(c.labels) ? (c.labels as string[]) : [];
      return labels.length ? labels.join(' · ') : '';
    }
    case 'issue.create':
      return s('subject').slice(0, 40);
    case 'issue.assign_next': {
      const n = Array.isArray(c.users) ? c.users.length : 0;
      return n ? `rodízio entre ${n} ${n === 1 ? 'pessoa' : 'pessoas'}` : 'sem pessoas';
    }
    case 'issue.link_issues': {
      const rel =
        {
          relates: 'relaciona',
          blocks: 'bloqueia',
          blocked: 'bloqueada por',
          precedes: 'precede',
          follows: 'sucede',
          duplicates: 'duplica',
          duplicated: 'duplicada por',
          copied_to: 'copiada para',
          copied_from: 'copiada de',
        }[s('relationType') || 'relates'] ?? '';
      return s('targetIssueId') ? `${rel} #${s('targetIssueId')}` : rel;
    }
    case 'time.log_timer':
      return s('activity_id') ? 'cronômetro (início/fim)' : 'cronômetro';
    case 'ai.extract_data': {
      const n = Array.isArray(c.fields) ? c.fields.length : 0;
      return n ? `${n} ${n === 1 ? 'campo' : 'campos'} → JSON` : 'extrai JSON';
    }
    case 'ai.summarize':
      return (s('source') || 'comments') === 'text' ? 'resume um texto' : 'resume comentários';
    case 'totp.fetch':
      return s('service') ? `código de ${s('service')}` : 'código TOTP';
    case 'time.log':
      return s('hours') ? `${s('hours')}h` : '';
    case 'wait': {
      const unit = { minutes: 'min', hours: 'h', days: 'dias' }[s('unit') || 'hours'] ?? '';
      return `esperar ${s('amount') || '1'} ${unit}`;
    }
    default:
      return '';
  }
}

// Motivos pelos quais um workflow não pode ser ATIVADO (config incompleta ou
// estrutura inválida). Vazio ⇒ pode ativar. Usado para barrar o toggle, não o
// salvar — rascunho incompleto pode ser salvo, só não pode rodar.
export function activationBlockers(nodes: WorkflowNode[]): string[] {
  const blockers: string[] = [];
  const trigger = nodes.find((n) => n.kind === 'trigger');
  if (!trigger) blockers.push('Falta um gatilho');
  if (nodes.every((n) => n.kind !== 'action')) blockers.push('Falta ao menos uma ação');

  for (const n of nodes) {
    const missing = validateNode(n);
    if (missing.length) {
      const label = descriptorFor(n.type)?.label ?? n.type;
      blockers.push(`${label}: falta ${missing.join(', ')}`);
    }
  }
  return blockers;
}

/** Config obrigatória faltando. Vazio ⇒ nó pronto. Alimenta o aviso no canvas. */
export function validateNode(node: WorkflowNode): string[] {
  const c = (node.config || {}) as Record<string, unknown>;
  const missing: string[] = [];
  const need = (k: string, label: string) => {
    if (c[k] == null || c[k] === '') missing.push(label);
  };

  switch (node.type) {
    case 'talk.send':
      need('roomToken', 'sala');
      need('message', 'mensagem');
      break;
    case 'issue.comment':
      need('body', 'comentário');
      break;
    case 'notify':
      need('title', 'título');
      break;
    case 'k86.screen':
      need('title', 'título');
      break;
    case 'webhook':
      need('url', 'URL');
      break;
    case 'email.send':
      need('to', 'destinatário');
      need('subject', 'assunto');
      break;
    case 'ai.generate':
      need('prompt', 'prompt');
      break;
    case 'ai.classify':
      need('prompt', 'prompt');
      if (!Array.isArray(c.labels) || c.labels.length === 0) missing.push('rótulos');
      break;
    case 'issue.create':
      need('project_id', 'projeto');
      need('subject', 'título');
      break;
    case 'time.log':
      need('hours', 'horas');
      need('activity_id', 'atividade');
      if (c.issue === 'id') need('issue_id', 'tarefa');
      break;
    case 'issue.assign_next':
      if (!Array.isArray(c.users) || c.users.length === 0) missing.push('pessoas');
      break;
    case 'issue.link_issues':
      need('targetIssueId', 'tarefa alvo');
      break;
    case 'time.log_timer':
      need('activity_id', 'atividade');
      break;
    case 'ai.extract_data':
      need('prompt', 'o que extrair');
      break;
    case 'ai.summarize':
      if (c.source === 'text') need('text', 'texto');
      break;
    case 'issue.update':
      if (!c.status_id && !c.assigned_to_id && !c.priority_id && !c.due_date)
        missing.push('algum campo a alterar');
      break;
    // Gatilhos não são validados: "qualquer status", "qualquer sala" e
    // "qualquer nova tarefa" são usos legítimos — avisar aqui seria falso positivo.
    default:
      break;
  }
  return missing;
}
