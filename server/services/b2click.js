// --- Cliente do ERP b2click (Redesoft) ---
// Fala com o backend Java do b2click via a interface REST/JSON (/erp/rest/).
//
// Login (web REST, sem Delphi/RSA/machine-binding): senha plaintext sobre HTTPS,
// o server faz MD5("QWPUPFJASFVJ"+senha) internamente. Retorna B2CLICK_TOKEN.
//   POST {BASE}/erp/rest/AppBackofficeLoginBO.entrar
//   body: ["ENTIDADE","USUARIO","senha","BLUEMINE","1.0.0","server"]
//   resp: { result: { token, tokenTtlSegundos, dadosLogin } }  (token tb em header X-Auth-Token)
//
// Requests autenticados:
//   POST {BASE}/erp/rest/<Classe>.<metodo>  body=[params...]  Authorization: Bearer <token>
//   (a entidade vai dentro do token; nao precisa header `entidade:`/`usuario:`)
//
// Config por env: B2CLICK_BASE (host unico do backend, ex: https://webservice.b2click.com),
//   B2CLICK_ENTIDADE (ex: REDESOFT — a entidade vai no parametro, nao no host),
//   B2CLICK_USER, B2CLICK_PASS. Token cifrado em repouso (DPAPI), renovado a 80% do TTL.
const axios = require('axios');
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const BASE = (process.env.B2CLICK_BASE || '').replace(/\/+$/, '');
const USER = process.env.B2CLICK_USER || '';
const PASS = process.env.B2CLICK_PASS || '';
const TIMEOUT = Number(process.env.B2CLICK_TIMEOUT || 15000);
const TOKEN_FILE = dataFile('b2click-token.json');

// entidade vai no parametro do login (host e unico). Definir via B2CLICK_ENTIDADE.
const ENTIDADE = (process.env.B2CLICK_ENTIDADE || '').toUpperCase();

let token = '';
let tokenExp = 0;          // epoch ms; 0 = desconhecido
let renewTimer = null;
let loginPromise = null;   // dedupe de logins concorrentes

// Carrega token persistido (ou env de bootstrap) no require.
(function loadToken() {
  const saved = readJsonSecure(TOKEN_FILE, null);
  if (saved && saved.token) { token = saved.token; tokenExp = saved.tokenExp || 0; }
  else if (process.env.B2CLICK_TOKEN) { token = process.env.B2CLICK_TOKEN; }
})();

const hasCreds = () => Boolean(BASE && USER && PASS && ENTIDADE);

// Renova a 80% do TTL (minimo 30s). Sem TTL conhecido, nao agenda nada.
function scheduleRenew(ttlSeconds) {
  if (renewTimer) clearTimeout(renewTimer);
  if (!ttlSeconds || ttlSeconds <= 0 || !hasCreds()) return;
  const ms = Math.max(30, Math.floor(ttlSeconds * 0.8)) * 1000;
  renewTimer = setTimeout(() => {
    login().catch((e) => console.error('[b2click] renovacao falhou:', e.message));
  }, ms);
  renewTimer.unref?.();
}

// Autentica e guarda o token. Deduplica chamadas concorrentes.
async function login() {
  if (!BASE) throw new Error('[b2click] B2CLICK_BASE nao configurado');
  if (!USER || !PASS) throw new Error('[b2click] B2CLICK_USER/B2CLICK_PASS nao configurados');
  if (!ENTIDADE) throw new Error('[b2click] entidade indefinida (B2CLICK_ENTIDADE ou subdominio de B2CLICK_BASE)');
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    // Dispatcher REST espera OBJETO JSON (nao array). Chaves indexadas mapeiam posicionalmente.
    const body = { '0': ENTIDADE, '1': USER, '2': PASS, '3': 'BLUEMINE', '4': '1.0.0', '5': 'server' };
    const resp = await axios.post(`${BASE}/erp/rest/AppBackofficeLoginBO.entrar`, body, {
      timeout: TIMEOUT,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json' },
    });
    const r = (resp.data && resp.data.result) || resp.data || {};
    const t = r.token || resp.headers['x-auth-token'];
    if (!t) throw new Error(`[b2click] login sem token: ${JSON.stringify(resp.data).slice(0, 200)}`);
    const ttl = Number(r.tokenTtlSegundos || 0);
    token = t;
    tokenExp = ttl > 0 ? Date.now() + ttl * 1000 : 0;
    writeJsonSecure(TOKEN_FILE, { token, tokenExp, updatedAt: new Date().toISOString() });
    scheduleRenew(ttl);
    console.log(`[b2click] login OK (${ENTIDADE}/${USER})${ttl ? `, ttl ${ttl}s` : ''}`);
    return token;
  })().finally(() => { loginPromise = null; });
  return loginPromise;
}

