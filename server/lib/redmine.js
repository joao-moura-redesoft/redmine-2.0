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

// Cache de userId por "url:key" ou "url:user:pass"
const userIdCache = new Map();
async function getMyUserId(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const cacheKey = `${url}:${key || `${username}:${password}`}`;
  if (userIdCache.has(cacheKey)) return userIdCache.get(cacheKey);
  const { data } = await makeRedmine(req).get('/users/current.json');
  userIdCache.set(cacheKey, data.user.id);
  return data.user.id;
}

module.exports = {
  DEFAULT_URL,
  DEFAULT_KEY,
  buildAuthHeaders,
  makeRedmine,
  getMyUserId,
};
