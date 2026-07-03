// Endpoints para gerenciar segredos por usuário (cofre cifrado server-side).
// Cobre credenciais AD (wiki/e-mail), chaves de IA e contas TOTP. O cliente
// nunca recebe de volta os segredos em si — apenas status e códigos derivados.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const handle = require('../lib/handle');
const { getMyUserId } = require('../lib/redmine');
const { generateTOTP, totpRemaining } = require('../lib/totp');
const {
  getAd,
  saveAd,
  clearAd,
  getAi,
  saveAiKey,
  getTotp,
  setTotp,
} = require('../services/secretsStore');

async function uidOf(req, res) {
  const uid = await getMyUserId(req);
  if (!uid) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }
  return uid;
}

// ── Status: o que está configurado (sem expor os segredos) ──────────────────
router.get(
  '/secrets/status',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    const ai = getAi(uid);
    res.json({
      ad: !!getAd(uid),
      ai: {
        anthropic: !!ai.anthropic,
        openai: !!ai.openai,
        gemini: !!ai.gemini,
        local: !!ai.local,
      },
      totpCount: getTotp(uid).length,
    });
  }),
);

// ── Credenciais AD (wiki/e-mail) ────────────────────────────────────────────
router.put(
  '/secrets/ad',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    const { user, pass } = req.body || {};
    if (!user || !pass) return res.status(400).json({ error: 'user e pass obrigatórios' });
    saveAd(uid, { user, pass });
    res.json({ success: true });
  }),
);

router.delete(
  '/secrets/ad',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    clearAd(uid);
    res.json({ success: true });
  }),
);

// ── Chaves de IA ────────────────────────────────────────────────────────────
// 'local' = servidor OpenAI-compatible on-prem (Ollama/vLLM/LM Studio). A "key"
// pode ser um token qualquer (ou o sentinela 'local' quando o servidor não exige).
const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'local'];

router.put(
  '/secrets/ai/:provider',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    const { provider } = req.params;
    if (!AI_PROVIDERS.includes(provider))
      return res.status(400).json({ error: 'provider inválido' });
    const key = (req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key obrigatória' });
    saveAiKey(uid, provider, key);
    res.json({ success: true });
  }),
);

router.delete(
  '/secrets/ai/:provider',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    const { provider } = req.params;
    if (!AI_PROVIDERS.includes(provider))
      return res.status(400).json({ error: 'provider inválido' });
    saveAiKey(uid, provider, null);
    res.json({ success: true });
  }),
);

// ── TOTP ─────────────────────────────────────────────────────────────────────
// Lista as contas com o código atual já calculado (a semente fica no servidor).
router.get(
  '/secrets/totp',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    const accounts = getTotp(uid).map((a) => {
      let code = '------';
      try {
        code = generateTOTP(a.secret);
      } catch {
        /* semente inválida */
      }
      return { id: a.id, name: a.name, code };
    });
    res.json({ accounts, remaining: totpRemaining() });
  }),
);

router.post(
  '/secrets/totp',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    const name = (req.body?.name || '').trim();
    const secret = (req.body?.secret || '').replace(/\s/g, '');
    if (!name || !secret) return res.status(400).json({ error: 'name e secret obrigatórios' });
    // Valida a semente gerando um código.
    try {
      generateTOTP(secret);
    } catch {
      return res.status(400).json({ error: 'semente inválida' });
    }
    const list = getTotp(uid);
    list.push({ id: crypto.randomUUID(), name, secret });
    setTotp(uid, list);
    res.json({ success: true });
  }),
);

router.delete(
  '/secrets/totp/:id',
  handle(async (req, res) => {
    const uid = await uidOf(req, res);
    if (!uid) return;
    setTotp(
      uid,
      getTotp(uid).filter((a) => a.id !== req.params.id),
    );
    res.json({ success: true });
  }),
);

module.exports = router;
