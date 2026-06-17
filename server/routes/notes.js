// NOTAS — bloco de notas pessoal, persistido por usuário do Redmine.
const express = require('express');
const router = express.Router();
const { getMyUserId } = require('../lib/redmine');
const handle = require('../lib/handle');
const { userNotes, saveNotes, removeNote } = require('../services/notesStore');

const NOTE_FIELDS = ['title', 'body', 'tags', 'pinned', 'color', 'linkedIssueId', 'linkedProjectId'];

router.get('/notes', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  res.json(userNotes(uid));
}));

router.post('/notes', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const now = Date.now();
  const b = req.body || {};
  const note = {
    id: (typeof b.id === 'string' && b.id && !userNotes(uid).some(n => n.id === b.id))
      ? b.id
      : `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: typeof b.title === 'string' ? b.title : '',
    body: typeof b.body === 'string' ? b.body : '',
    tags: Array.isArray(b.tags) ? b.tags.filter(t => typeof t === 'string') : [],
    pinned: !!b.pinned,
    color: typeof b.color === 'string' ? b.color : null,
    linkedIssueId: Number.isInteger(b.linkedIssueId) ? b.linkedIssueId : null,
    linkedProjectId: Number.isInteger(b.linkedProjectId) ? b.linkedProjectId : null,
    createdAt: now,
    updatedAt: now,
  };
  userNotes(uid).unshift(note);
  saveNotes();
  res.json(note);
}));

router.put('/notes/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const note = userNotes(uid).find(n => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'nota não encontrada' });
  const b = req.body || {};
  for (const k of NOTE_FIELDS) if (k in b) note[k] = b[k];
  note.updatedAt = Date.now();
  saveNotes();
  res.json(note);
}));

router.delete('/notes/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  removeNote(uid, req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
