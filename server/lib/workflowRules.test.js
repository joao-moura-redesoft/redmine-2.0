import { describe, it, expect } from 'vitest';
import {
  fieldValue,
  evalRule,
  evalFilter,
  isBusinessHours,
  evalCondition,
  isOverBudget,
  triggerMatches,
  scheduleDue,
  scanIssues,
  scanRepeatAllows,
  scanCap,
  SCAN_CAP_DEFAULT,
  filterNeedsMissingOutput,
  classifyRun,
  nextFailStreak,
  waitMs,
  daysSince,
  daysUntil,
} from './workflowRules.js';

// Contexto de referência: um evento de mudança de status numa tarefa.
const NOW = new Date('2026-07-10T12:00:00').getTime();
const issue = {
  id: 42,
  subject: 'Corrigir login',
  project: { id: 7, name: 'Bluemine' },
  tracker: { id: 2, name: 'Bug' },
  status: { id: 3, name: 'Em andamento' },
  priority: { id: 5, name: 'Alta' },
  assigned_to: { id: 337, name: 'Joao' },
  updated_on: '2026-07-05T12:00:00Z', // 5 dias antes
  created_on: '2026-06-30T12:00:00Z',
  due_date: '2026-07-08', // 2 dias atrasada
  custom_fields: [
    { id: 12, name: 'Squad', value: 'Pagamentos' },
    { id: 13, name: 'Tags', value: ['a', 'b'] },
  ],
};
const ctx = {
  issue,
  room: null,
  message: null,
  event: { type: 'status_changed', fromStatus: 1, toStatus: 3 },
  user: { id: 337 },
};

describe('fieldValue', () => {
  it('resolve campos da tarefa', () => {
    expect(fieldValue('project', ctx, NOW)).toBe(7);
    expect(fieldValue('status', ctx, NOW)).toBe(3);
    expect(fieldValue('assignee', ctx, NOW)).toBe(337);
    expect(fieldValue('subject', ctx, NOW)).toBe('Corrigir login');
  });

  it('resolve campos do EVENTO (antes eram descartados)', () => {
    expect(fieldValue('event.from_status', ctx, NOW)).toBe(1);
    expect(fieldValue('event.to_status', ctx, NOW)).toBe(3);
  });

  it('resolve campos personalizados por id, incluindo listas', () => {
    expect(fieldValue('cf:12', ctx, NOW)).toBe('Pagamentos');
    expect(fieldValue('cf:13', ctx, NOW)).toBe('a,b');
    expect(fieldValue('cf:999', ctx, NOW)).toBeUndefined();
  });

  it('calcula idade e prazo em dias (negativo = atrasada)', () => {
    expect(fieldValue('issue.updated_days', ctx, NOW)).toBe(5);
    expect(fieldValue('issue.due_days', ctx, NOW)).toBe(-2);
  });

  it('devolve undefined para campo fora do contexto do gatilho', () => {
    // Gatilho de tarefa não produz mensagem do Talk.
    expect(fieldValue('message.text', ctx, NOW)).toBeUndefined();
    expect(fieldValue('room.name', ctx, NOW)).toBeUndefined();
    expect(fieldValue('ai.label', ctx, NOW)).toBeUndefined();
  });

  it('resolve campos de comentário (gatilho issue.commented)', () => {
    const c = { issue, comment: { text: 'pode fechar?', author: 'Bia', authorId: 50 } };
    expect(fieldValue('comment.text', c, NOW)).toBe('pode fechar?');
    expect(fieldValue('comment.author', c, NOW)).toBe('Bia');
    // fora do contexto de comentário → indisponível
    expect(fieldValue('comment.text', { issue }, NOW)).toBeUndefined();
  });

  it('resolve saídas de ações anteriores', () => {
    const c = {
      ...ctx,
      ai: { text: 'oi', label: 'urgente', summary: 'resumo', data: { valor: 10 } },
      webhook: { status: 201 },
      created: { id: 99 },
      totp: { code: '123456' },
    };
    expect(fieldValue('ai.label', c, NOW)).toBe('urgente');
    expect(fieldValue('ai.summary', c, NOW)).toBe('resumo');
    expect(fieldValue('webhook.status', c, NOW)).toBe(201);
    expect(fieldValue('created.id', c, NOW)).toBe(99);
    expect(fieldValue('totp.code', c, NOW)).toBe('123456');
  });

  it('resolve campos de e-mail (gatilho email.received)', () => {
    const c = { email: { subject: 'Fatura #12', from: 'cobranca@cliente.com', snippet: 'segue' } };
    expect(fieldValue('email.subject', c, NOW)).toBe('Fatura #12');
    expect(fieldValue('email.from', c, NOW)).toBe('cobranca@cliente.com');
    expect(fieldValue('email.snippet', c, NOW)).toBe('segue');
    // fora do contexto de e-mail → indisponível
    expect(fieldValue('email.subject', { issue }, NOW)).toBeUndefined();
  });

  it('message.mention é booleano só quando há mensagem', () => {
    expect(fieldValue('message.mention', ctx, NOW)).toBeUndefined();
    expect(fieldValue('message.mention', { message: { mention: false } }, NOW)).toBe(false);
    expect(fieldValue('message.mention', { message: { mention: true } }, NOW)).toBe(true);
  });
});

