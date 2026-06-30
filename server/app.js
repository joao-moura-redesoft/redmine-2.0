// Monta e configura o app Express: middlewares, rotas da API e serviço do
// frontend compilado (SPA). O index.js apenas sobe o servidor e os workers.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const cookieParser = require('cookie-parser');
const { authMiddleware } = require('./middleware/auth');
const errorMiddleware = require('./lib/errorMiddleware');

function buildApp() {
  const app = express();

  // Headers de segurança (nosniff, X-Frame-Options, Referrer-Policy, etc.).
  // HSTS off enquanto roda em HTTP; COEP off para não bloquear Jitsi/avatares.
  //
  // CSP em modo Report-Only por ora: ela NÃO bloqueia nada, só registra
  // violações no console do navegador. Permissões largas em script/frame/connect
  // são necessárias porque o Jitsi carrega external_api.js de um domínio
  // CONFIGURÁVEL pelo usuário e renderiza num iframe desse domínio; mesmo assim
  // a política bloqueia <script> inline, eval, plugins, base-tag e clickjacking —
  // defense-in-depth junto do DOMPurify. Depois de validar com o app servido em
  // produção (Jitsi/Wiki/Drive), troque CSP_ENFORCE=1 para passar a bloquear.
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https:'], // Jitsi external_api (domínio configurável)
    styleSrc: ["'self'", "'unsafe-inline'"], // estilos inline do React/libs
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", 'https:', 'wss:'], // /api, SSE, Jitsi (wss)
    mediaSrc: ["'self'", 'blob:', 'data:'], // áudio/voz (object URLs)
    frameSrc: ["'self'", 'https:'], // Jitsi + viewer.diagrams.net
    workerSrc: ["'self'", 'blob:'], // service worker + workers blob
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
  };
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: cspDirectives,
        reportOnly: process.env.CSP_ENFORCE !== '1',
      },
      hsts: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // AJUSTADO: Adicionado suporte para a porta 3001 onde o front+back rodarão juntos
  app.use(
    cors({
      origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
      ],
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Rotas da API (todas montadas sob /api).
  app.use('/api', require('./routes/auth'));
  // Download de anexo de e-mail: autentica pelo token ?s= (o <img> do iframe não
  // envia cookie de sessão), então fica ANTES do authMiddleware de propósito.
  app.use('/api', require('./routes/mailAttachment'));
  app.use('/api', authMiddleware);
  app.use('/api', require('./routes/issues'));
  app.use('/api', require('./routes/timeEntries'));
  app.use('/api', require('./routes/meta'));
  app.use('/api', require('./routes/attachments'));
  app.use('/api', require('./routes/ai'));
  app.use('/api', require('./routes/push'));
  app.use('/api', require('./routes/talk'));
  app.use('/api', require('./routes/notes'));
  app.use('/api', require('./routes/sprints'));
  app.use('/api', require('./routes/boards'));
  app.use('/api', require('./routes/mail'));
  app.use('/api', require('./routes/wiki'));
  app.use('/api', require('./routes/jitsi'));
  app.use('/api', require('./routes/drive'));
  app.use('/api', require('./routes/secrets'));

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

  // Tratamento centralizado de erros — deve ser o último middleware registrado
  app.use(errorMiddleware);

  return app;
}

module.exports = buildApp;
