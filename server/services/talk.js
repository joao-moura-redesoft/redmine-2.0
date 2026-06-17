// Nextcloud Talk — cliente axios por request (OCS API).
const axios = require('axios');

function makeTalk(req) {
  const url   = req.headers['x-nextcloud-url']   || '';
  const user  = req.headers['x-nextcloud-user']  || '';
  const token = req.headers['x-nextcloud-token'] || '';
  return axios.create({
    baseURL: url,
    auth: { username: user, password: token },
    headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
  });
}

module.exports = { makeTalk };
