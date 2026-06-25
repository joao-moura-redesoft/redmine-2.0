// SPRINTS — agrupamento pessoal de tarefas (Opção B), persistido por usuário.
// A sprint vive só no Bluemine; guarda IDs de issue de qualquer projeto.
const express = require('express');
const router = express.Router();
const { getMyUserId } = require('../lib/redmine');
const handle = require('../lib/handle');
const { userSprints, saveSprints, removeSprint } = require('../services/sprintsStore');

const STATUSES = ['planned', 'active', 'closed'];

// Normaliza uma lista de IDs de issue: inteiros positivos, únicos, na ordem dada.
function cleanIssueIds(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// Aplica os campos editáveis de `body` sobre `sprint` (apenas os presentes).
function applyFields(sprint, b) {
  if (typeof b.name === 'string') sprint.name = b.name.slice(0, 200);
  if (typeof b.goal === 'string') sprint.goal = b.goal.slice(0, 1000);
  if (b.startDate === null || typeof b.startDate === 'string') sprint.startDate = b.startDate || null;
  if (b.endDate === null || typeof b.endDate === 'string') sprint.endDate = b.endDate || null;
  if (typeof b.status === 'string' && STATUSES.includes(b.status)) sprint.status = b.status;
  // boardId: id do "projeto" pessoal (board) ao qual a sprint pertence (ou null).
  if (b.boardId === null || typeof b.boardId === 'string') sprint.boardId = b.boardId || null;
  if ('issueIds' in b) sprint.issueIds = cleanIssueIds(b.issueIds);
}

router.get('/sprints', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  res.json(userSprints(uid));
}));

router.post('/sprints', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const now = Date.now();
  const b = req.body || {};
  const sprint = {
    id: (typeof b.id === 'string' && b.id && !userSprints(uid).some(s => s.id === b.id))
      ? b.id
      : `${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    goal: '',
    startDate: null,
    endDate: null,
    status: 'planned',
    boardId: null,
    issueIds: [],
    createdAt: now,
    updatedAt: now,
  };
  applyFields(sprint, b);
  userSprints(uid).push(sprint); // nova sprint vai para o fim (direita da raia)
  saveSprints();
  res.json(sprint);
}));

// Reordena as sprints do usuário conforme a lista de ids. DEVE vir antes de
// '/sprints/:id' senão o :id captura "order".
router.put('/sprints/order', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  const rank = (s) => (pos.has(s.id) ? pos.get(s.id) : Number.MAX_SAFE_INTEGER);
  userSprints(uid).sort((a, b) => rank(a) - rank(b));
  saveSprints();
  res.json(userSprints(uid));
}));

router.put('/sprints/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const sprint = userSprints(uid).find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'sprint não encontrada' });
  applyFields(sprint, req.body || {});
  sprint.updatedAt = Date.now();
  saveSprints();
  res.json(sprint);
}));

router.delete('/sprints/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  removeSprint(uid, req.params.id);
  res.json({ ok: true });
}));

// Adiciona uma tarefa à sprint. Regra: 1 tarefa = 1 sprint — remove de qualquer
// outra sprint do mesmo usuário antes de inserir.
router.post('/sprints/:id/issues', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const sprints = userSprints(uid);
  const sprint = sprints.find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'sprint não encontrada' });
  const issueId = Number(req.body?.issueId);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    return res.status(400).json({ error: 'issueId inválido' });
  }
  for (const s of sprints) {
    if (s.id !== sprint.id && s.issueIds.includes(issueId)) {
      s.issueIds = s.issueIds.filter(id => id !== issueId);
      s.updatedAt = Date.now();
    }
  }
  if (!sprint.issueIds.includes(issueId)) {
    sprint.issueIds.push(issueId);
    sprint.updatedAt = Date.now();
  }
  saveSprints();
  res.json(sprint);
}));

router.delete('/sprints/:id/issues/:issueId', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const sprint = userSprints(uid).find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'sprint não encontrada' });
  const issueId = Number(req.params.issueId);
  sprint.issueIds = sprint.issueIds.filter(id => id !== issueId);
  sprint.updatedAt = Date.now();
  saveSprints();
  res.json(sprint);
}));

module.exports = router;