describe('daysSince / daysUntil', () => {
  it('devolve undefined para data ausente ou inválida', () => {
    expect(daysSince(undefined, NOW)).toBeUndefined();
    expect(daysSince('não é data', NOW)).toBeUndefined();
    expect(daysUntil(null, NOW)).toBeUndefined();
  });

  // Regressão: o prazo é meia-noite e o "agora" é meio-dia. Diffar direto e usar
  // floor dava um dia a mais de atraso (prazo de ontem virava -2).
  it('daysUntil conta DIAS DE CALENDÁRIO, independente da hora do dia', () => {
    expect(daysUntil('2026-07-10', NOW)).toBe(0); // vence hoje
    expect(daysUntil('2026-07-11', NOW)).toBe(1); // vence amanhã
    expect(daysUntil('2026-07-09', NOW)).toBe(-1); // venceu ontem
    expect(daysUntil('2026-07-08', NOW)).toBe(-2); // 2 dias atrasada

    // Mesma resposta de madrugada e quase à meia-noite.
    const cedo = new Date('2026-07-10T00:30:00').getTime();
    const tarde = new Date('2026-07-10T23:30:00').getTime();
    expect(daysUntil('2026-07-09', cedo)).toBe(-1);
    expect(daysUntil('2026-07-09', tarde)).toBe(-1);
  });
});

