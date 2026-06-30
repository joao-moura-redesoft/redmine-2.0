const axios = require('axios');
const { getMyUserId } = require('../lib/redmine');
const { getTalkAuth } = require('./talkStore');
const { safeAgents } = require('../lib/ssrfGuard');

async function makeTalk(req) {
  const uid = await getMyUserId(req);
  if (!uid) throw Object.assign(new Error('Não autorizado (Redmine)'), { statusCode: 401 });

  const auth = getTalkAuth(uid);
  if (!auth) throw Object.assign(new Error('Conta do Talk não vinculada'), { statusCode: 401 });

  return axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    // Anti-SSRF: a URL do Nextcloud vem da config do usuário. O Nextcloud corporativo
    // é público, então bloquear IPs internos/privados (inclusive em redirects, via o
    // lookup custom do agente) impede usar esse cliente para alcançar a rede interna.
    ...safeAgents(),
  });
}

module.exports = { makeTalk };
