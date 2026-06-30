// JITSI — presença das salas de vídeo da War Room (badge AO VIVO + auto-logging).
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const presence = require('../services/jitsiPresence');

// Credenciais do Redmine vindas dos headers do request (mesmo esquema do lib/redmine).
function authFromReq(req) {
  return {
    url: req.headers['x-redmine-url'] || '',
    key: req.headers['x-redmine-key'] || '',
    user: req.headers['x-redmine-user'] || '',
    pass: req.headers['x-redmine-pass'] || '',
  };
}

// Heartbeat: entra na sala e mantém presença viva (chamado periodicamente).
router.post(
  '/jitsi/presence/heartbeat',
  handle(async (req, res) => {
    const { room, displayName } = req.body || {};
    if (!room) return res.status(400).json({ error: 'room obrigatório' });
    presence.touch(room, displayName, authFromReq(req));
    res.json({ ok: true });
  }),
);

// Saída explícita; se a sala esvaziar, dispara o auto-logging no Redmine.
router.post(
  '/jitsi/presence/leave',
  handle(async (req, res) => {
    const { room, displayName } = req.body || {};
    if (!room) return res.status(400).json({ error: 'room obrigatório' });
    await presence.leave(room, displayName, authFromReq(req));
    res.json({ ok: true });
  }),
);

// Salas ativas (consumido pelo polling do frontend para o badge AO VIVO).
router.get(
  '/jitsi/presence',
  handle(async (req, res) => {
    res.json({ rooms: presence.activeRooms() });
  }),
);

module.exports = router;
