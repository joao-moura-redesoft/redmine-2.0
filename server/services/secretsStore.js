// Cofre de segredos por usuário, cifrado em repouso (DPAPI via secureStore).
// Substitui o armazenamento em localStorage do cliente para: credenciais AD
// (wiki/e-mail), chaves de provedores de IA e sementes TOTP.
//
// Estrutura: { [redmineUserId]: { ad?: {user,pass}, ai?: {anthropic,openai,gemini}, totp?: [{id,name,secret}] } }
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const SECRETS_FILE = dataFile('secrets.json');
let store = readJsonSecure(SECRETS_FILE, {});
const save = () => writeJsonSecure(SECRETS_FILE, store);

function bucket(uid) {
  return store[uid] || {};
}

function setField(uid, field, value) {
  store[uid] = { ...(store[uid] || {}), [field]: value };
  save();
}

function clearField(uid, field) {
  if (store[uid] && field in store[uid]) {
    delete store[uid][field];
    if (Object.keys(store[uid]).length === 0) delete store[uid];
    save();
  }
}

// ── Credenciais AD (wiki/e-mail) — { user, pass } ───────────────────────────
const getAd = (uid) => bucket(uid).ad || null;
const saveAd = (uid, ad) => setField(uid, 'ad', ad);
const clearAd = (uid) => clearField(uid, 'ad');

// ── Chaves de IA — { anthropic?, openai?, gemini? } ─────────────────────────
const getAi = (uid) => bucket(uid).ai || {};
function saveAiKey(uid, provider, key) {
  const ai = { ...getAi(uid) };
  if (key) ai[provider] = key; else delete ai[provider];
  setField(uid, 'ai', ai);
}

// ── TOTP — [{ id, name, secret }] ───────────────────────────────────────────
const getTotp = (uid) => bucket(uid).totp || [];
const setTotp = (uid, list) => setField(uid, 'totp', list);

module.exports = {
  getAd, saveAd, clearAd,
  getAi, saveAiKey,
  getTotp, setTotp,
};
