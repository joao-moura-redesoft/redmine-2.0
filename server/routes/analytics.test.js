import { describe, it, expect } from 'vitest';
import analyticsRouter from './analytics.js';

const {
  computeTrends,
  windowStartOf,
  computeSla,
  ymd,
  computeProject,
  computeMe,
  weekStartMonday,
} = analyticsRouter.__testables;

// Helpers para fabricar issues sintéticas com datas conhecidas.
const created = (ym) => ({ created_on: `${ym}-15T10:00:00Z` });
const closed = (ym) => ({ closed_on: `${ym}-20T10:00:00Z` });

// Ancorado num "agora" fixo para o teste não depender da data real.
const NOW = new Date(2026, 6, 14); // 2026-07-14 (mês 6 = julho)

describe('windowStartOf', () => {
  it('volta monthsBack-1 meses e ancora no dia 1', () => {
    const s = windowStartOf(NOW, 6);
    expect(s.getFullYear()).toBe(2026);
    expect(s.getMonth()).toBe(1); // fevereiro
    expect(s.getDate()).toBe(1);
  });

  it('atravessa a virada de ano', () => {
    const s = windowStartOf(new Date(2026, 1, 10), 6); // fev/26, 6 meses
    expect(s.getFullYear()).toBe(2025);
    expect(s.getMonth()).toBe(8); // setembro/25
  });
});

