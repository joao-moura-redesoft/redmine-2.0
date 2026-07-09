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
const { REDMINE_CF, REDMINE_STATUS } = require('../lib/config');
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');
const keyboard = require('./keyboardNotify');
const digest = require('./digest');

// Tag/tipo do card na telinha do teclado (K86) por categoria de issue.
const KB_ISSUE = {
  assigned: { type: 'issue', tag: 'Nova tarefa' },
  review: { type: 'review', tag: 'Revisão' },
  monitored: { type: 'issue', tag: 'Monitorando' },
};

// Web Push ligado por padrão. Desligue com PUSH_ENABLED=0 (ou false) no .env.
const PUSH_ENABLED = !(
  process.env.PUSH_ENABLED === '0' || /^false$/i.test(process.env.PUSH_ENABLED || '')
);

// VAPID: carrega ou gera o par de chaves uma única vez (persistido em vapid.json).
// Só inicializa quando o push está habilitado — assim, desligado, nem gera chaves.
// Contato VAPID configurável via PUSH_CONTACT.
const VAPID_FILE = dataFile('vapid.json');
let vapid = null;
if (PUSH_ENABLED) {
  vapid = readJsonSecure(VAPID_FILE, null);
  if (!vapid || !vapid.publicKey || !vapid.privateKey) {
    vapid = webpush.generateVAPIDKeys();
    writeJsonSecure(VAPID_FILE, vapid, { requireEncryption: true }); // contém a chave privada VAPID
    console.log('[push] novas chaves VAPID geradas');
  }
  webpush.setVapidDetails(
    process.env.PUSH_CONTACT || 'mailto:admin@b2click.com',
    vapid.publicKey,
    vapid.privateKey,
  );
} else {
  console.log('[push] Web Push desabilitado (defina PUSH_ENABLED=1 para habilitar)');
}

// Inscrições persistidas: [{ endpoint, subscription, url, key, updatedAt, seen:{...} }]
const SUBS_FILE = dataFile('push-subscriptions.json');
let subscriptions = readJsonSecure(SUBS_FILE, []);
subscriptions.forEach((s) => {
  if (!s.updatedAt) s.updatedAt = Date.now();
}); // backfill p/ TTL
// requireEncryption: cada inscrição guarda credenciais do Redmine (url/key/senha)
// e do Talk — nunca devem ir para o disco em texto puro.
const saveSubs = () => writeJsonSecure(SUBS_FILE, subscriptions, { requireEncryption: true });

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
  const review = await fetchAllIssues(client, {
    [`cf_${REDMINE_CF.reviewer}`]: me,
    status_id: REDMINE_STATUS.pendingReview,
  });
  const monitoredAll = await fetchAllIssues(client, {
    [`cf_${REDMINE_CF.developer}`]: me,
    status_id: 'open',
  });
  const monitored = monitoredAll.filter(
    (i) => !i.assigned_to || String(i.assigned_to.id) !== String(me),
  );

  const byId = new Map();
  [...assigned, ...review, ...monitored].forEach((i) => byId.set(i.id, i));
  return {
    issues: byId,
    seen: {
      assigned: assigned.map((i) => i.id),
      review: review.map((i) => i.id),
      monitored: monitored.map((i) => i.id),
    },
  };
}

function getVapidPublicKey() {
  return vapid ? vapid.publicKey : null;
}

