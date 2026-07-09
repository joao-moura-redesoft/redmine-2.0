// EVENTOS LOCAIS — reuniões/blocos do calendário persistidos por usuário do
// Redmine (não sincronizam com o Zimbra). Complementa a agenda Zimbra para o
// caso "sem e-mail" ou compromissos pessoais/informais.
const express = require('express');
const router = express.Router();
const { getMyUserId } = require('../lib/redmine');
const handle = require('../lib/handle');
const { listEvents, addEvent, removeEvent } = require('../services/eventsStore');

// Eventos numa janela [start, end] (epoch ms). Sem janela: todos.
router.get(
  '/events',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json({ events: listEvents(uid, { start: req.query.start, end: req.query.end }) });
  }),
);

router.post(
  '/events',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json(addEvent(uid, req.body || {}));
  }),
);

router.delete(
  '/events/:id',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    removeEvent(uid, req.params.id);
    res.json({ ok: true });
  }),
);

module.exports = router;
