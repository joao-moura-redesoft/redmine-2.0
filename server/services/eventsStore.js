// Eventos/reuniões locais do calendário, persistidos por usuário do Redmine
// (cifrado via DPAPI). Usado quando não há Zimbra configurado ou para blocos
// pessoais/informais — os que não vão para o calendário corporativo.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const EVENTS_FILE = dataFile('events.json');
let eventsStore = readJsonSecure(EVENTS_FILE, {}); // { [userId]: LocalEvent[] }
const saveEvents = () => writeJsonSecure(EVENTS_FILE, eventsStore);

function userEvents(userId) {
  if (!eventsStore[userId]) eventsStore[userId] = [];
  return eventsStore[userId];
}

const KINDS = new Set(['video', 'presencial', 'informal']);

// Cria um evento local a partir do corpo da requisição, validando os campos.
function addEvent(userId, b = {}) {
  const start = Number(b.start);
  const end = Number(b.end);
  if (!b.subject || !String(b.subject).trim()) {
    const e = new Error('Assunto obrigatório.');
    e.statusCode = 400;
    e.isSafe = true;
    throw e;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    const e = new Error('Início e fim inválidos.');
    e.statusCode = 400;
    e.isSafe = true;
    throw e;
  }
  const now = Date.now();
  const event = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    subject: String(b.subject).trim(),
    start,
    end,
    location: typeof b.location === 'string' ? b.location : '',
    description: typeof b.description === 'string' ? b.description : '',
    kind: KINDS.has(b.kind) ? b.kind : 'informal',
    allDay: !!b.allDay,
    createdAt: now,
    updatedAt: now,
  };
  userEvents(userId).push(event);
  saveEvents();
  return event;
}

// Eventos do usuário que intersectam a janela [start, end] (epoch ms).
function listEvents(userId, { start, end } = {}) {
  const s = Number(start);
  const e = Number(end);
  const all = userEvents(userId);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return all;
  return all.filter((ev) => ev.end > s && ev.start < e);
}

function removeEvent(userId, id) {
  eventsStore[userId] = userEvents(userId).filter((ev) => ev.id !== id);
  saveEvents();
}

module.exports = { userEvents, listEvents, addEvent, removeEvent, saveEvents };
