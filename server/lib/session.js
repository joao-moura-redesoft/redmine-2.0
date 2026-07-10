const crypto = require('crypto');
const { dataFile, readJsonSecure, writeJsonSecure } = require('./secureStore');

const SESSIONS_FILE = dataFile('sessions.json');

// Map em memória para gerenciar sessões
// Chave: sessionId (string)
// Valor: { url, apiKey, username, password, createdAt }
let sessionsMap = new Map();

// Carrega as sessões salvas do disco na inicialização
function loadSessions() {
  const data = readJsonSecure(SESSIONS_FILE, []);
  sessionsMap = new Map(data);
}
loadSessions();

function saveSessions() {
  // As sessões guardam credenciais do Redmine (incl. senha em modo Basic): exige
  // criptografia em repouso, recusando o fallback de texto puro.
  writeJsonSecure(SESSIONS_FILE, Array.from(sessionsMap.entries()), { requireEncryption: true });
}

function createSession(authData) {
  const sessionId = crypto.randomUUID();
  sessionsMap.set(sessionId, {
    ...authData,
    createdAt: Date.now(),
  });
  saveSessions();
  return sessionId;
}

function getSession(sessionId) {
  return sessionsMap.get(sessionId);
}

function destroySession(sessionId) {
  sessionsMap.delete(sessionId);
  saveSessions();
}

// Limpeza simples de sessões muito antigas (opcional, p. ex. 30 dias para usuário/senha)
// Sessões baseadas em Token de API não devem ser limpadas, pois duram indefinidamente.
function cleanupSessions() {
  const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dias
  const now = Date.now();
  let changed = false;

  for (const [id, session] of sessionsMap.entries()) {
    // Se for Token de API, não expira. Se for usuário/senha, expira em 30 dias.
    if (!session.apiKey && now - session.createdAt > MAX_AGE) {
      sessionsMap.delete(id);
      changed = true;
    }
  }

  if (changed) {
    // Roda em setInterval: não deixa um erro de criptografia derrubar o processo.
    try {
      saveSessions();
    } catch (e) {
      console.error('[session] falha ao persistir limpeza de sessões:', e.message);
    }
  }
}

setInterval(cleanupSessions, 12 * 60 * 60 * 1000); // Roda a cada 12h

// Todas as sessões ativas (valores). Usado pelo motor de automações para rodar
// no background com as credenciais de quem está logado, mesmo sem Web Push.
function listSessions() {
  return Array.from(sessionsMap.values());
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  listSessions,
};
