// Logger estruturado leve (sem dependência externa, para não pesar no bundle pkg).
//
// Emite uma linha JSON por evento em stdout e, opcionalmente, num arquivo em
// disco (LOG_FILE) — este último alimenta o export de diagnóstico, permitindo
// investigar um problema na máquina do usuário sem acesso remoto a ela.
//
// Nível mínimo via LOG_LEVEL (debug|info|warn|error, padrão info).
// SEGREDOS NUNCA são logados: campos sensíveis são redigidos por nome.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./secureStore');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

// Arquivo de log (opcional). Por padrão gravamos um bluemine.log ao lado dos
// dados, com rotação simples por tamanho, para o export de diagnóstico.
const LOG_FILE = process.env.LOG_FILE || path.join(DATA_DIR, 'bluemine.log');
const LOG_TO_FILE = process.env.LOG_TO_FILE !== '0';
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB → rotaciona para .1

// Chaves cujo valor é sempre redigido, em qualquer profundidade.
const SECRET_KEYS =
  /^(pass|password|senha|token|apikey|api_key|key|secret|authorization|cookie|apppassword|privatekey)$/i;

function redact(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    /* arquivo ainda não existe */
  }
}

function write(level, msg, fields) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = { t: new Date().toISOString(), level, msg, ...redact(fields || {}) };
  const line = JSON.stringify(entry);
  // stdout continua legível no terminal do dev.
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  if (LOG_TO_FILE) {
    try {
      rotateIfNeeded();
      fs.appendFileSync(LOG_FILE, line + '\n');
    } catch {
      /* disco cheio / sem permissão: não derruba o processo */
    }
  }
}

module.exports = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
  LOG_FILE,
};
