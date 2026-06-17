// Ponto de entrada do servidor Bluemine: monta o app Express e sobe os workers
// de background (polling de Web Push). A lógica vive em app.js, routes/ e services/.
const buildApp = require('./app');
const { startPushPolling } = require('./services/push');

const PORT = process.env.PORT || 3001;

const app = buildApp();

app.listen(PORT, () => {
  console.log(`\n🔷 Bluemine rodando em http://localhost:${PORT}\n`);
});

// WEB PUSH — polling do Redmine/Talk por inscrição (notificações com a aba fechada).
startPushPolling();