describe('evalRule', () => {
  it('compara igualdade coagindo para string (id numérico vs valor do form)', () => {
    expect(evalRule({ field: 'status', operand: 'eq', value: '3' }, ctx, 337, NOW)).toBe(true);
    expect(evalRule({ field: 'status', operand: 'eq', value: '9' }, ctx, 337, NOW)).toBe(false);
  });

  it('resolve "me" para o uid dono da automação, nos campos de pessoa', () => {
    expect(evalRule({ field: 'assignee', operand: 'eq', value: 'me' }, ctx, 337, NOW)).toBe(true);
    expect(evalRule({ field: 'assignee', operand: 'eq', value: 'me' }, ctx, 999, NOW)).toBe(false);
    const evCtx = { ...ctx, event: { ...ctx.event, newAssignee: 337 } };
    expect(
      evalRule({ field: 'event.new_assignee', operand: 'eq', value: 'me' }, evCtx, 337, NOW),
    ).toBe(true);
  });

  // Regressão: "me" só é especial em campo de pessoa. Num campo de texto, é texto.
  it('NÃO trata "me" como o uid em campos de texto', () => {
    const c = { ...ctx, issue: { ...issue, subject: 'reunião com me e você' } };
    expect(evalRule({ field: 'subject', operand: 'contains', value: 'me' }, c, 337, NOW)).toBe(
      true,
    );
    // Se "me" virasse o uid, isto procuraria "337" e falharia.
  });

  it('suporta contains, in e comparadores numéricos', () => {
    expect(evalRule({ field: 'subject', operand: 'contains', value: 'LOGIN' }, ctx, 337, NOW)).toBe(
      true,
    );
    expect(evalRule({ field: 'status', operand: 'in', value: '1, 3, 5' }, ctx, 337, NOW)).toBe(
      true,
    );
    expect(
      evalRule({ field: 'issue.updated_days', operand: 'gt', value: '3' }, ctx, 337, NOW),
    ).toBe(true);
    expect(evalRule({ field: 'issue.due_days', operand: 'lt', value: '0' }, ctx, 337, NOW)).toBe(
      true,
    );
  });

  it('regra sobre campo indisponível é FALSA (não lança)', () => {
    expect(
      evalRule({ field: 'message.text', operand: 'contains', value: 'x' }, ctx, 337, NOW),
    ).toBe(false);
    // ...inclusive com neq, que "intuitivamente" poderia parecer verdadeiro.
    expect(evalRule({ field: 'message.text', operand: 'neq', value: 'x' }, ctx, 337, NOW)).toBe(
      false,
    );
  });
});

describe('evalFilter', () => {
  it('sem regras, passa', () => {
    expect(evalFilter({ op: 'and', rules: [] }, ctx, 337, NOW)).toBe(true);
    expect(evalFilter(undefined, ctx, 337, NOW)).toBe(true);
  });

  it('and exige todas; or exige qualquer', () => {
    const ok = { field: 'status', operand: 'eq', value: '3' };
    const no = { field: 'status', operand: 'eq', value: '9' };
    expect(evalFilter({ op: 'and', rules: [ok, no] }, ctx, 337, NOW)).toBe(false);
    expect(evalFilter({ op: 'or', rules: [ok, no] }, ctx, 337, NOW)).toBe(true);
    expect(evalFilter({ op: 'and', rules: [ok, ok] }, ctx, 337, NOW)).toBe(true);
  });
});

describe('isBusinessHours', () => {
  // 2026-07-06 = segunda(1), 07-08 = quarta(3), 07-11 = sábado(6), 07-12 = domingo(0).
  const at = (iso) => new Date(iso).getTime();

  it('defaults: seg-sex 08h–18h', () => {
    expect(isBusinessHours({}, at('2026-07-06T09:00:00'))).toBe(true); // seg 9h
    expect(isBusinessHours({}, at('2026-07-08T17:59:00'))).toBe(true); // qua 17h59
    expect(isBusinessHours({}, at('2026-07-08T07:30:00'))).toBe(false); // antes das 8
    expect(isBusinessHours({}, at('2026-07-08T18:00:00'))).toBe(false); // 18h é o fim (exclusivo)
    expect(isBusinessHours({}, at('2026-07-11T10:00:00'))).toBe(false); // sábado
    expect(isBusinessHours({}, at('2026-07-12T10:00:00'))).toBe(false); // domingo
  });

  it('respeita janela e dias customizados', () => {
    const cfg = { startHour: 6, endHour: 22, days: [6, 0] }; // fim de semana 6h–22h
    expect(isBusinessHours(cfg, at('2026-07-11T21:00:00'))).toBe(true); // sábado 21h
    expect(isBusinessHours(cfg, at('2026-07-06T21:00:00'))).toBe(false); // segunda fora dos dias
    expect(isBusinessHours(cfg, at('2026-07-12T05:00:00'))).toBe(false); // domingo antes das 6
  });
});

