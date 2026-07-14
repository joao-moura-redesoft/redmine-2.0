// AUTOMAÇÕES — CRUD dos workflows (grafos gatilho→filtro→ação) por usuário.
// A execução (detecção de eventos + disparo de ações) vive no motor de polling
// (server/services/workflowEngine.js, Fase 2). Aqui só persistimos as definições.
const express = require('express');
const router = express.Router();
const { getMyUserId } = require('../lib/redmine');
const handle = require('../lib/handle');
const { listWorkflows, upsertWorkflow, deleteWorkflow } = require('../services/workflowStore');
const { listRuns } = require('../services/workflowRuns');

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const KINDS = new Set(['trigger', 'filter', 'action', 'branch']);
const strIds = (v) => (Array.isArray(v) ? v.filter((id) => typeof id === 'string') : []);

// Normaliza um nó vindo do cliente para o shape canônico, descartando lixo.
function sanitizeNode(n) {
  if (!n || typeof n !== 'object') return null;
  const kind = KINDS.has(n.kind) ? n.kind : 'action';
  const pos = n.position && typeof n.position === 'object' ? n.position : {};
  const node = {
    id: typeof n.id === 'string' && n.id ? n.id : newId(),
    kind,
    type: typeof n.type === 'string' ? n.type : '',
    config: n.config && typeof n.config === 'object' ? n.config : {},
    position: {
      x: Number.isFinite(pos.x) ? pos.x : 0,
      y: Number.isFinite(pos.y) ? pos.y : 0,
    },
    nextIds: strIds(n.nextIds),
  };
  // Ramo "falso" só faz sentido em nós branch (Se/senão).
  if (kind === 'branch') node.elseIds = strIds(n.elseIds);
  return node;
}

function sanitizeNodes(nodes) {
  return Array.isArray(nodes) ? nodes.map(sanitizeNode).filter(Boolean) : [];
}

// Aplica os campos editáveis do body sobre um workflow (parcial ou total).
function applyPatch(wf, b) {
  if (typeof b.name === 'string') wf.name = b.name;
  if (typeof b.enabled === 'boolean') wf.enabled = b.enabled;
  if ('nodes' in b) wf.nodes = sanitizeNodes(b.nodes);
  wf.updatedAt = Date.now();
  return wf;
}

router.get(
  '/workflows',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json(listWorkflows(uid));
  }),
);

router.post(
  '/workflows',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const b = req.body || {};
    const now = Date.now();
    const wf = {
      id: typeof b.id === 'string' && b.id ? b.id : newId(),
      name: typeof b.name === 'string' && b.name ? b.name : 'Nova automação',
      enabled: typeof b.enabled === 'boolean' ? b.enabled : false,
      nodes: sanitizeNodes(b.nodes),
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    };
    upsertWorkflow(uid, wf);
    res.json(wf);
  }),
);

router.put(
  '/workflows/:id',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const wf = listWorkflows(uid).find((w) => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'automação não encontrada' });
    applyPatch(wf, req.body || {});
    upsertWorkflow(uid, wf);
    res.json(wf);
  }),
);

router.delete(
  '/workflows/:id',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    deleteWorkflow(uid, req.params.id);
    res.json({ ok: true });
  }),
);

// Histórico de execução de uma automação (últimas execuções + resultado por ação).
router.get(
  '/workflows/:id/runs',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json(listRuns(uid, req.params.id));
  }),
);

// Credenciais headless a partir dos headers injetados pelo authMiddleware.
const recFromReq = (req, uid) => ({
  uid,
  url: req.headers['x-redmine-url'],
  key: req.headers['x-redmine-key'] || '',
  username: req.headers['x-redmine-user'] || '',
  password: req.headers['x-redmine-pass'] || '',
});

// Teste manual: executa o grafo com um contexto de exemplo (ignora filtros e não
// escreve em tarefas reais) para validar as ações sem esperar um evento real.
router.post(
  '/workflows/:id/run',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const wf = listWorkflows(uid).find((w) => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'automação não encontrada' });

    const { runWorkflowManual } = require('../services/workflowEngine');
    const { getSubscriptions, sendPush } = require('../services/push');
    await runWorkflowManual(uid, wf, recFromReq(req, uid), sendPush, getSubscriptions());
    res.json({ ok: true });
  }),
);

// Execução manual REAL (gatilho workflow.manual): respeita filtros e EXECUTA as
// ações de verdade. Diferente do /run (que ignora filtros e não escreve). Aceita
// um issueId opcional quando lançada a partir de um card da tarefa.
router.post(
  '/workflows/:id/trigger',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const wf = listWorkflows(uid).find((w) => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'automação não encontrada' });

    const { runWorkflowNow } = require('../services/workflowEngine');
    const { getSubscriptions, sendPush } = require('../services/push');
    const issueId = Number(req.body?.issueId) || undefined;
    await runWorkflowNow(uid, wf, recFromReq(req, uid), sendPush, getSubscriptions(), { issueId });
    res.json({ ok: true });
  }),
);

// Prévia da varredura: avalia as CONDIÇÕES contra as tarefas reais SEM executar
// nenhuma ação e sem tocar o estado do motor. É o inverso do /run.
router.post(
  '/workflows/:id/preview',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const wf = listWorkflows(uid).find((w) => w.id === req.params.id);
    if (!wf) return res.status(404).json({ error: 'automação não encontrada' });

    const { previewScan } = require('../services/workflowEngine');
    res.json(await previewScan(uid, wf, recFromReq(req, uid)));
  }),
);

module.exports = router;
