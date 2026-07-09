// Bridge da telinha do Attack Shark K86: processo separado (node-hid + canvas são
// nativos, não entram no SEA do bluemine.exe). Escuta no loopback e, a cada
// notificação recebida do Bluemine, renderiza um card e manda pra tela; depois de
// ocioso, volta pro relógio.
//
//   POST /notify  {type,title,subtitle,tag,time,chips}  → mostra na tela
//   GET  /health                                        → {present}
//
// Config por env: K86_BRIDGE_PORT (37900), K86_BRIDGE_TOKEN (auth opcional),
// K86_IDLE_MS (volta pro relógio; 0 desliga), K86_DWELL_MS (tempo mínimo por card).
const http = require('http');
const device = require('./device');
const { render, renderIdle } = require('./render');

const PORT = Number(process.env.K86_BRIDGE_PORT) || 37900;
const TOKEN = process.env.K86_BRIDGE_TOKEN || '';
const IDLE_MS = process.env.K86_IDLE_MS !== undefined ? Number(process.env.K86_IDLE_MS) : 20000;
const DWELL_MS = Number(process.env.K86_DWELL_MS) || 2500;

const log = (...a) => console.log('[k86-bridge]', ...a);

// --- fila serial (o envio é bloqueante ~1s; não pode sobrepor) --------------
const queue = [];
let busy = false;
let idleTimer = null;
let idleRefresh = null;

// Mostra o relógio próprio do Bluemine e o mantém atualizado enquanto ocioso.
function showIdleClock() {
  if (busy || queue.length) return;
  try {
    device.sendCanvas(renderIdle(new Date()));
  } catch (e) {
    log('erro ao mostrar relógio:', e.message);
  }
}

function armIdle() {
  if (!IDLE_MS) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showIdleClock();
    // Mantém a hora andando (a tela nativa não volta; a nossa precisa refresh).
    clearInterval(idleRefresh);
    idleRefresh = setInterval(showIdleClock, 60 * 1000);
  }, IDLE_MS);
}

function processQueue() {
  if (busy || queue.length === 0) return;
  busy = true;
  clearTimeout(idleTimer);
  clearInterval(idleRefresh);
  const spec = queue.shift();
  try {
    const canvas = render(spec);
    const ok = device.sendCanvas(canvas);
    if (!ok) log('teclado não encontrado — ignorando notificação');
  } catch (e) {
    log('erro ao renderizar/enviar:', e.message);
  }
  setTimeout(() => {
    busy = false;
    if (queue.length) processQueue();
    else armIdle();
  }, DWELL_MS);
}

function enqueue(spec) {
  queue.push(spec);
  // Evita acúmulo absurdo numa rajada: mantém no máximo os 5 mais recentes.
  if (queue.length > 5) queue.splice(0, queue.length - 5);
  processQueue();
}

// --- HTTP loopback -----------------------------------------------------------
function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const server = http.createServer((req, res) => {
  if (!isLoopback(req)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, present: device.isPresent() }));
    return;
  }
  if (req.method === 'POST' && req.url === '/notify') {
    if (TOKEN && req.headers['x-bridge-token'] !== TOKEN) {
      res.writeHead(401).end();
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 64 * 1024) req.destroy(); // guard
    });
    req.on('end', () => {
      try {
        const spec = JSON.parse(body || '{}');
        enqueue(spec);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ queued: true }));
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, '127.0.0.1', () => {
  log(`ouvindo em http://127.0.0.1:${PORT} — teclado ${device.isPresent() ? 'presente' : 'ausente'}`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`porta ${PORT} já em uso (outra instância?) — saindo.`);
    process.exit(0);
  }
  throw e;
});
