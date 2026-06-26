const axios = require('axios');
const { getMyUserId } = require('../lib/redmine');
const { getTalkAuth } = require('./talkStore');

async function makeTalk(req) {
  const uid = await getMyUserId(req);
  if (!uid) throw Object.assign(new Error('Não autorizado (Redmine)'), { statusCode: 401 });
  
  const auth = getTalkAuth(uid);
  if (!auth) throw Object.assign(new Error('Conta do Talk não vinculada'), { statusCode: 401 });

  return axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
  });
}

module.exports = { makeTalk };
