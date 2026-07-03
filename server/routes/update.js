// Endpoints de auto-update (autenticados). Inertes se UPDATE_MANIFEST_URL não
// estiver definido — status() devolve { enabled:false } e download/apply recusam.
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const updater = require('../services/updater');

router.get(
  '/update/status',
  handle(async (req, res) => {
    res.json(await updater.status());
  }),
);

// Baixa e verifica (SHA-256) o novo executável, deixando-o pronto para aplicar.
router.post(
  '/update/download',
  handle(async (req, res) => {
    res.json(await updater.download());
  }),
);

// Aplica a atualização baixada: troca o .exe e relança (encerra este processo).
router.post(
  '/update/apply',
  handle(async (req, res) => {
    const out = updater.apply();
    res.json(out);
  }),
);

module.exports = router;
