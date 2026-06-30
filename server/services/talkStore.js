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

module.exports = { getTalkAuth, saveTalkAuth, clearTalkAuth };
