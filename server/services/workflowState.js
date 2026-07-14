// Estado do motor de automações, por usuário. Guarda:
// - issues:   snapshot dos campos de cada tarefa (detectar status/responsável mudou);
// - talkSeen: último id de mensagem visto por sala (detectar mensagem nova);
// - lastScheduleRuns: último disparo de cada gatilho `schedule` (dedup temporal);
// - scanFired: { [wfId]: { [issueId]: ts } } — quando cada varredura já agiu
//   sobre cada tarefa (políticas 'once' e 'cooldown');
// - pending: esperas (nó Delay) a retomar — { id, wfId, resumeAt, nodeIds, ctx };
// - flags de "inicializado" para não disparar retroativamente no primeiro tick.
//
// O dedup de eventos vem naturalmente do snapshot-diff / talkSeen (um evento só é
// emitido quando o campo muda de fato), então não guardamos "firedKeys".
//
// Cifrado: pode conter ids/estado ligado às tarefas do usuário.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const STATE_FILE = dataFile('workflow-state.json');
let store = readJsonSecure(STATE_FILE, {}); // { [uid]: State }

function getState(uid) {
  if (!store[uid]) {
    store[uid] = {
      issues: {},
      issuesInit: false,
      talkSeen: {},
      talkInit: false,
      lastScheduleRuns: {},
      scanFired: {},
      failStreak: {},
      pending: [],
      roundRobin: {}, // { [nodeId]: índice } — ação issue.assign_next
      timers: {}, // { [nodeId:issueId]: startTs } — ação time.log_timer
      appStartup: {}, // { [wfId]: bootTs } — gatilho app.startup (uma vez por boot)
      emailSeenId: 0, // maior id de e-mail já visto — gatilho email.received
      emailInit: false,
    };
  }
  // Backfill para estados gravados antes destes campos existirem.
  if (!store[uid].scanFired) store[uid].scanFired = {};
  if (!store[uid].failStreak) store[uid].failStreak = {};
  if (!store[uid].pending) store[uid].pending = [];
  if (!store[uid].roundRobin) store[uid].roundRobin = {};
  if (!store[uid].timers) store[uid].timers = {};
  if (!store[uid].appStartup) store[uid].appStartup = {};
  return store[uid];
}

// Em loop de polling: nunca deixa erro de criptografia virar unhandledRejection.
function saveState() {
  try {
    writeJsonSecure(STATE_FILE, store, { requireEncryption: true });
  } catch (e) {
    console.error('[workflow] falha ao persistir estado:', e.message);
  }
}

module.exports = { getState, saveState };
