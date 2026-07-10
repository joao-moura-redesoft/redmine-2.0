const axios = require('axios');
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const TALK_FILE = dataFile('talk.json');
let talkStore = readJsonSecure(TALK_FILE, {}); // { [userId]: { url, user, token } }
// requireEncryption: guarda credenciais/token do Nextcloud — nunca em texto puro.
const saveTalkStore = () => writeJsonSecure(TALK_FILE, talkStore, { requireEncryption: true });

function getTalkAuth(userId) {
  return talkStore[userId] || null;
}

function saveTalkAuth(userId, auth) {
  talkStore[userId] = auth;
  saveTalkStore();
}

function clearTalkAuth(userId) {
  delete talkStore[userId];
  saveTalkStore();
}

// Envia uma mensagem numa sala do Talk em nome do usuário (headless, sem `req`).
// Reaproveita as credenciais do cofre (getTalkAuth) e o mesmo endpoint do chat do
// Nextcloud Talk (spreed). No-op silencioso se o usuário não tem Talk configurado.
async function sendTalkMessage(userId, roomToken, text) {
  const auth = getTalkAuth(userId);
  if (!(auth?.url && auth?.user && auth?.token)) {
    console.warn('[talk] sendTalkMessage: sem credenciais para uid', userId);
    return false;
  }
  if (!roomToken || !text) return false;
  const client = axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
  });
  await client.post(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(roomToken)}?format=json`,
    { message: String(text) },
  );
  return true;
}

module.exports = { getTalkAuth, saveTalkAuth, clearTalkAuth, sendTalkMessage };
