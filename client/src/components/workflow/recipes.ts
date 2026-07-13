// Receitas: automações prontas que montam o grafo (nós posicionados e ligados)
// com um clique. Servem de onboarding e de exemplo das variáveis {{ }}.
//
// IMPORTANTE: ids de status, salas do Talk e destinatários de e-mail variam por
// instalação — não dá para adivinhar. As receitas deixam esses campos VAZIOS de
// propósito; o `validateNode` marca o nó em âmbar no canvas indicando o que
// completar. É guia, não gambiarra.
import { Bell, MessageSquare, CalendarClock, Sparkles, type LucideIcon } from 'lucide-react';
import type { WorkflowNode } from '../../api/workflows';

export interface Recipe {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** O que o usuário precisa completar depois (mostrado no card). */
  todo?: string;
  build: () => WorkflowNode[];
}

let seq = 0;
const nid = () => `r${Date.now().toString(36)}-${(seq++).toString(36)}`;

type NodeInit = Omit<WorkflowNode, 'id' | 'nextIds'> & { nextIds?: string[] };
const mk = (init: NodeInit): WorkflowNode => ({ id: nid(), nextIds: [], ...init });

const COL = 0;
const ROW = 150;

export const RECIPES: Recipe[] = [
  {
    id: 'talk-on-status',
    name: 'Avisar no Talk ao mudar de status',
    description:
      'Quando o status de uma tarefa muda, manda uma mensagem numa sala do Talk com o link da tarefa.',
    icon: MessageSquare,
    todo: 'Escolher a sala do Talk (e, se quiser, o status).',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.status_changed',
        config: { from: '', to: '' },
        position: { x: COL, y: 0 },
      });
      const send = mk({
        kind: 'action',
        type: 'talk.send',
        config: {
          roomToken: '',
          message: '#{{issue.id}} {{issue.subject}} → {{issue.status.name}}',
          onError: 'continue',
        },
        position: { x: COL, y: ROW },
      });
      trigger.nextIds = [send.id];
      return [trigger, send];
    },
  },

  {
    id: 'nudge-stale',
    name: 'Cutucar tarefas paradas',
    description:
      'Todo dia às 9h varre suas tarefas e, nas que estão há mais de 3 dias sem atualização, comenta e te notifica.',
    icon: CalendarClock,
    todo: 'Nada — já funciona. Ajuste os dias se quiser.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.scan',
        config: {
          mode: 'daily',
          hour: 9,
          minute: 0,
          everyMinutes: 60,
          scope: 'assigned',
          // Sem cooldown, cutucaria a mesma tarefa todo dia.
          repeat: 'cooldown',
          cooldownDays: 3,
        },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'issue.updated_days', operand: 'gt', value: '3' }] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const comment = mk({
        kind: 'action',
        type: 'issue.comment',
        config: {
          body: 'Esta tarefa está há mais de 3 dias sem atualização.',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 2 },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Tarefa parada',
          body: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 2 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [comment.id, notify.id]; // ramo "verdadeiro"
      return [trigger, branch, comment, notify];
    },
  },

  {
    id: 'ai-triage-mentions',
    name: 'Triagem de menções com IA',
    description:
      'Quando te mencionam no Talk, a IA classifica em urgente/normal. Se for urgente, te notifica e manda e-mail.',
    icon: Sparkles,
    todo: 'Preencher o destinatário do e-mail. Exige IA configurada.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'talk.message',
        config: { roomToken: '', mentionsOnly: true },
        position: { x: COL, y: 0 },
      });
      const classify = mk({
        kind: 'action',
        type: 'ai.classify',
        config: {
          prompt: 'Mensagem de {{message.actor}} na sala {{room.name}}: "{{message.text}}"',
          labels: ['urgente', 'normal'],
          // Se a IA falhar, não faz sentido seguir ramificando.
          onError: 'stop',
        },
        position: { x: COL, y: ROW },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'ai.label', operand: 'eq', value: 'urgente' }] },
        position: { x: COL, y: ROW * 2 },
        elseIds: [],
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Menção urgente',
          body: '{{message.actor}}: {{message.text}}',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 3 },
      });
      const email = mk({
        kind: 'action',
        type: 'email.send',
        config: {
          to: '',
          subject: 'Menção urgente no Talk',
          text: '{{message.actor}} em {{room.name}}: {{message.text}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 3 },
      });
      trigger.nextIds = [classify.id];
      classify.nextIds = [branch.id];
      branch.nextIds = [notify.id, email.id];
      return [trigger, classify, branch, notify, email];
    },
  },

  {
    id: 'overdue-alert',
    name: 'Alerta de prazo',
    description:
      'Varre suas tarefas de manhã e avisa (push + telinha do teclado) as que passaram do prazo.',
    icon: Bell,
    todo: 'Nada — já funciona.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.scan',
        config: {
          mode: 'daily',
          hour: 8,
          minute: 30,
          everyMinutes: 60,
          scope: 'assigned',
          repeat: 'cooldown',
          cooldownDays: 1,
        },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'issue.due_days', operand: 'lt', value: '0' }] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Tarefa atrasada',
          body: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 2 },
      });
      const k86 = mk({
        kind: 'action',
        type: 'k86.screen',
        config: {
          title: 'Atrasada',
          subtitle: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 2 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [notify.id, k86.id];
      return [trigger, branch, notify, k86];
    },
  },
];