describe('evalCondition', () => {
  it('despacha o predicado de horário comercial pelo type do nó', () => {
    const node = { type: 'filter.is_business_hours', config: {} };
    expect(evalCondition(node, {}, 337, new Date('2026-07-06T09:00:00').getTime())).toBe(true);
    expect(evalCondition(node, {}, 337, new Date('2026-07-11T09:00:00').getTime())).toBe(false);
  });

  it('cai no filtro por regras para os demais nós', () => {
    const node = {
      type: 'if',
      config: { op: 'and', rules: [{ field: 'status', operand: 'eq', value: '3' }] },
    };
    expect(evalCondition(node, ctx, 337, NOW)).toBe(true);
    const node2 = {
      ...node,
      config: { ...node.config, rules: [{ field: 'status', operand: 'eq', value: '9' }] },
    };
    expect(evalCondition(node2, ctx, 337, NOW)).toBe(false);
  });
});

describe('isOverBudget', () => {
  it('dispara só quando há estimativa e as horas passaram dela', () => {
    expect(isOverBudget({ estimated_hours: 8, spent_hours: 9 })).toBe(true);
    expect(isOverBudget({ estimated_hours: 8, spent_hours: 8 })).toBe(false); // no limite, não passou
    expect(isOverBudget({ estimated_hours: 8, spent_hours: 3 })).toBe(false);
  });

  it('sem estimativa (ou zero) nunca estoura', () => {
    expect(isOverBudget({ spent_hours: 9 })).toBe(false);
    expect(isOverBudget({ estimated_hours: 0, spent_hours: 9 })).toBe(false);
    expect(isOverBudget({ estimated_hours: null, spent_hours: 9 })).toBe(false);
  });

  it('spent ausente/ inválido é tratado como não-estouro', () => {
    expect(isOverBudget({ estimated_hours: 8 })).toBe(false);
    expect(isOverBudget({})).toBe(false);
    expect(isOverBudget(null)).toBe(false);
  });
});

describe('triggerMatches', () => {
  const ev = { type: 'status_changed', fromStatus: 1, toStatus: 3, issueId: 42 };

  it('casa status_changed com e sem filtro de from/to', () => {
    expect(triggerMatches({ type: 'issue.status_changed', config: {} }, ev, 337)).toBe(true);
    expect(triggerMatches({ type: 'issue.status_changed', config: { to: 3 } }, ev, 337)).toBe(true);
    expect(triggerMatches({ type: 'issue.status_changed', config: { to: 9 } }, ev, 337)).toBe(
      false,
    );
    expect(
      triggerMatches({ type: 'issue.status_changed', config: { from: 1, to: 3 } }, ev, 337),
    ).toBe(true);
  });

  it('não casa gatilho de tipo diferente', () => {
    expect(triggerMatches({ type: 'issue.created', config: {} }, ev, 337)).toBe(false);
    expect(triggerMatches({ type: 'talk.message', config: {} }, ev, 337)).toBe(false);
  });

  it('talk.message respeita sala e mentionsOnly', () => {
    const t = { type: 'talk.message', roomToken: 'abc', mention: false };
    expect(triggerMatches({ type: 'talk.message', config: {} }, t, 337)).toBe(true);
    expect(triggerMatches({ type: 'talk.message', config: { roomToken: 'xyz' } }, t, 337)).toBe(
      false,
    );
    expect(triggerMatches({ type: 'talk.message', config: { mentionsOnly: true } }, t, 337)).toBe(
      false,
    );
    expect(
      triggerMatches(
        { type: 'talk.message', config: { mentionsOnly: true } },
        { ...t, mention: true },
        337,
      ),
    ).toBe(true);
  });

  it('assigned_changed com toMe só casa quando o novo responsável sou eu', () => {
    const a = { type: 'assigned_changed', newAssignee: 337 };
    expect(triggerMatches({ type: 'issue.assigned_changed', config: { toMe: true } }, a, 337)).toBe(
      true,
    );
    expect(triggerMatches({ type: 'issue.assigned_changed', config: { toMe: true } }, a, 999)).toBe(
      false,
    );
  });

  it('issue.commented respeita "somente de outras pessoas"', () => {
    const meu = { type: 'commented', authorId: 337 };
    const alheio = { type: 'commented', authorId: 50 };
    // sem filtro: qualquer comentário casa
    expect(triggerMatches({ type: 'issue.commented', config: {} }, meu, 337)).toBe(true);
    // fromOthers: ignora o meu, aceita o dos outros
    expect(
      triggerMatches({ type: 'issue.commented', config: { fromOthers: true } }, meu, 337),
    ).toBe(false);
    expect(
      triggerMatches({ type: 'issue.commented', config: { fromOthers: true } }, alheio, 337),
    ).toBe(true);
    // não casa com evento de outro tipo
    expect(
      triggerMatches({ type: 'issue.commented', config: {} }, { type: 'status_changed' }, 337),
    ).toBe(false);
  });

  it('email.received filtra por remetente e assunto (contém, sem diferenciar caixa)', () => {
    const ev = { type: 'email.received', from: 'cobranca@Cliente.com', subject: 'Fatura #12' };
    expect(triggerMatches({ type: 'email.received', config: {} }, ev, 337)).toBe(true);
    expect(
      triggerMatches({ type: 'email.received', config: { fromContains: 'cliente.com' } }, ev, 337),
    ).toBe(true);
    expect(
      triggerMatches({ type: 'email.received', config: { subjectContains: 'fatura' } }, ev, 337),
    ).toBe(true);
    expect(
      triggerMatches({ type: 'email.received', config: { fromContains: 'outro.com' } }, ev, 337),
    ).toBe(false);
    // não casa com evento de outro tipo
    expect(triggerMatches({ type: 'email.received', config: {} }, { type: 'commented' }, 337)).toBe(
      false,
    );
  });
});

