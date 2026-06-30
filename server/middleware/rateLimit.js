// Rate limiter simples em memória (sem dependência externa). Pensado para
// proteger o login contra brute-force. Conta tentativas por IP numa janela
// fixa; chame `.reset(req)` num sucesso para não punir uso legítimo.
function createRateLimiter({ windowMs, max, message } = {}) {
  windowMs = windowMs || 15 * 60 * 1000;
  max = max || 15;
  message = message || 'Muitas tentativas. Tente novamente mais tarde.';

  const hits = new Map(); // ip -> { count, resetAt }
  const keyOf = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

  // Limpeza periódica das entradas expiradas (não segura o processo vivo).
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  const middleware = (req, res, next) => {
    const key = keyOf(req);
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now > e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(key, e);
    }
    if (e.count >= max) {
      res.setHeader('Retry-After', String(Math.ceil((e.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    e.count++;
    next();
  };

  middleware.reset = (req) => {
    hits.delete(keyOf(req));
  };
  return middleware;
}

module.exports = { createRateLimiter };
