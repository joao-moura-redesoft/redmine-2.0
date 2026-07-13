// Rotas do digest diário: ver o último resumo (GET /latest) e gerar na hora
// (POST /run). O agendamento automático fica no push.js; aqui é sob demanda.
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const { getMyUserId } = require('../lib/redmine');
const digest = require('../services/digest');

router.get(
  '/digest/latest',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json(uid ? digest.getLatest(uid) : null);
  }),
);

router.post(
  '/digest/run',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const rec = {
      url: req.headers['x-redmine-url'],
      key: req.headers['x-redmine-key'] || '',
      username: req.headers['x-redmine-user'] || '',
      password: req.headers['x-redmine-pass'] || '',
      uid,
    };
    if (!rec.url)
      throw Object.assign(new Error('credenciais do Redmine ausentes'), { statusCode: 400 });
    const { result } = await digest.build(rec);
    res.json(result);
  }),
);

module.exports = router;
