// Monta e configura o app Express: middlewares, rotas da API e serviço do
// frontend compilado (SPA). O index.js apenas sobe o servidor e os workers.
const express = require('express');
const cors = require('cors');
const path = require('path');

function buildApp() {
  const app = express();

  // AJUSTADO: Adicionado suporte para a porta 3001 onde o front+back rodarão juntos
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001'] }));
  app.use(express.json());

  // Rotas da API (todas montadas sob /api).
  app.use('/api', require('./routes/issues'));
  app.use('/api', require('./routes/timeEntries'));
  app.use('/api', require('./routes/meta'));
  app.use('/api', require('./routes/attachments'));
  app.use('/api', require('./routes/ai'));
  app.use('/api', require('./routes/push'));
  app.use('/api', require('./routes/talk'));
  app.use('/api', require('./routes/notes'));
  app.use('/api', require('./routes/mail'));
  app.use('/api', require('./routes/wiki'));

  // =========================================================================
  // Injeta o frontend compilado dentro do executável do backend.
  // =========================================================================

  // 1. Serve os arquivos estáticos compilados do frontend (HTML, CSS, JS)
  app.use(express.static(path.join(__dirname, 'dist')));

  // 2. Rotas de navegação do SPA caem no index.html; rotas /api/ não registradas retornam 404
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });

  return app;
}

module.exports = buildApp;
