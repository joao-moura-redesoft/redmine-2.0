// Histórico de execução das automações, por usuário (últimas N execuções).
// Cada entrada resume um disparo: gatilho, quando, e o resultado de cada ação.
// Cifrado (pode referenciar dados das tarefas do usuário). Anel limitado por uid.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const RUNS_FILE = dataFile('workflow-runs.json');
let store = readJsonSecure(RUNS_FILE, {}); // { [uid]: RunEntry[] } (mais recente primeiro)
const MAX_PER_UID = 50;

// Registra uma execução no topo da lista do usuário (poda o excedente).
function record(uid, entry) {
  if (!store[uid]) store[uid] = [];
  store[uid].unshift(entry);
  if (store[uid].length > MAX_PER_UID) store[uid].length = MAX_PER_UID;
  try {
    writeJsonSecure(RUNS_FILE, store, { requireEncryption: true });
  } catch (e) {
    console.error('[workflow] falha ao persistir run log:', e.message);
  }
}

// Execuções de um usuário, opcionalmente filtradas por workflow.
function listRuns(uid, workflowId) {
  const all = store[uid] || [];
  return workflowId ? all.filter((r) => r.workflowId === workflowId) : all;
}

module.exports = { record, listRuns };
