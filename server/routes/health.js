// Health-check (público) e export de diagnóstico (autenticado).
//
// /api/health        → liveness/readiness simples, sem auth (para monitoração).
// /api/diagnostics   → bundle sanitizado (versão, ambiente, flags, tail de log)
//                      para depurar a máquina do usuário sem acesso remoto.
//                      Requer sessão; os logs já são gravados com segredos redigidos.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const handle = require('../lib/handle');
const log = require('../lib/logger');
const { IS_WINDOWS } = require('../lib/secureStore');

let pkgVersion = '0.0.0';
try {
  pkgVersion = require('../../package.json').version || pkgVersion;
} catch {
  /* empacotado: package.json pode não estar acessível */
}

const startedAt = Date.now();

// Router público — montado ANTES do authMiddleware.
const health = express.Router();
health.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()), version: pkgVersion });
});

// Router autenticado — montado DEPOIS do authMiddleware.
const diagnostics = express.Router();
diagnostics.get(
  '/diagnostics',
  handle(async (req, res) => {
    const lines = Math.min(parseInt(req.query.lines, 10) || 200, 2000);
    let logTail = [];
    try {
      const raw = fs.readFileSync(log.LOG_FILE, 'utf8').trimEnd().split('\n');
      logTail = raw.slice(-lines);
    } catch {
      /* sem arquivo de log ainda */
    }
    const mem = process.memoryUsage();
    res.json({
      app: { name: 'Bluemine', version: pkgVersion, startedAt: new Date(startedAt).toISOString() },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        packaged: !!process.pkg,
        uptimeSec: Math.round(process.uptime()),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        hostname: os.hostname(),
      },
      // Só flags de comportamento — nenhum segredo.
      config: {
        dpapiAvailable: IS_WINDOWS,
        pushEnabled: !(
          process.env.PUSH_ENABLED === '0' || /^false$/i.test(process.env.PUSH_ENABLED || '')
        ),
        cspEnforce: process.env.CSP_ENFORCE === '1',
        cookieSecure: process.env.COOKIE_SECURE === '1',
        host: process.env.HOST || '127.0.0.1',
        logFile: path.basename(log.LOG_FILE),
        logLevel: process.env.LOG_LEVEL || 'info',
      },
      logTail,
    });
  }),
);

module.exports = { health, diagnostics };
