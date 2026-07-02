// Proteção contra SSRF para proxies que buscam URLs fornecidas pelo usuário
// (ex.: preview OpenGraph de links colados no chat). Bloqueia conexões para
// faixas de IP internas/reservadas — inclusive em redirects, pois o `lookup`
// customizado é aplicado pelo agente em toda conexão.
const dns = require('dns');
const http = require('http');
const https = require('https');

// IPv4/IPv6 em faixas privadas, loopback, link-local (metadata 169.254.169.254),
// CGNAT e reservadas. Cobre também IPv4 mapeado em IPv6 (::ffff:a.b.c.d).
function isPrivateIp(ip) {
  if (!ip) return true;
  let addr = ip.toLowerCase();

  // IPv4 mapeado em IPv6
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) addr = mapped[1];

  if (addr.includes('.')) {
    const p = addr.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast/reservado
    return false;
  }

  // IPv6
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  if (addr.startsWith('fe80')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // ULA fc00::/7
  if (addr.startsWith('ff')) return true; // multicast
  return false;
}

function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options || {};

  const whitelist = (process.env.SSRF_WHITELIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const bypass = process.env.ALLOW_LOCAL_SSRF === '1' || whitelist.includes(hostname.toLowerCase());

  if (bypass) {
    return dns.lookup(hostname, options, callback);
  }

  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (isPrivateIp(a.address) && !whitelist.includes(a.address)) {
        return cb(
          Object.assign(new Error('SSRF bloqueado: destino interno'), { code: 'ESSRFBLOCKED' }),
        );
      }
    }
    const first = list[0];
    if (opts.all) return cb(null, list);
    return cb(null, first.address, first.family);
  });
}

const safeHttpAgent = new http.Agent({ lookup: safeLookup });
const safeHttpsAgent = new https.Agent({ lookup: safeLookup });

// Opções axios prontas para um GET seguro contra SSRF.
function safeAgents() {
  return { httpAgent: safeHttpAgent, httpsAgent: safeHttpsAgent };
}

module.exports = { isPrivateIp, safeLookup, safeHttpAgent, safeHttpsAgent, safeAgents };
