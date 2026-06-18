const NETWORK_RE = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EHOSTUNREACH/;

function sanitizeRedmineBody(data) {
  if (!data) return null;
  if (Array.isArray(data.errors)) return { errors: data.errors };
  return null;
}

function safeNetworkMessage(err) {
  if (NETWORK_RE.test(err.message || ''))
    return 'Não foi possível conectar ao servidor Redmine.';
  return 'Requisição inválida.';
}

// eslint-disable-next-line no-unused-vars
module.exports = function errorMiddleware(err, req, res, next) {
  // AppError: mensagem intencional, segura para o cliente
  if (err.isSafe)
    return res.status(err.statusCode).json({ error: err.message });

  const status = err.response?.status || err.statusCode || err.status || 500;

  console.error(`[${req.method} ${req.path}] ${status}:`, err.response?.data ?? err.message);
  if (status >= 500) console.error(err.stack);

  if (status >= 500)
    return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });

  if (status === 401 || status === 403)
    return res.status(status).json({ error: 'Credenciais inválidas ou sem permissão.' });

  if (status === 404)
    return res.status(404).json({ error: 'Recurso não encontrado.' });

  // 4xx: repassa apenas o array de erros do Redmine, nunca o corpo bruto
  const safe = sanitizeRedmineBody(err.response?.data);
  if (safe) return res.status(status).json(safe);

  return res.status(status).json({ error: safeNetworkMessage(err) });
};
