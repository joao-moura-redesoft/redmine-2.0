// Store de sessões por token: mapeia token aleatório → payload de credenciais.
// Usado pelo proxy de anexos do Redmine (kind:'redmine') e do Zimbra (kind:'mail')
// para isolar credenciais por usuário, eliminando variáveis globais lastAuth/lastMailCreds.
const crypto = require('crypto');

const REDMINE_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
const MAIL_TTL_MS = 60 * 60 * 1000; // 1 hora — suficiente para baixar anexos

const store = new Map(); // token → { kind, ...creds, expiresAt }

function createSession(payload, ttlMs = REDMINE_TTL_MS) {
  const token = crypto.randomBytes(24).toString('hex');
  store.set(token, { ...payload, expiresAt: Date.now() + ttlMs });
  return token;
}

// kind opcional: se fornecido, rejeita sessões de outro tipo (evita cross-use).
function getSession(token, kind) {
  if (!token) return null;
  const s = store.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    store.delete(token);
    return null;
  }
  if (kind && s.kind !== kind) return null;
  return s;
}

// Limpeza periódica de sessões expiradas
setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expiresAt) store.delete(k);
  },
  30 * 60 * 1000,
).unref();

module.exports = { createSession, getSession, REDMINE_TTL_MS, MAIL_TTL_MS };
