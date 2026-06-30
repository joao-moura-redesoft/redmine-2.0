// PRESENÇA JITSI — estado em memória de quem está em cada sala de vídeo da War Room.
// Alimenta o badge "AO VIVO" nos cards e o auto-logging da reunião no Redmine
// quando a sala esvazia. Não depende de API admin do servidor Jitsi: os próprios
// clientes reportam presença via heartbeat/leave.
const axios = require('axios');

// roomName -> {
//   issueId, startedAt, names:Set, auth,
//   participants: Map(key -> { name, joinedAt, lastSeen })
// }
const rooms = new Map();

const TTL_MS = 90 * 1000; // participante sem heartbeat por 90s vira "fantasma"
const SWEEP_MS = 30 * 1000; // varredura periódica
const MIN_LOG_MS = 60 * 1000; // não auto-loga reuniões com menos de 1 min

function issueIdFromRoom(room) {
  const m = /^B2Click-Issue-(\d+)$/.exec(room || '');
  return m ? Number(m[1]) : null;
}

function partKey(name) {
  return (name || '').trim().toLowerCase() || `anon-${Math.random().toString(36).slice(2, 7)}`;
}

// Upsert de participante (serve para join e heartbeat).
function touch(room, name, auth) {
  if (!room) return;
  const now = Date.now();
  let r = rooms.get(room);
  if (!r) {
    r = {
      issueId: issueIdFromRoom(room),
      startedAt: now,
      names: new Set(),
      participants: new Map(),
      auth,
    };
    rooms.set(room, r);
  }
  // Mantém o auth mais recente válido (usado para finalizar via TTL, sem request).
  if (auth && (auth.key || (auth.user && auth.pass))) r.auth = auth;
  const key = partKey(name);
  const existing = r.participants.get(key);
  if (existing) existing.lastSeen = now;
  else r.participants.set(key, { name: name || 'Alguém', joinedAt: now, lastSeen: now });
  if (name) r.names.add(name);
}

// Saída explícita de um participante; finaliza a sala se ficou vazia.
async function leave(room, name, auth) {
  const r = rooms.get(room);
  if (!r) return;
  r.participants.delete(partKey(name));
  if (r.participants.size === 0) await finalize(room, auth || r.auth);
}

// Encerra a sala: remove do estado e, se for sala de tarefa com participação
// relevante, posta a nota de resumo no Redmine.
async function finalize(room, auth) {
  const r = rooms.get(room);
  if (!r) return;
  rooms.delete(room);

  const durationMs = Date.now() - r.startedAt;
  if (!r.issueId || r.names.size === 0 || durationMs < MIN_LOG_MS) return;
  if (!auth || !(auth.key || (auth.user && auth.pass)) || !auth.url) return;

  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const participants = [...r.names];
  const notes = `📞 Reunião na War Room finalizada. Duração: ${minutes} min. Participantes: ${participants.join(', ')}.`;

  try {
    await postNote(auth, r.issueId, notes);
  } catch (e) {
    console.error(
      '[jitsiPresence] falha ao auto-logar reunião',
      r.issueId,
      e.response?.status || e.message,
    );
  }
}

function postNote(auth, issueId, notes) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.key) headers['X-Redmine-API-Key'] = auth.key;
  else
    headers['Authorization'] =
      'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64');
  return axios.put(`${auth.url}/issues/${issueId}.json`, { issue: { notes } }, { headers });
}

// Varre salas: descarta participantes sem heartbeat e finaliza salas vazias.
function sweep() {
  const now = Date.now();
  for (const [room, r] of rooms) {
    for (const [key, p] of r.participants) {
      if (now - p.lastSeen > TTL_MS) r.participants.delete(key);
    }
    if (r.participants.size === 0) finalize(room, r.auth);
  }
}

const timer = setInterval(sweep, SWEEP_MS);
if (timer.unref) timer.unref();

// Resumo das salas ativas para o frontend (badge AO VIVO).
function activeRooms() {
  const out = [];
  for (const [room, r] of rooms) {
    if (r.participants.size === 0) continue;
    out.push({
      room,
      issueId: r.issueId,
      count: r.participants.size,
      participants: [...r.participants.values()].map((p) => p.name),
    });
  }
  return out;
}

module.exports = { touch, leave, finalize, activeRooms };