describe('scheduleDue', () => {
  it('modo interval: dispara na primeira vez e respeita o intervalo', () => {
    const state = { lastScheduleRuns: {} };
    const trig = { id: 'n1', config: { mode: 'interval', everyMinutes: 1 } };
    const t0 = new Date('2026-07-10T12:00:00');
    expect(scheduleDue(state, trig, t0)).toBe(true); // primeira vez

    const t30s = new Date('2026-07-10T12:00:30');
    expect(scheduleDue(state, trig, t30s)).toBe(false); // ainda não passou 1 min

    const t61s = new Date('2026-07-10T12:01:01');
    expect(scheduleDue(state, trig, t61s)).toBe(true);
  });

  it('modo daily: dispara uma vez por dia depois da hora marcada', () => {
    const state = { lastScheduleRuns: {} };
    const trig = { id: 'n1', config: { mode: 'daily', hour: 9, minute: 0 } };

    expect(scheduleDue(state, trig, new Date('2026-07-10T08:59:00'))).toBe(false); // antes da hora
    expect(scheduleDue(state, trig, new Date('2026-07-10T09:00:00'))).toBe(true); // na hora
    expect(scheduleDue(state, trig, new Date('2026-07-10T18:00:00'))).toBe(false); // já rodou hoje
    expect(scheduleDue(state, trig, new Date('2026-07-11T09:30:00'))).toBe(true); // novo dia
  });
});

