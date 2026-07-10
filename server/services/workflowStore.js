// Automações ("Workflows") — motor de automação por usuário do Redmine.
// Cada regra é um grafo { trigger → filter → action } definido no editor visual.
// Persistido por usuário, CIFRADO (requireEncryption): regras podem embutir URLs
// de webhook, destinatários de e-mail e outros dados sensíveis.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const WORKFLOWS_FILE = dataFile('workflows.json');
let workflowsStore = readJsonSecure(WORKFLOWS_FILE, {}); // { [userId]: Workflow[] }
const saveWorkflows = () =>
  writeJsonSecure(WORKFLOWS_FILE, workflowsStore, { requireEncryption: true });

// Array de workflows do usuário (cria vazio na primeira vez).
function listWorkflows(userId) {
  if (!workflowsStore[userId]) workflowsStore[userId] = [];
  return workflowsStore[userId];
}

// Insere ou atualiza um workflow (por id) preservando createdAt/runCount.
function upsertWorkflow(userId, wf) {
  const arr = listWorkflows(userId);
  const idx = arr.findIndex((w) => w.id === wf.id);
  if (idx === -1) arr.unshift(wf);
  else arr[idx] = wf;
  saveWorkflows();
  return wf;
}

// Remove um workflow do usuário (reatribui o array filtrado no store).
function deleteWorkflow(userId, id) {
  workflowsStore[userId] = listWorkflows(userId).filter((w) => w.id !== id);
  saveWorkflows();
}

module.exports = { listWorkflows, upsertWorkflow, deleteWorkflow, saveWorkflows };
