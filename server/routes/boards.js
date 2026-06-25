// BOARDS — "projetos" pessoais que agrupam sprints em raias. Por-usuário.
const express = require('express');
const router = express.Router();
const { getMyUserId } = require('../lib/redmine');
const handle = require('../lib/handle');
const { userBoards, saveBoards, removeBoard } = require('../services/boardsStore');
const { userSprints, saveSprints } = require('../services/sprintsStore');

function applyFields(board, b) {
  if (typeof b.name === 'string') board.name = b.name.slice(0, 120);
  if (b.color === null || typeof b.color === 'string') board.color = b.color || null;
}

router.get('/boards', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  res.json(userBoards(uid));
}));

router.post('/boards', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const now = Date.now();
  const b = req.body || {};
  const board = {
    id: (typeof b.id === 'string' && b.id && !userBoards(uid).some(x => x.id === b.id))
      ? b.id
      : `${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    color: null,
    createdAt: now,
    updatedAt: now,
  };
  applyFields(board, b);
  userBoards(uid).push(board);
  saveBoards();
  res.json(board);
}));

router.put('/boards/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const board = userBoards(uid).find(x => x.id === req.params.id);
  if (!board) return res.status(404).json({ error: 'projeto não encontrado' });
  applyFields(board, req.body || {});
  board.updatedAt = Date.now();
  saveBoards();
  res.json(board);
}));

router.delete('/boards/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  removeBoard(uid, req.params.id);
  // Sprints do board excluído voltam para "Sem projeto" (boardId = null).
  let touched = false;
  for (const s of userSprints(uid)) {
    if (s.boardId === req.params.id) { s.boardId = null; s.updatedAt = Date.now(); touched = true; }
  }
  if (touched) saveSprints();
  res.json({ ok: true });
}));

module.exports = router;