async function subscribe(req) {
  if (!PUSH_ENABLED) return;
  const url = req.headers['x-redmine-url'];
  const key = req.headers['x-redmine-key'] || '';
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const subscription = req.body?.subscription;

  const { getMyUserId } = require('../lib/redmine');
  const { getTalkAuth } = require('./talkStore');
  const uid = await getMyUserId(req);
  const talkAuth = uid ? getTalkAuth(uid) : null;

  const talkPrefs = req.body?.talkPrefs || null; // { groupMentionsOnly, realtime } — opcional
  const hasAuth = !!(key || (username && password));
  if (!url || !hasAuth || !subscription?.endpoint) {
    console.warn('[push] subscribe rejeitado — faltando:', {
      url: !!url,
      hasAuth,
      endpoint: !!subscription?.endpoint,
    });
    throw Object.assign(new Error('subscription e credenciais são obrigatórios'), {
      statusCode: 400,
    });
  }

  // Estado inicial para não disparar como "novo" tudo o que já existe hoje.
  let seen = { assigned: [], review: [], monitored: [] };
  try {
    seen = (await collectPushState(url, key, username, password)).seen;
  } catch (e) {
    console.warn('[push] não consegui inicializar o estado:', e.response?.status || e.message);
  }

  // Estado inicial do Talk: pega o lastMessage.id de cada sala para não notificar retroativamente.
  let talkSeen = {};
  if (talkAuth?.url && talkAuth?.user && talkAuth?.token) {
    try {
      const talkClient = axios.create({
        baseURL: talkAuth.url,
        auth: { username: talkAuth.user, password: talkAuth.token },
        headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
      });
      const { data } = await talkClient.get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
      for (const room of data.ocs.data || []) {
        if (room.lastMessage?.id) talkSeen[room.token] = room.lastMessage.id;
      }
    } catch (e) {
      console.warn('[push] não inicializei estado Talk:', e.response?.status || e.message);
    }
  }

  const rec = {
    endpoint: subscription.endpoint,
    subscription,
    url,
    key,
    username,
    password,
    seen,
    uid,
    talkPrefs,
    talkSeen,
    updatedAt: Date.now(),
  };
  const idx = subscriptions.findIndex((s) => s.endpoint === subscription.endpoint);
  if (idx >= 0) subscriptions[idx] = rec;
  else subscriptions.push(rec);
  saveSubs();
  console.log(
    `[push] inscrição registrada (${subscriptions.length} no total)${talkAuth ? ' com Talk' : ''}`,
  );
}

function unsubscribe(req) {
  const endpoint = req.body?.endpoint;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  saveSubs();
}

// Envia uma notificação; remove a inscrição se o navegador disser que expirou (404/410).
async function sendPush(rec, payload) {
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      subscriptions = subscriptions.filter((s) => s.endpoint !== rec.endpoint);
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
  subscriptions = subscriptions.filter((s) => now - (s.updatedAt || now) < SUB_TTL_MS);
  if (subscriptions.length !== before) {
    console.log(`[push] ${before - subscriptions.length} inscrição(ões) expiradas por inatividade`);
    // Em loop de polling: não deixa erro de criptografia virar unhandledRejection.
    try {
      saveSubs();
    } catch (e) {
      console.error('[push] falha ao persistir poda de inscrições:', e.message);
    }
  }
  if (subscriptions.length === 0) return;
  pushPolling = true;
  try {
    for (const rec of [...subscriptions]) {
      try {
        const { issues, seen } = await collectPushState(
          rec.url,
          rec.key || '',
          rec.username || '',
          rec.password || '',
        );
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
          keyboard.notify({
            type: KB_ISSUE[type].type,
            title: issue.subject,
            subtitle: `#${issue.id} • ${issue.project?.name ?? ''}`,
            tag: KB_ISSUE[type].tag,
          });
        }
        // Talk é tratado num loop próprio e mais rápido (pollTalkPush) — não aqui,
        // para não ficar atrás da paginação pesada do Redmine.
      } catch (err) {
        console.warn('[push] poll falhou para uma inscrição:', err.response?.status || err.message);
      }
    }
    saveSubs(); // persiste os "seen" atualizados
  } finally {
    pushPolling = false;
  }
}

// Loop dedicado do Talk: a listagem de salas é UM request barato, então pode rodar
// bem mais frequente que o poll do Redmine (que pagina várias chamadas). Isso derruba
// a latência das notificações de Talk com a aba fechada de ~60-90s para ~TALK_PUSH_POLL_MS.
// Configuráveis por env var (ms / nº de requests simultâneos).
const TALK_PUSH_POLL_MS = Number(process.env.TALK_PUSH_POLL_MS) || 12 * 1000;
const TALK_REALTIME_POLL_MS = Number(process.env.TALK_REALTIME_POLL_MS) || 3 * 1000;
const TALK_POLL_CONCURRENCY = Number(process.env.TALK_POLL_CONCURRENCY) || 6;

