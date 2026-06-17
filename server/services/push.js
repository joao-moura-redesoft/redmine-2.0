// WEB PUSH — notificações mesmo com a aba do navegador fechada.
// O servidor (que continua de pé enquanto o .exe roda) faz polling do Redmine
// por inscrição e empurra notificações. O service worker só EXIBE a notificação
// quando não há nenhuma janela do app aberta — se houver (aberta ou minimizada),
// o próprio app já cuida via o polling em segundo plano (refetchIntervalInBackground),
// evitando notificações duplicadas.
const axios = require('axios');
const webpush = require('web-push');
const { buildAuthHeaders } = require('../lib/redmine');
const { fetchAllIssues } = require('../lib/pagination');
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

// VAPID: carrega ou gera o par de chaves uma única vez (persistido em vapid.json).
const VAPID_FILE = dataFile('vapid.json');
let vapid = readJsonSecure(VAPID_FILE, null);
if (!vapid || !vapid.publicKey || !vapid.privateKey) {
  vapid = webpush.generateVAPIDKeys();
  writeJsonSecure(VAPID_FILE, vapid);
  console.log('[push] novas chaves VAPID geradas');
}
webpush.setVapidDetails('mailto:admin@b2click.com', vapid.publicKey, vapid.privateKey);

// Inscrições persistidas: [{ endpoint, subscription, url, key, updatedAt, seen:{...} }]
const SUBS_FILE = dataFile('push-subscriptions.json');
let subscriptions = readJsonSecure(SUBS_FILE, []);
subscriptions.forEach(s => { if (!s.updatedAt) s.updatedAt = Date.now(); }); // backfill p/ TTL
const saveSubs = () => writeJsonSecure(SUBS_FILE, subscriptions);

// Expira inscrições inativas (sem re-inscrição) há mais de 30 dias.
const SUB_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Coleta os IDs atuais relevantes para um par url/credenciais (inicializa/atualiza "seen").
async function collectPushState(url, key, username, password) {
  const client = axios.create({
    baseURL: url,
    headers: { ...buildAuthHeaders(key, username, password), 'Content-Type': 'application/json' },
  });
  const me = (await client.get('/users/current.json')).data.user.id;

  const assigned = await fetchAllIssues(client, { assigned_to_id: 'me', status_id: 'open' });
  const review = await fetchAllIssues(client, { cf_210: me, status_id: 71 });
  const monitoredAll = await fetchAllIssues(client, { cf_141: me, status_id: 'open' });
  const monitored = monitoredAll.filter(
    i => !i.assigned_to || String(i.assigned_to.id) !== String(me)
  );

  const byId = new Map();
  [...assigned, ...review, ...monitored].forEach(i => byId.set(i.id, i));
  return {
    issues: byId,
    seen: {
      assigned: assigned.map(i => i.id),
      review: review.map(i => i.id),
      monitored: monitored.map(i => i.id),
    },
  };
}

function getVapidPublicKey() {
  return vapid.publicKey;
}

async function subscribe(req) {
  const url = req.headers['x-redmine-url'];
  const key = req.headers['x-redmine-key'] || '';
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const subscription = req.body?.subscription;
  const talkAuth = req.body?.talkAuth || null; // { url, user, token } — opcional
  const hasAuth = !!(key || (username && password));
  if (!url || !hasAuth || !subscription?.endpoint) {
    console.warn('[push] subscribe rejeitado — faltando:', { url: !!url, hasAuth, endpoint: !!subscription?.endpoint });
    throw Object.assign(new Error('subscription e credenciais são obrigatórios'), { statusCode: 400 });
  }

  // Estado inicial para não disparar como "novo" tudo o que já existe hoje.
  let seen = { assigned: [], review: [], monitored: [] };
  try { seen = (await collectPushState(url, key, username, password)).seen; }
  catch (e) { console.warn('[push] não consegui inicializar o estado:', e.response?.status || e.message); }

  // Estado inicial do Talk: pega o lastMessage.id de cada sala para não notificar retroativamente.
  let talkSeen = {};
  if (talkAuth?.url && talkAuth?.user && talkAuth?.token) {
    try {
      const talkClient = axios.create({
        baseURL: talkAuth.url,
        auth: { username: talkAuth.user, password: talkAuth.token },
        headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
      });
      const { data } = await talkClient.get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
      for (const room of (data.ocs.data || [])) {
        if (room.lastMessage?.id) talkSeen[room.token] = room.lastMessage.id;
      }
    } catch (e) { console.warn('[push] não inicializei estado Talk:', e.response?.status || e.message); }
  }

  const rec = { endpoint: subscription.endpoint, subscription, url, key, username, password, seen, talkAuth, talkSeen, updatedAt: Date.now() };
  const idx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
  if (idx >= 0) subscriptions[idx] = rec; else subscriptions.push(rec);
  saveSubs();
  console.log(`[push] inscrição registrada (${subscriptions.length} no total)${talkAuth ? ' com Talk' : ''}`);
}

