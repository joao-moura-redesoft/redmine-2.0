const { getSession } = require('../lib/session');

function authMiddleware(req, res, next) {
  const sessionId = req.cookies && req.cookies.session_id;
  if (!sessionId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const session = getSession(sessionId);
  if (!session) {
    res.clearCookie('session_id');
    return res.status(401).json({ error: 'Sessão expirada' });
  }

  // Injeta as credenciais nos cabeçalhos da requisição, para que o `makeRedmine`

  // e o restante da aplicação continuem funcionando sem alterações.
  req.headers['x-redmine-url'] = session.url;
  if (session.apiKey) {
    req.headers['x-redmine-key'] = session.apiKey;
  } else {
    req.headers['x-redmine-user'] = session.username;
    req.headers['x-redmine-pass'] = session.password;
  }

  next();
}

module.exports = { authMiddleware };
