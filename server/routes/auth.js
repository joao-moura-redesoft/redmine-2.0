const express = require('express');
const handle = require('../lib/handle');
const { makeRedmine } = require('../lib/redmine');
const { createSession, destroySession } = require('../lib/session');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Anti brute-force: no máx. 15 tentativas por IP a cada 15 min (resetado em login OK).
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
});

router.post(
  '/auth/login',
  loginLimiter,
  handle(async (req, res) => {
    const { url, apiKey, username, password } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Simulate headers so makeRedmine works identically
    const authHeaders = {
      'x-redmine-url': url,
      'x-redmine-key': apiKey || '',
      'x-redmine-user': username || '',
      'x-redmine-pass': password || '',
    };

    const reqMock = { headers: authHeaders };

    try {
      const redmine = makeRedmine(reqMock);
      const { data } = await redmine.get('/users/current.json');

      // Login succeeded, create session (zera o contador de tentativas deste IP)
      loginLimiter.reset(req);
      const sessionId = createSession({ url, apiKey, username, password });

      // Send cookie (10 anos para Token de API, 30 dias para Usuário/Senha)
      const maxAge = apiKey ? 10 * 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      res.cookie('session_id', sessionId, {
        httpOnly: true,
        // Loopback roda em HTTP, então `secure` fica off por padrão. Ao expor por
        // HTTPS (ex.: servidor central), defina COOKIE_SECURE=1 para só trafegar o
        // cookie em conexões cifradas.
        secure: process.env.COOKIE_SECURE === '1',
        sameSite: 'lax', // Use 'lax' to avoid issues with basic navigations if needed, or 'strict'
        maxAge,
      });

      res.json({ success: true, user: data.user });
    } catch (error) {
      if (error.response && [401, 403].includes(error.response.status)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      throw error;
    }
  }),
);

router.post(
  '/auth/logout',
  handle(async (req, res) => {
    const sessionId = req.cookies && req.cookies.session_id;
    if (sessionId) {
      destroySession(sessionId);
      res.clearCookie('session_id');
    }
    res.json({ success: true });
  }),
);

module.exports = router;
