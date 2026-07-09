// Empurra notificações pra telinha do teclado Attack Shark K86 via processo-ponte
// (bridge/) no loopback. Fire-and-forget: se o bridge ou o teclado não estiverem
// presentes, é no-op silencioso — NUNCA derruba o fluxo de push.
//
// OPT-IN: desligado por padrão (a maioria não tem o teclado). Ative com
// K86_ENABLED=1 no .env — só aí o bridge é spawnado e as notificações vão pra tela.
// Porta/token: K86_BRIDGE_PORT (37900), K86_BRIDGE_TOKEN.
const http = require('http');

const ENABLED = process.env.K86_ENABLED === '1' || /^true$/i.test(process.env.K86_ENABLED || '');
const PORT = Number(process.env.K86_BRIDGE_PORT) || 37900;
const TOKEN = process.env.K86_BRIDGE_TOKEN || '';

function hhmm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Envia um spec de card pro bridge (ver bridge/render.js). Erros são engolidos.
function notify(spec) {
  if (!ENABLED) return;
  try {
    const data = Buffer.from(JSON.stringify({ time: hhmm(), ...spec }));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/notify',
        method: 'POST',
        timeout: 1500,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          ...(TOKEN ? { 'x-bridge-token': TOKEN } : {}),
        },
      },
      (res) => res.resume(),
    );
    req.on('error', () => {}); // bridge ausente: silencioso
    req.on('timeout', () => req.destroy());
    req.write(data);
    req.end();
  } catch {
    /* nunca propaga */
  }
}

module.exports = { notify, hhmm, ENABLED };
