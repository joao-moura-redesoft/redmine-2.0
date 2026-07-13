import { describe, it, expect, beforeAll } from 'vitest';

// Chave do cofre via env (o secureStore carrega no boot) — evita DPAPI/Windows.
process.env.BLUEMINE_VAULT_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.K86_ENABLED = '0'; // garante que a ação k86.screen é no-op (sem HTTP)

// Teste de INTEGRAÇÃO da caminhada no grafo (runGraph): filtro para/segue, branch
// escolhe o ramo, wait agenda a retomada, e o rastro (run.nodes) é preenchido.
// Usa a ação 'k86.screen' porque ela é no-op quando K86_ENABLED!=1 — assim o
// execAction REAL roda sem tocar em rede nem disco.
let runGraph;
beforeAll(async () => {
  ({ runGraph } = await import('./workflowEngine.js'));
});

const rec = { uid: 337, url: '', key: '', username: '', password: '' };
const noop = () => {};
const run = () => ({ actions: [] });
const ctx = (over = {}) => ({
  issue: { id: 1, subject: 'X', status: { id: 3 } },
  event: { type: 'status_changed' },
  user: { id: 337 },
  now: new Date().toISOString(),
  ...over,
});

const trigger = { id: 't', kind: 'trigger', type: 'issue.status_changed', nextIds: [] };
const k86 = (id, nextIds = []) => ({
  id,
  kind: 'action',
  type: 'k86.screen',
  config: { title: id },
  nextIds,
});
const filter = (id, value, nextIds) => ({
  id,
  kind: 'filter',
  type: 'filter',
  config: { op: 'and', rules: [{ field: 'status', operand: 'eq', value }] },
  nextIds,
});

describe('runGraph — filtro', () => {
  it('segue quando a condição passa', async () => {
    const wf = {
      id: 'w',
      nodes: [{ ...trigger, nextIds: ['f'] }, filter('f', '3', ['a']), k86('a')],
    };
    const r = run();
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r });
    expect(r.actions.map((a) => a.type)).toEqual(['k86.screen']);
    expect(r.nodes.f).toBe('passed');
    expect(r.nodes.a).toBe('ok');
  });

  it('para o ramo quando a condição falha (ação não roda)', async () => {
    const wf = {
      id: 'w',
      nodes: [{ ...trigger, nextIds: ['f'] }, filter('f', '9', ['a']), k86('a')],
    };
    const r = run();
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r });
    expect(r.actions).toEqual([]);
    expect(r.nodes.f).toBe('stopped');
    expect(r.nodes.a).toBeUndefined();
  });
});

describe('runGraph — branch (Se/senão)', () => {
  const branch = (value) => ({
    id: 'b',
    kind: 'branch',
    type: 'if',
    config: { op: 'and', rules: [{ field: 'status', operand: 'eq', value }] },
    nextIds: ['at'],
    elseIds: ['af'],
  });
  const build = (value) => ({
    id: 'w',
    nodes: [{ ...trigger, nextIds: ['b'] }, branch(value), k86('at'), k86('af')],
  });

  it('toma o ramo verdadeiro', async () => {
    const wf = build('3'); // status === 3 → verdadeiro
    const r = run();
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r });
    expect(r.nodes.b).toBe('true');
    expect(r.nodes.at).toBe('ok');
    expect(r.nodes.af).toBeUndefined();
  });

  it('toma o ramo falso', async () => {
    const wf = build('9'); // status !== 9 → falso
    const r = run();
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r });
    expect(r.nodes.b).toBe('false');
    expect(r.nodes.af).toBe('ok');
    expect(r.nodes.at).toBeUndefined();
  });
});

describe('runGraph — nó de Espera (Delay)', () => {
  const wait = {
    id: 'wt',
    kind: 'action',
    type: 'wait',
    config: { amount: 5, unit: 'minutes' },
    nextIds: ['a'],
  };
  const wf = { id: 'w', nodes: [{ ...trigger, nextIds: ['wt'] }, wait, k86('a')] };

  it('agenda a retomada e PARA o ramo (ação seguinte não roda)', async () => {
    const r = run();
    const t0 = Date.now();
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r });

    // a ação depois do wait NÃO rodou
    expect(r.actions.map((a) => a.type)).toEqual(['wait']);
    expect(r.nodes.a).toBeUndefined();

    // uma espera foi agendada, com os nós a retomar e o horário correto (~5min)
    expect(r.pending).toHaveLength(1);
    const p = r.pending[0];
    expect(p.wfId).toBe('w');
    expect(p.nodeIds).toEqual(['a']);
    expect(p.resumeAt - t0).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(p.resumeAt - t0).toBeLessThan(5 * 60 * 1000 + 5000);
  });

  it('RETOMA a partir dos nós salvos (startIds) — a ação então roda', async () => {
    const r = run();
    // simula o processResumes: continua do nó após o wait
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r, startIds: ['a'] });
    expect(r.actions.map((a) => a.type)).toEqual(['k86.screen']);
    expect(r.nodes.a).toBe('ok');
    expect(r.pending).toBeUndefined(); // não agenda nova espera na retomada
  });

  it('em teste manual (bypassFilters) o wait passa direto, sem agendar', async () => {
    const r = run();
    await runGraph(wf, wf.nodes[0], ctx(), rec, noop, [], { run: r, bypassFilters: true });
    expect(r.actions.map((a) => a.type)).toEqual(['k86.screen']); // seguiu direto
    expect(r.pending).toBeUndefined();
  });
});
