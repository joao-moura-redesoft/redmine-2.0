// Sobe o processo-ponte da telinha do K86 junto com o app. Em produção procura o
// exe irmão `k86-bridge.exe` (empacotado à parte, pois node-hid/canvas são nativos
// e não entram no SEA); em dev roda `bridge/index.js` via node. Best-effort: se o
// recurso estiver desligado ou o bridge não existir, é no-op silencioso.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ENABLED } = require('./keyboardNotify');

function isSea() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

function startBridge() {
  if (!ENABLED) return;
  try {
    // 1) exe irmão empacotado (produção).
    const exe = path.join(
      path.dirname(process.execPath),
      process.platform === 'win32' ? 'k86-bridge.exe' : 'k86-bridge',
    );
    if (fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    // 2) dev: node bridge/index.js (não faz sentido dentro do SEA).
    const devEntry = path.join(__dirname, '..', '..', 'bridge', 'index.js');
    if (!isSea() && fs.existsSync(devEntry)) {
      spawn(process.execPath, [devEntry], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* best-effort: o bridge se reconecta sozinho, e o notify é no-op se ausente */
  }
}

module.exports = { startBridge };