describe('computeTrends', () => {
  it('conta criadas e fechadas no mês certo', () => {
    const r = computeTrends({
      createdIssues: [created('2026-02'), created('2026-02'), created('2026-07')],
      closedIssues: [closed('2026-03'), closed('2026-07')],
      openIssues: new Array(10).fill({}),
      monthsBack: 6,
      now: NOW,
    });
    // Janela fev..jul (6 meses)
    expect(r.months.map((m) => m.key)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    const byKey = Object.fromEntries(r.months.map((m) => [m.key, m]));
    expect(byKey['2026-02'].created).toBe(2);
    expect(byKey['2026-07'].created).toBe(1);
    expect(byKey['2026-03'].closed).toBe(1);
    expect(byKey['2026-07'].closed).toBe(1);
    expect(r.summary.createdTotal).toBe(3);
    expect(r.summary.closedTotal).toBe(2);
    expect(r.summary.netTotal).toBe(1);
  });

  it('ignora issues fora da janela', () => {
    const r = computeTrends({
      createdIssues: [created('2025-01'), created('2026-07')], // jan/25 está fora
      closedIssues: [],
      openIssues: [],
      monthsBack: 6,
      now: NOW,
    });
    expect(r.summary.createdTotal).toBe(1);
  });

  it('reconstrói o backlog batendo com o total aberto atual', () => {
    // Saldos conhecidos por mês, backlog final = 10 abertas.
    const mk = (n, fn) => Array.from({ length: n }, () => fn);
    const r = computeTrends({
      createdIssues: [...mk(3, created('2026-02')), ...mk(5, created('2026-07'))],
      closedIssues: [...mk(2, closed('2026-02')), ...mk(1, closed('2026-07'))],
      openIssues: new Array(10).fill({}),
      monthsBack: 6,
      now: NOW,
    });
    const last = r.months[r.months.length - 1];
    // Backlog do último mês = total aberto agora.
    expect(last.backlog).toBe(10);
    // Reconstrução: backlog[i] = backlog[i+1] - net[i+1]; conferimos o encadeamento.
    for (let i = 0; i < r.months.length - 1; i++) {
      expect(r.months[i + 1].backlog - r.months[i].backlog).toBe(r.months[i + 1].net);
    }
    expect(r.summary.backlogEnd).toBe(10);
    expect(r.totalOpenNow).toBe(10);
  });

  it('classifica a tendência: crescendo / encolhendo / estável', () => {
    const grow = computeTrends({
      createdIssues: Array.from({ length: 10 }, () => created('2026-07')),
      closedIssues: [],
      openIssues: new Array(10).fill({}),
      monthsBack: 6,
      now: NOW,
    });
    expect(grow.summary.trend).toBe('growing'); // criou muito, fechou nada

    const shrink = computeTrends({
      createdIssues: [],
      closedIssues: Array.from({ length: 10 }, () => closed('2026-07')),
      openIssues: [],
      monthsBack: 6,
      now: NOW,
    });
    expect(shrink.summary.trend).toBe('shrinking'); // fechou muito, criou nada

    const stable = computeTrends({
      createdIssues: [created('2026-07')],
      closedIssues: [closed('2026-07')],
      openIssues: new Array(5).fill({}),
      monthsBack: 6,
      now: NOW,
    });
    expect(stable.summary.trend).toBe('stable'); // saldo ~0
  });

  it('marca capped quando alguma consulta bate no teto de 2000', () => {
    const r = computeTrends({
      createdIssues: new Array(2000).fill(created('2026-07')),
      closedIssues: [],
      openIssues: [],
      monthsBack: 6,
      now: NOW,
    });
    expect(r.capped).toBe(true);
  });

  it('médias por mês usam a janela inteira', () => {
    const r = computeTrends({
      createdIssues: Array.from({ length: 12 }, () => created('2026-07')),
      closedIssues: Array.from({ length: 6 }, () => closed('2026-07')),
      openIssues: [],
      monthsBack: 6,
      now: NOW,
    });
    expect(r.summary.avgCreated).toBe(2); // 12 / 6
    expect(r.summary.avgClosed).toBe(1); // 6 / 6
  });
});

// ── SLA / Prazos ──
// Datas relativas a NOW (2026-07-14). Helpers para issue aberta com prazo e
// fechada com prazo.
const openDue = (dueYmd, assignee) => ({
  id: Math.floor(Math.random() * 1e6),
  subject: 't',
  due_date: dueYmd,
  assigned_to: assignee ? { name: assignee } : undefined,
});
const closedDue = (dueYmd, closedYmd) => ({
  due_date: dueYmd,
  closed_on: `${closedYmd}T12:00:00Z`,
});

describe('ymd', () => {
  it('formata data local como YYYY-MM-DD', () => {
    expect(ymd(new Date(2026, 6, 14))).toBe('2026-07-14');
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('computeSla', () => {
  it('classifica abertas em vencidas / hoje / a vencer no horizonte', () => {
    const r = computeSla({
      openIssues: [
        openDue('2026-07-10'), // vencida (4d)
        openDue('2026-07-14'), // hoje
        openDue('2026-07-17'), // dentro de 7d
        openDue('2026-07-30'), // fora do horizonte
        openDue(null), // sem prazo
        { id: 1, subject: 'sem due' }, // sem due_date
      ],
      closedIssues: [],
      horizon: 7,
      now: NOW,
    });
    expect(r.open.total).toBe(6);
    expect(r.open.withDue).toBe(4);
    expect(r.open.overdue).toBe(1);
    expect(r.open.dueToday).toBe(1);
    expect(r.open.dueSoon).toBe(1); // 07-17; 07-30 fica de fora
    expect(r.open.avgOverdueDays).toBe(4);
  });

  it('lista de vencidas ordena pela mais atrasada e calcula os dias', () => {
    const r = computeSla({
      openIssues: [openDue('2026-07-12'), openDue('2026-07-04'), openDue('2026-07-13')],
      closedIssues: [],
      horizon: 7,
      now: NOW,
    });
    expect(r.overdueList.map((i) => i.daysOverdue)).toEqual([10, 2, 1]);
  });

  it('agrupa o que vence no horizonte por responsável', () => {
    const r = computeSla({
      openIssues: [
        openDue('2026-07-14', 'Ana'),
        openDue('2026-07-16', 'Ana'),
        openDue('2026-07-15', 'Bruno'),
        openDue('2026-07-10', 'Ana'), // vencida, não entra no upcoming
      ],
      closedIssues: [],
      horizon: 7,
      now: NOW,
    });
    expect(r.upcoming.map((u) => [u.name, u.count])).toEqual([
      ['Ana', 2],
      ['Bruno', 1],
    ]);
    // Ordenadas por prazo dentro do grupo
    expect(r.upcoming[0].issues.map((i) => i.due_date)).toEqual(['2026-07-14', '2026-07-16']);
    expect(r.upcoming[0].issues[0].daysUntil).toBe(0);
  });

  it('sem responsável cai em "Sem responsável"', () => {
    const r = computeSla({
      openIssues: [openDue('2026-07-15')],
      closedIssues: [],
      horizon: 7,
      now: NOW,
    });
    expect(r.upcoming[0].name).toBe('Sem responsável');
  });

  it('mede cumprimento de prazo das fechadas (no prazo × atrasadas)', () => {
    const r = computeSla({
      openIssues: [],
      closedIssues: [
        closedDue('2026-07-10', '2026-07-08'), // no prazo (antes)
        closedDue('2026-07-10', '2026-07-10'), // no prazo (no dia)
        closedDue('2026-07-10', '2026-07-13'), // atrasada 3d
        closedDue('2026-07-10', '2026-07-15'), // atrasada 5d
        closedDue(null, '2026-07-10'), // sem prazo, ignorada
      ],
      horizon: 7,
      now: NOW,
    });
    expect(r.delivery.closedWithDue).toBe(4);
    expect(r.delivery.onTime).toBe(2);
    expect(r.delivery.late).toBe(2);
    expect(r.delivery.rate).toBe(50); // 2/4
    expect(r.delivery.avgLateDays).toBe(4); // (3+5)/2
  });

  it('rate é null quando não há fechadas com prazo', () => {
    const r = computeSla({ openIssues: [], closedIssues: [], horizon: 7, now: NOW });
    expect(r.delivery.rate).toBeNull();
    expect(r.delivery.avgLateDays).toBe(0);
  });
});

// ── Dashboard de projeto ──
const issue = (o = {}) => ({
  id: o.id ?? Math.floor(Math.random() * 1e6),
  subject: 't',
  closed_on: o.closed ? '2026-07-10T12:00:00Z' : undefined,
  status: { name: o.status || (o.closed ? 'Fechada' : 'Nova') },
  tracker: { name: o.tracker || 'Tarefa' },
  priority: { name: o.priority || 'Normal' },
  assigned_to: o.assignee ? { name: o.assignee } : undefined,
  fixed_version: o.version ? { id: o.version } : undefined,
});

describe('computeProject', () => {
  it('calcula totais e conclusão a partir do closed_on', () => {
    const r = computeProject({
      issues: [issue(), issue(), issue({ closed: true }), issue({ closed: true })],
      versions: [],
      now: NOW,
    });
    expect(r.totals).toEqual({ total: 4, open: 2, closed: 2, completion: 50 });
  });

  it('distribui só as abertas por status/prioridade/responsável', () => {
    const r = computeProject({
      issues: [
        issue({ status: 'Em andamento', priority: 'Alta', assignee: 'Ana' }),
        issue({ status: 'Em andamento', priority: 'Normal', assignee: 'Ana' }),
        issue({ status: 'Nova', priority: 'Normal', assignee: 'Bruno' }),
        issue({ closed: true, assignee: 'Ana' }), // fechada não conta nessas
      ],
      versions: [],
      now: NOW,
    });
    expect(r.byStatus).toEqual([
      { name: 'Em andamento', count: 2 },
      { name: 'Nova', count: 1 },
    ]);
    expect(r.byAssignee).toEqual([
      { name: 'Ana', count: 2 },
      { name: 'Bruno', count: 1 },
    ]);
  });

  it('por tipo conta aberto/fechado/total', () => {
    const r = computeProject({
      issues: [
        issue({ tracker: 'Bug' }),
        issue({ tracker: 'Bug', closed: true }),
        issue({ tracker: 'Funcionalidade' }),
      ],
      versions: [],
      now: NOW,
    });
    const bug = r.byTracker.find((t) => t.name === 'Bug');
    expect(bug).toEqual({ name: 'Bug', open: 1, closed: 1, total: 2 });
  });

  it('agrega versões com progresso e marca risco (aberta e vencida)', () => {
    const r = computeProject({
      issues: [
        issue({ version: 1 }),
        issue({ version: 1, closed: true }),
        issue({ version: 2, closed: true }),
      ],
      versions: [
        { id: 1, name: 'v1', status: 'open', due_date: '2026-07-01' }, // vencida, tem aberta
        { id: 2, name: 'v2', status: 'open', due_date: '2026-12-01' }, // ok, tudo fechado
      ],
      now: NOW,
    });
    const v1 = r.versions.find((v) => v.id === 1);
    const v2 = r.versions.find((v) => v.id === 2);
    expect(v1).toMatchObject({ total: 2, closed: 1, open: 1, pct: 50, overdue: true });
    expect(v2).toMatchObject({ total: 1, closed: 1, open: 0, pct: 100, overdue: false });
    // A vencida/aberta vem primeiro na ordenação.
    expect(r.versions[0].id).toBe(1);
  });

  it('ordena versões: abertas antes de fechadas', () => {
    const r = computeProject({
      issues: [],
      versions: [
        { id: 1, name: 'antiga', status: 'closed', due_date: '2026-01-01' },
        { id: 2, name: 'atual', status: 'open', due_date: '2026-09-01' },
      ],
      now: NOW,
    });
    expect(r.versions.map((v) => v.id)).toEqual([2, 1]);
  });

  it('devolve openList só com as abertas (para drill-down)', () => {
    const r = computeProject({
      issues: [
        issue({ id: 1, status: 'Nova', tracker: 'Bug', assignee: 'Ana' }),
        issue({ id: 2, closed: true }),
      ],
      versions: [],
      now: NOW,
    });
    expect(r.openList).toHaveLength(1);
    expect(r.openList[0]).toMatchObject({ id: 1, status: 'Nova', tracker: 'Bug', assignee: 'Ana' });
  });
});

// ── Dashboard pessoal ──
const myIssue = (o = {}) => ({
  id: o.id ?? Math.floor(Math.random() * 1e6),
  subject: 't',
  status: { name: o.status || (o.closed_on ? 'Fechada' : 'Nova') },
  created_on: o.created_on,
  closed_on: o.closed_on,
  due_date: o.due_date,
});

describe('weekStartMonday', () => {
  it('resolve a segunda-feira da semana', () => {
    // 2026-07-14 é uma terça; a segunda é 2026-07-13.
    expect(ymd(weekStartMonday(new Date(2026, 6, 14)))).toBe('2026-07-13');
    // Domingo 2026-07-12 pertence à semana que começa em 2026-07-06.
    expect(ymd(weekStartMonday(new Date(2026, 6, 12)))).toBe('2026-07-06');
  });
});

describe('computeMe', () => {
  it('separa abertas / em andamento / vencidas com suas listas', () => {
    const r = computeMe({
      myOpen: [
        myIssue({ id: 1, status: 'Nova' }),
        myIssue({ id: 2, status: 'Em andamento' }),
        myIssue({ id: 3, status: 'Nova', due_date: '2026-07-01' }), // vencida
      ],
      myClosed: [],
      now: NOW,
    });
    expect(r.kpis.open.count).toBe(3);
    expect(r.kpis.inProgress.count).toBe(1);
    expect(r.kpis.inProgress.issues[0].id).toBe(2);
    expect(r.kpis.overdue.count).toBe(1);
    expect(r.kpis.overdue.issues[0].id).toBe(3);
  });

  it('conta throughput por semana pelas fechadas', () => {
    const r = computeMe({
      myOpen: [],
      myClosed: [
        myIssue({ closed_on: '2026-07-13T10:00:00Z' }), // semana atual (seg 13)
        myIssue({ closed_on: '2026-07-14T10:00:00Z' }), // mesma semana
        myIssue({ closed_on: '2026-07-07T10:00:00Z' }), // semana anterior (seg 06)
      ],
      now: NOW,
      weeks: 8,
    });
    expect(r.weeks).toHaveLength(8);
    const last = r.weeks[r.weeks.length - 1];
    expect(last.key).toBe('2026-07-13');
    expect(last.closed).toBe(2);
    expect(r.weeks[r.weeks.length - 2].closed).toBe(1); // semana de 06
  });

  it('calcula ciclo médio e mediana das fechadas', () => {
    const r = computeMe({
      myOpen: [],
      myClosed: [
        myIssue({ created_on: '2026-07-01T00:00:00Z', closed_on: '2026-07-03T00:00:00Z' }), // 2d
        myIssue({ created_on: '2026-07-01T00:00:00Z', closed_on: '2026-07-05T00:00:00Z' }), // 4d
        myIssue({ created_on: '2026-07-01T00:00:00Z', closed_on: '2026-07-07T00:00:00Z' }), // 6d
      ],
      now: NOW,
    });
    expect(r.cycle.count).toBe(3);
    expect(r.cycle.avg).toBe(4);
    expect(r.cycle.median).toBe(4);
  });

  it('mede cumprimento de prazo próprio', () => {
    const r = computeMe({
      myOpen: [],
      myClosed: [
        myIssue({ due_date: '2026-07-10', closed_on: '2026-07-09T00:00:00Z' }), // no prazo
        myIssue({ due_date: '2026-07-10', closed_on: '2026-07-14T00:00:00Z' }), // 4d atraso
      ],
      now: NOW,
    });
    expect(r.onTime.closedWithDue).toBe(2);
    expect(r.onTime.rate).toBe(50);
    expect(r.onTime.avgLateDays).toBe(4);
  });
});