describe('scanIssues', () => {
  const issues = new Map([
    [1, { id: 1 }],
    [2, { id: 2 }],
    [3, { id: 3 }],
  ]);
  const data = { issues, seen: { assigned: [1], review: [2], monitored: [3] } };

  it('escopo "all" (ou ausente) devolve tudo', () => {
    expect(scanIssues(data, 'all').map((i) => i.id)).toEqual([1, 2, 3]);
    expect(scanIssues(data, undefined).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('filtra pelo escopo pedido', () => {
    expect(scanIssues(data, 'assigned').map((i) => i.id)).toEqual([1]);
    expect(scanIssues(data, 'review').map((i) => i.id)).toEqual([2]);
  });

  it('sem dados, devolve lista vazia', () => {
    expect(scanIssues(null, 'all')).toEqual([]);
  });
});

describe('scanCap', () => {
  it('usa o padrão quando ausente ou inválido', () => {
    expect(scanCap({})).toBe(SCAN_CAP_DEFAULT);
    expect(scanCap({ maxIssues: 0 })).toBe(SCAN_CAP_DEFAULT);
    expect(scanCap({ maxIssues: -5 })).toBe(SCAN_CAP_DEFAULT);
    expect(scanCap({ maxIssues: 'abc' })).toBe(SCAN_CAP_DEFAULT);
  });
  it('respeita o valor configurado', () => {
    expect(scanCap({ maxIssues: 5 })).toBe(5);
    expect(scanCap({ maxIssues: '3' })).toBe(3);
  });
});

// O teto é um RATE LIMIT, não perda de dados: quem foi cortado não é marcado
// como avisado, então entra na próxima execução.
describe('teto × repeat (simulação do laço da varredura)', () => {
  const t0 = new Date('2026-07-10T09:00:00').getTime();
  const runScan = (issues, fired, cfg, now) => {
    const cap = scanCap(cfg);
    let acted = 0;
    const actedOn = [];
    for (const id of issues) {
      if (!scanRepeatAllows(fired, id, cfg, now)) continue;
      if (acted >= cap) break;
      actedOn.push(id);
      fired[id] = now; // só marca quem agiu
      acted++;
    }
    return actedOn;
  };

  it('corta no teto e retoma na execução seguinte, sem repetir nem pular', () => {
    const cfg = { maxIssues: 2, repeat: 'once' };
    const issues = [1, 2, 3, 4, 5];
    const fired = {};

    expect(runScan(issues, fired, cfg, t0)).toEqual([1, 2]);
    // As cortadas NÃO ficaram marcadas.
    expect(Object.keys(fired).map(Number)).toEqual([1, 2]);

    const t1 = t0 + 86400000;
    expect(runScan(issues, fired, cfg, t1)).toEqual([3, 4]); // retoma de onde parou

    const t2 = t1 + 86400000;
    expect(runScan(issues, fired, cfg, t2)).toEqual([5]); // termina

    const t3 = t2 + 86400000;
    expect(runScan(issues, fired, cfg, t3)).toEqual([]); // 'once': nunca mais
  });
});

describe('classifyRun / nextFailStreak (auto-pause)', () => {
  const ok = [{ type: 'notify', ok: true }];
  const hard = [{ type: 'webhook', ok: false, error: '404' }];
  const transient = [{ type: 'webhook', ok: false, error: '503', transient: true }];
  const mixedFail = [
    { type: 'webhook', ok: false, transient: true },
    { type: 'talk.send', ok: false }, // uma dura ⇒ conta como 'hard'
  ];

  it('classifica os quatro tipos', () => {
    expect(classifyRun(ok)).toBe('ok');
    expect(classifyRun(hard)).toBe('hard');
    expect(classifyRun(transient)).toBe('transient');
    expect(classifyRun(mixedFail)).toBe('hard');
    expect(classifyRun([])).toBe('empty');
  });

  it('sucesso zera o streak', () => {
    expect(nextFailStreak(3, ok)).toEqual({ streak: 0, pause: false, changed: true });
    // já estava zerado ⇒ nada muda
    expect(nextFailStreak(0, ok)).toEqual({ streak: 0, pause: false, changed: false });
  });

  it('falha transiente NÃO pune (nem incrementa, nem zera)', () => {
    expect(nextFailStreak(2, transient)).toEqual({ streak: 2, pause: false, changed: false });
    expect(nextFailStreak(0, transient)).toEqual({ streak: 0, pause: false, changed: false });
  });

  it('nada rodou (empty) é neutro', () => {
    expect(nextFailStreak(2, [])).toEqual({ streak: 2, pause: false, changed: false });
  });

  it('falha dura incrementa e, ao atingir o máximo, pausa e zera', () => {
    expect(nextFailStreak(0, hard, 5)).toEqual({ streak: 1, pause: false, changed: true });
    expect(nextFailStreak(3, hard, 5)).toEqual({ streak: 4, pause: false, changed: true });
    expect(nextFailStreak(4, hard, 5)).toEqual({ streak: 0, pause: true, changed: true });
  });

  it('5 falhas duras seguidas pausam; uma transiente no meio não zera nem conta', () => {
    let streak = 0;
    const step = (actions) => {
      const r = nextFailStreak(streak, actions, 5);
      streak = r.streak;
      return r.pause;
    };
    expect(step(hard)).toBe(false); // 1
    expect(step(hard)).toBe(false); // 2
    expect(step(transient)).toBe(false); // neutro, segue 2
    expect(step(hard)).toBe(false); // 3
    expect(step(hard)).toBe(false); // 4
    expect(step(hard)).toBe(true); // 5 → pausa
  });
});

describe('waitMs (nó de Espera)', () => {
  const MIN = 60 * 1000;
  it('converte as unidades', () => {
    expect(waitMs({ amount: 5, unit: 'minutes' })).toBe(5 * MIN);
    expect(waitMs({ amount: 2, unit: 'hours' })).toBe(2 * 60 * MIN);
    expect(waitMs({ amount: 1, unit: 'days' })).toBe(24 * 60 * MIN);
  });
  it('mínimo de 1 minuto e default de 1 hora quando inválido', () => {
    expect(waitMs({ amount: 0, unit: 'minutes' })).toBe(MIN); // amount inválido → 1 unidade, mas min 1min
    expect(waitMs({ amount: 0.1, unit: 'minutes' })).toBe(MIN); // 6s < 1min → clamp
    expect(waitMs({})).toBe(60 * MIN); // default 1 hora
    expect(waitMs({ amount: 3, unit: 'xyz' })).toBe(3 * 60 * MIN); // unidade inválida → horas
  });
});

describe('filterNeedsMissingOutput', () => {
  const cfgAi = { rules: [{ field: 'ai.label', operand: 'eq', value: 'urgente' }] };

  it('é indecidível quando a saída da ação não existe no contexto (prévia)', () => {
    expect(filterNeedsMissingOutput(cfgAi, { issue }, NOW)).toBe(true);
  });

  it('é decidível quando a saída existe (execução real)', () => {
    expect(filterNeedsMissingOutput(cfgAi, { issue, ai: { label: 'urgente' } }, NOW)).toBe(false);
  });

  it('condições que não dependem de ação são sempre decidíveis', () => {
    const cfg = { rules: [{ field: 'status', operand: 'eq', value: '3' }] };
    expect(filterNeedsMissingOutput(cfg, { issue }, NOW)).toBe(false);
    expect(filterNeedsMissingOutput({ rules: [] }, { issue }, NOW)).toBe(false);
  });
});

describe('scanRepeatAllows', () => {
  const t0 = new Date('2026-07-10T12:00:00').getTime();

  it('always: sempre reexecuta', () => {
    expect(scanRepeatAllows({ 42: t0 }, 42, { repeat: 'always' }, t0)).toBe(true);
    expect(scanRepeatAllows({}, 42, {}, t0)).toBe(true); // default
  });

  it('once: só a primeira vez', () => {
    expect(scanRepeatAllows({}, 42, { repeat: 'once' }, t0)).toBe(true);
    expect(scanRepeatAllows({ 42: t0 }, 42, { repeat: 'once' }, t0)).toBe(false);
  });

  it('cooldown: respeita a janela em dias', () => {
    const cfg = { repeat: 'cooldown', cooldownDays: 3 };
    expect(scanRepeatAllows({}, 42, cfg, t0)).toBe(true);
    const doisDiasDepois = t0 + 2 * 24 * 60 * 60 * 1000;
    expect(scanRepeatAllows({ 42: t0 }, 42, cfg, doisDiasDepois)).toBe(false);
    const quatroDiasDepois = t0 + 4 * 24 * 60 * 60 * 1000;
    expect(scanRepeatAllows({ 42: t0 }, 42, cfg, quatroDiasDepois)).toBe(true);
  });
});