function unsubscribe(req) {
  const endpoint = req.body?.endpoint;
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  saveSubs();
}

// Envia uma notificação; remove a inscrição se o navegador disser que expirou (404/410).
async function sendPush(rec, payload) {
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      subscriptions = subscriptions.filter(s => s.endpoint !== rec.endpoint);
      saveSubs();
      console.log('[push] inscrição expirada removida');
    } else {
      console.error('[push] erro ao enviar:', err.statusCode || err.message);
    }
  }
}

// Resolve o texto de uma mensagem Talk no servidor (espelho de resolveMessageText do cliente).
function resolveMessageTextServer(msg) {
  if (!msg) return '';
  if (msg.message === '{file}') {
    const file = msg.messageParameters?.file;
    return file?.name ? `📎 ${file.name}` : '📎 Arquivo';
  }
  return msg.message.replace(/\{([\w-]+)\}/g, (_, key) => {
    const param = msg.messageParameters?.[key];
    return param?.name ? `@${param.name}` : key;
  });
}

const PUSH_TAG = { assigned: 'a', review: 'r', monitored: 'm' };
const PUSH_TITLE = {
  assigned: '📋 Nova tarefa atribuída a você',
  review: '🔍 Pedido de revisão',
  monitored: '👁️ Nova tarefa em monitoramento',
};

const PUSH_POLL_MS = 60 * 1000;
let pushPolling = false;
async function pollPush() {
  if (pushPolling) return;
  // Poda inscrições inativas há mais de 30 dias (TTL).
  const now = Date.now();
  const before = subscriptions.length;
  subscriptions = subscriptions.filter(s => now - (s.updatedAt || now) < SUB_TTL_MS);
  if (subscriptions.length !== before) {
    console.log(`[push] ${before - subscriptions.length} inscrição(ões) expiradas por inatividade`);
    saveSubs();
  }
  if (subscriptions.length === 0) return;
  pushPolling = true;
  try {
    for (const rec of [...subscriptions]) {
      try {
        const { issues, seen } = await collectPushState(rec.url, rec.key || '', rec.username || '', rec.password || '');
        const prev = rec.seen || { assigned: [], review: [], monitored: [] };
        const toNotify = [];

        for (const type of ['assigned', 'review', 'monitored']) {
          const oldSet = new Set(prev[type] || []);
          for (const id of seen[type]) {
            if (!oldSet.has(id) && issues.has(id)) toNotify.push({ type, issue: issues.get(id) });
          }
        }
        rec.seen = seen;

        for (const { type, issue } of toNotify) {
          await sendPush(rec, {
            title: PUSH_TITLE[type],
            body: `#${issue.id} — ${issue.subject}\n${issue.project?.name ?? ''}`,
            tag: `rk-${PUSH_TAG[type]}-${issue.id}`,
            url: `/?issue=${issue.id}`,
            issueId: issue.id,
          });
        }

        // Notificações Talk
        if (rec.talkAuth?.url && rec.talkAuth?.user && rec.talkAuth?.token) {
          try {
            const talkClient = axios.create({
              baseURL: rec.talkAuth.url,
              auth: { username: rec.talkAuth.user, password: rec.talkAuth.token },
              headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
            });
            const { data: tData } = await talkClient.get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
            if (!rec.talkSeen) rec.talkSeen = {};
            for (const room of (tData.ocs.data || [])) {
              if (room.type === 6) continue; // changelog
              const lastMsgId = room.lastMessage?.id || 0;
              const seenId = rec.talkSeen[room.token] || 0;
              if (lastMsgId > seenId && seenId > 0 && room.unreadMessages > 0) {
                const body = resolveMessageTextServer(room.lastMessage);
                const sender = room.lastMessage?.actorDisplayName?.split(' ')[0] || '';
                await sendPush(rec, {
                  title: `💬 ${room.displayName}`,
                  body: sender ? `${sender}: ${body}` : body,
                  tag: `talk-${room.token}-${lastMsgId}`,
                  url: `/?talkRoom=${room.token}`,
                  talkToken: room.token,
                });
              }
              if (lastMsgId) rec.talkSeen[room.token] = lastMsgId;
            }
          } catch (err) {
            console.warn('[push] poll Talk falhou:', err.response?.status || err.message);
          }
        }
      } catch (err) {
        console.warn('[push] poll falhou para uma inscrição:', err.response?.status || err.message);
      }
    }
    saveSubs(); // persiste os "seen" atualizados
  } finally {
    pushPolling = false;
  }
}

function startPushPolling() {
  setInterval(pollPush, PUSH_POLL_MS);
}

module.exports = { getVapidPublicKey, subscribe, unsubscribe, startPushPolling };
