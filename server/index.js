// Ponto de entrada do servidor Bluemine: monta o app Express e sobe os workers
// de background (polling de Web Push). A lógica vive em app.js, routes/ e services/.
const buildApp = require('./app');
const { startPushPolling } = require('./services/push');

const PORT = process.env.PORT || 3001;
// Por padrão escuta só no loopback: cada usuário roda seu próprio .exe localmente,
// então a API não deve ficar exposta na rede. Para expor de propósito (ex.: um dia
// virar servidor central), defina HOST=0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';

const app = buildApp();

app.listen(PORT, HOST, () => {
  console.log(`\n🔷 Bluemine rodando em http://${HOST}:${PORT}\n`);
});

// WEB PUSH — polling do Redmine/Talk por inscrição (notificações com a aba fechada).
startPushPolling();
