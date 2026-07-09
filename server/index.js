// Ponto de entrada do servidor Bluemine: monta o app Express e sobe os workers
// de background (polling de Web Push). A lógica vive em app.js, routes/ e services/.
require('dotenv').config();

// Empacotado como app GUI (bluemine.exe sem janela de console no Windows),
// escritas em stdout/stderr podem falhar (EBADF/EPIPE) porque não há console.
// Silencia esses erros para não derrubar o processo — os logs persistem em
// arquivo (LOG_FILE). Precisa vir antes de qualquer console.log.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const buildApp = require('./app');
const { startPushPolling } = require('./services/push');
const { startBridge } = require('./services/keyboardBridge');
const { openAppWindow } = require('./lib/launcher');
const { writeBootMarker } = require('./services/updater');

// Simulação de falha de boot para TESTAR o rollback do auto-update: sai ANTES do
// listen, então nenhum marcador de boot é gravado e o watchdog reverte para a
// versão anterior. Ver docs/TESTE-AUTO-UPDATE.md.
if (process.env.BLUEMINE_FAIL_BOOT === '1') {
  console.error('[boot] BLUEMINE_FAIL_BOOT=1 — abortando antes do listen (teste de rollback)');
  process.exit(1);
}

const PORT = process.env.PORT || 3001;
// Por padrão escuta só no loopback: cada usuário roda seu próprio .exe localmente,
// então a API não deve ficar exposta na rede. Para expor de propósito (ex.: um dia
// virar servidor central), defina HOST=0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';

// URL usada para abrir a janela do app (loopback, mesmo quando HOST=0.0.0.0).
const APP_URL = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;

const app = buildApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`\n🔷 Bluemine rodando em http://${HOST}:${PORT}\n`);
  // Sinaliza boot bem-sucedido para o watchdog de auto-update (rollback).
  writeBootMarker();
  // Abre a janela dedicada do app (Edge em app mode → navegador padrão).
  openAppWindow(APP_URL, { host: HOST });
  // Sobe o processo-ponte da telinha do teclado K86 (best-effort).
  startBridge();
});

// Se a porta já estiver em uso, provavelmente o .exe já está rodando: em vez de
// crashar, apenas abre a janela apontando para a instância existente e sai.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n🔷 Bluemine já está rodando em ${APP_URL} — abrindo a janela.\n`);
    openAppWindow(APP_URL, { host: HOST });
    process.exit(0);
  }
  throw err;
});

// WEB PUSH — polling do Redmine/Talk por inscrição (notificações com a aba fechada).
startPushPolling();