// Garante um token valido: usa o atual se ainda dentro do TTL, senao loga.
async function ensureToken() {
  if (token && (!tokenExp || Date.now() < tokenExp - 5000)) return token;
  if (hasCreds()) return login();
  if (token) return token; // modo bootstrap (token sem creds): usa ate expirar
  throw new Error('[b2click] sem token e sem credenciais (configure B2CLICK_USER/PASS)');
}

async function call(classeMetodo, params) {
  // O dispatcher REST le params de um objeto JSON; chaves indexadas ("0","1"...)
  // mapeiam posicionalmente. Metodo sem params -> objeto vazio.
  const body = Object.fromEntries(params.map((p, i) => [String(i), p]));
  try {
    const { data } = await axios.post(`${BASE}/erp/rest/${classeMetodo}`, body, {
      timeout: TIMEOUT,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json',
      },
    });
    // sucesso vem embrulhado em {"result": ...}
    return data && typeof data === 'object' && 'result' in data ? data.result : data;
  } catch (e) {
    const resp = e.response;
    if (resp) {
      const txt = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      const m = /<erro>([\s\S]*?)<\/erro>/.exec(txt);
      const err = new Error(`[b2click] ${classeMetodo} -> ${resp.status}: ${m ? m[1] : txt.slice(0, 300)}`);
      err.status = resp.status;
      err.tokenInvalid = resp.status === 401 || resp.status === 403;
      throw err;
    }
    throw new Error(`[b2click] ${classeMetodo} -> ${e.message}`);
  }
}

// Chamada RPC: rpc('Classe.metodo', arg1, ...). Auto-login + 1 retry se o token morrer.
async function rpc(classeMetodo, ...params) {
  await ensureToken();
  try {
    return await call(classeMetodo, params);
  } catch (e) {
    if (e.tokenInvalid && hasCreds()) {
      token = ''; tokenExp = 0;
      await login();
      return call(classeMetodo, params);
    }
    throw e;
  }
}

// Define um token manualmente (bootstrap sem credenciais) e persiste.
function setToken(newToken) {
  token = String(newToken || '').trim();
  tokenExp = 0;
  writeJsonSecure(TOKEN_FILE, { token, tokenExp, updatedAt: new Date().toISOString() });
  return Boolean(token);
}

// Converte um grid String[][] em objetos usando os nomes de coluna conhecidos.
function gridToObjects(grid, columns) {
  if (!Array.isArray(grid)) return [];
  return grid.map((row) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

const TAREFAS_COLS = [
  'TAREFA', 'prioridade', 'DATA_ABERTURA', 'titulo', 'DATA_PREVISTA',
  'DESENVOLVEDOR', 'CLASSIFICACAO', 'TEMPO_DEV', 'COD_NATUREZA',
];

// --- Metodos do Concierge ---

async function consultaTarefasPendentes() {
  const grid = await rpc('ConsultasRedmineBO.consultaTarefasPendentesUsuarioAtual');
  return gridToObjects(grid, TAREFAS_COLS);
}

async function consultaAtividades() {
  const grid = await rpc('ChatTipoAtividadeBO.consultaAtividadesUsuarioAtual');
  return Array.isArray(grid) ? grid.map((r) => (Array.isArray(r) ? r[0] : r)) : [];
}

// Comando em linguagem natural ao Concierge (ex: "iniciar tarefa 1234").
async function comandoConcierge(comando) {
  return rpc('JornadaConciergeBO.trataComandoConciergeTela', String(comando));
}

// Chame no boot do server: faz login se ainda nao tem token e agenda a renovacao.
async function init() {
  if (!hasCreds() && !token) { console.warn('[b2click] nao configurado (sem creds/token) — pulando'); return false; }
  try {
    if (token && tokenExp) scheduleRenew(Math.max(0, (tokenExp - Date.now()) / 1000));
    await ensureToken();
    return true;
  } catch (e) {
    console.error('[b2click] init falhou:', e.message);
    return false;
  }
}

function isConfigured() { return hasCreds() || Boolean(token); }

module.exports = {
  rpc, login, setToken, init, isConfigured,
  consultaTarefasPendentes, consultaAtividades, comandoConcierge,
};
