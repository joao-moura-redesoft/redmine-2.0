// Endpoints de Web Push: chave pública VAPID, inscrição e cancelamento.
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const { getVapidPublicKey, subscribe, unsubscribe } = require('../services/push');

router.get('/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post(
  '/push/subscribe',
  handle(async (req, res) => {
    await subscribe(req);
    res.json({ success: true });
  }),
);

router.post(
  '/push/unsubscribe',
  handle(async (req, res) => {
    unsubscribe(req);
    res.json({ success: true });
  }),
);

module.exports = router;
