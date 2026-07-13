// Cliente Redmine por request + credenciais e cache de userId.
const axios = require('axios');

const DEFAULT_URL = '';
const DEFAULT_KEY = '';

// Retorna os headers de autenticação corretos dependendo do modo (token vs usuário/senha).
function buildAuthHeaders(key, username, password) {
  if (username && password) {
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
  return { 'X-Redmine-API-Key': key };
}

// Cria instância do axios para cada request com as credenciais certas
function makeRedmine(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  return axios.create({
    baseURL: url,
    headers: { ...buildAuthHeaders(key, username, password), 'Content-Type': 'application/json' },
  });
}

// Cache de userId por "url:key" ou "url:user:pass". Com TTL para não crescer
// indefinidamente (espelha o padrão de allowedCache em routes/issues.js).
const userIdCache = new Map(); // cacheKey -> { id, expiresAt }
const USER_ID_TTL_MS = 5 * 60 * 1000;

// Limpeza periódica de entradas expiradas.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userIdCache) if (now > v.expiresAt) userIdCache.delete(k);
}, USER_ID_TTL_MS).unref();

async function getMyUserId(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const cacheKey = `${url}:${key || `${username}:${password}`}`;
  const cached = userIdCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  const { data } = await makeRedmine(req).get('/users/current.json');
  userIdCache.set(cacheKey, { id: data.user.id, expiresAt: Date.now() + USER_ID_TTL_MS });
  return data.user.id;
}

module.exports = {
  DEFAULT_URL,
  DEFAULT_KEY,
  buildAuthHeaders,
  makeRedmine,
  getMyUserId,
};