// Preferências padrão para inscrições antigas (sem talkPrefs). groupMentionsOnly=false
// preserva o comportamento atual (notifica tudo) até o cliente re-inscrever com as prefs reais.
function recPrefs(rec) {
  return {
    groupMentionsOnly: rec.talkPrefs?.groupMentionsOnly === true,
    realtime: rec.talkPrefs?.realtime === true,
  };
}

// Agrupa as inscrições por conta de Talk (url+user) → 1 request por usuário, não por
// dispositivo. A carga passa a escalar com pessoas, não aparelhos.
function buildTalkGroups() {
  const { getTalkAuth } = require('./talkStore');
  const groups = new Map();
  for (const rec of subscriptions) {
    if (!rec.uid) continue;
    const talkAuth = getTalkAuth(rec.uid);
    if (!(talkAuth?.url && talkAuth?.user && talkAuth?.token)) continue;
    const key = `${talkAuth.url}\n${talkAuth.user}`;
    let g = groups.get(key);
    if (!g) {
      g = { auth: talkAuth, recs: [] };
      groups.set(key, g);
    }
    g.recs.push(rec);
  }
  return [...groups.values()];
}

// Roda fn sobre items com no máximo `limit` execuções simultâneas (pool de concorrência).
async function mapPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// Polla um grupo (1 usuário) e notifica os dispositivos dele conforme as prefs de cada um.
// Retorna true se algum talkSeen mudou (precisa persistir).
async function pollTalkGroup({ auth, recs }) {
  let changed = false;
  try {
    const talkClient = axios.create({
      baseURL: auth.url,
      auth: { username: auth.user, password: auth.token },
      headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    });
    const { data: tData } = await talkClient.get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
    recs.forEach((r) => {
      if (!r.talkSeen) r.talkSeen = {};
    });

    for (const room of tData.ocs.data || []) {
      if (room.type === 6) continue; // changelog
      const isDM = room.type === 1;
      const lastMsgId = room.lastMessage?.id || 0;
      // Baseline = maior talkSeen entre os dispositivos do grupo, para não re-notificar
      // num aparelho que já viu (e não disparar retroativo no primeiro poll de um novo).
      const seenId = Math.max(0, ...recs.map((r) => r.talkSeen[room.token] || 0));

      if (lastMsgId > seenId && seenId > 0 && room.unreadMessages > 0) {
        const body = resolveMessageTextServer(room.lastMessage);
        const sender = room.lastMessage?.actorDisplayName?.split(' ')[0] || '';
        const payload = {
          title: `💬 ${room.displayName}`,
          body: sender ? `${sender}: ${body}` : body,
          tag: `talk-${room.token}-${lastMsgId}`,
          url: `/?talkRoom=${room.token}`,
          talkToken: room.token,
        };
        // Telinha do teclado (uma vez por mensagem nova). DM vira card "talk";
        // grupo com menção vira "mention"; grupo normal vira "talk".
        keyboard.notify(
          isDM
            ? { type: 'talk', title: sender || room.displayName, subtitle: body, tag: 'Talk • DM' }
            : {
                type: room.unreadMention ? 'mention' : 'talk',
                title: room.displayName,
                subtitle: sender ? `${sender}: ${body}` : body,
                tag: `# ${room.displayName}`,
              },
        );
        for (const rec of recs) {
          // Filtro de ruído: em grupo, dispositivos com groupMentionsOnly só recebem se
          // a sala tem menção não lida. DMs sempre passam.
          if (!isDM && recPrefs(rec).groupMentionsOnly && !room.unreadMention) continue;
          await sendPush(rec, payload); // fanout p/ todos os dispositivos elegíveis
        }
      }

      if (lastMsgId) {
        for (const rec of recs) {
          if (rec.talkSeen[room.token] !== lastMsgId) {
            rec.talkSeen[room.token] = lastMsgId;
            changed = true;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[push] poll Talk falhou:', err.response?.status || err.message);
  }
  return changed;
}

const groupIsRealtime = (g) => g.recs.some((r) => recPrefs(r).realtime);

// Loop normal (grupos sem tempo real) e loop rápido (grupos com tempo real ativo).
// Cada um com seu próprio guard para não se bloquearem.
let talkPollingNormal = false;
let talkPollingFast = false;
async function runTalkPoll(filterFn, getGuard, setGuard) {
  if (getGuard()) return;
  const groups = buildTalkGroups().filter(filterFn);
  if (groups.length === 0) return;
  setGuard(true);
  try {
    let changed = false;
    await mapPool(groups, TALK_POLL_CONCURRENCY, async (g) => {
      if (await pollTalkGroup(g)) changed = true;
    });
    if (changed) saveSubs(); // persiste os talkSeen atualizados
  } finally {
    setGuard(false);
  }
}

// ── DIGEST DIÁRIO ──────────────────────────────────────────────────────────
// Uma vez por dia, por usuário, no horário configurado (padrão 08:00), monta o
// "resumo da manhã" e entrega por Web Push (+ telinha K86, dentro do digest.build).
const DIGEST_ENABLED = !(
  process.env.DIGEST_ENABLED === '0' || /^false$/i.test(process.env.DIGEST_ENABLED || '')
);
const DIGEST_HOUR = Number.isFinite(Number(process.env.DIGEST_HOUR))
  ? Number(process.env.DIGEST_HOUR)
  : 8;
const DIGEST_MIN = Number(process.env.DIGEST_MINUTE) || 0;
const ymd = (d) => d.toISOString().slice(0, 10);
let digestRunning = false;

async function runDigests() {
  if (!DIGEST_ENABLED || digestRunning) return;
  const now = new Date();
  const passed =
    now.getHours() > DIGEST_HOUR || (now.getHours() === DIGEST_HOUR && now.getMinutes() >= DIGEST_MIN);
  if (!passed) return;
  const today = ymd(now);
  const pending = subscriptions.filter((s) => s.uid && s.digestDate !== today);
  if (!pending.length) return;

  digestRunning = true;
  try {
    // Agrupa por usuário: monta 1 digest por pessoa (fetch+IA custam), entrega a
    // todos os dispositivos dela.
    const byUid = new Map();
    for (const rec of pending) {
      if (!byUid.has(rec.uid)) byUid.set(rec.uid, []);
      byUid.get(rec.uid).push(rec);
    }
    for (const [uid, recs] of byUid) {
      try {
        const { result } = await digest.build(recs[0]);
        const payload = digest.pushPayload(result);
        for (const rec of recs) await sendPush(rec, payload);
      } catch (err) {
        console.warn('[digest] falhou para uid', uid, '—', err.response?.status || err.message);
      }
      // Marca como processado hoje (mesmo em erro: evita marteladas; tenta amanhã).
      recs.forEach((r) => {
        r.digestDate = today;
      });
    }
    saveSubs();
  } finally {
    digestRunning = false;
  }
}

function startPushPolling() {
  if (DIGEST_ENABLED) setInterval(runDigests, 5 * 60 * 1000);

  if (!PUSH_ENABLED) {
    console.log('[push] polling desabilitado (PUSH_ENABLED!=1)');
    return;
  }
  setInterval(pollPush, PUSH_POLL_MS);
  setInterval(
    () =>
      runTalkPoll(
        (g) => !groupIsRealtime(g),
        () => talkPollingNormal,
        (v) => {
          talkPollingNormal = v;
        },
      ),
    TALK_PUSH_POLL_MS,
  );
  setInterval(
    () =>
      runTalkPoll(
        groupIsRealtime,
        () => talkPollingFast,
        (v) => {
          talkPollingFast = v;
        },
      ),
    TALK_REALTIME_POLL_MS,
  );
}

module.exports = { getVapidPublicKey, subscribe, unsubscribe, startPushPolling };
