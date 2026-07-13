// DIGEST DIÁRIO — "resumo da manhã" gerado no servidor (roda mesmo com o app
// fechado, como o push). Junta o estado das tarefas do usuário, pede à IA um
// briefing curto (com fallback sem IA) e entrega: Web Push, telinha do teclado
// (K86) e persistência pra exibir in-app. Ver [[notifications-architecture]].
const axios = require('axios');
const { buildAuthHeaders } = require('../lib/redmine');
const { fetchAllIssues } = require('../lib/pagination');
const { REDMINE_CF, REDMINE_STATUS } = require('../lib/config');
const { getAi } = require('./secretsStore');
const { aiComplete } = require('./ai');
const keyboard = require('./keyboardNotify');
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const ymd = (d) => d.toISOString().slice(0, 10);

// Coleta o estado relevante das tarefas do usuário (mesmo padrão do push).
async function gather(rec) {
  const client = axios.create({
    baseURL: rec.url,
    headers: {
      ...buildAuthHeaders(rec.key || '', rec.username || '', rec.password || ''),
      'Content-Type': 'application/json',
    },
  });
  const me = (await client.get('/users/current.json')).data.user;
  const uid = me.id;

  const assigned = await fetchAllIssues(client, { assigned_to_id: 'me', status_id: 'open' });
  const toReview = await fetchAllIssues(client, {
    [`cf_${REDMINE_CF.reviewer}`]: uid,
    status_id: REDMINE_STATUS.pendingReview,
  });

  const today = ymd(new Date());
  const yesterday = ymd(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const overdue = assigned.filter((i) => i.due_date && i.due_date < today);
  const dueToday = assigned.filter((i) => i.due_date === today);

  let doneRecently = [];
  try {
    doneRecently = await fetchAllIssues(client, {
      assigned_to_id: 'me',
      status_id: 'closed',
      updated_on: `>=${yesterday}`,
    });
  } catch {
    /* opcional */
  }

  return {
    uid,
    name: me.firstname || me.login || '',
    counts: {
      assigned: assigned.length,
      toReview: toReview.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      doneRecently: doneRecently.length,
    },
    assigned,
    toReview,
    overdue,
    dueToday,
    doneRecently,
  };
}

// Briefing sem IA (fallback): headline + bullets a partir dos números.
function fallbackDigest(data) {
  const c = data.counts;
  const lines = [];
  if (c.overdue) lines.push(`${c.overdue} tarefa(s) atrasada(s) — priorize hoje.`);
  if (c.dueToday) lines.push(`${c.dueToday} vence(m) hoje.`);
  if (c.toReview) lines.push(`${c.toReview} aguardando sua revisão.`);
  lines.push(`${c.assigned} tarefa(s) abertas atribuídas a você.`);
  if (c.doneRecently) lines.push(`${c.doneRecently} concluída(s) desde ontem. 👏`);
  const headline = c.overdue
    ? `${c.overdue} atrasada(s), ${c.dueToday} p/ hoje`
    : c.dueToday
      ? `${c.dueToday} vence(m) hoje`
      : c.toReview
        ? `${c.toReview} p/ revisar`
        : 'Dia tranquilo';
  return { headline, lines: lines.slice(0, 5) };
}

// Briefing com IA: texto curto em PT-BR. 1ª linha = headline; demais = bullets.
async function aiDigest(data, ai) {
  const brief = (arr, n = 6) =>
    arr
      .slice(0, n)
      .map((i) => `#${i.id} ${i.subject}${i.due_date ? ` (vence ${i.due_date})` : ''}`)
      .join('\n');
  const user =
    `Usuário: ${data.name}\n` +
    `Atrasadas (${data.overdue.length}):\n${brief(data.overdue) || '—'}\n\n` +
    `Vencem hoje (${data.dueToday.length}):\n${brief(data.dueToday) || '—'}\n\n` +
    `Aguardando minha revisão (${data.toReview.length}):\n${brief(data.toReview) || '—'}\n\n` +
    `Abertas atribuídas a mim (${data.counts.assigned}) · concluídas desde ontem (${data.counts.doneRecently}).`;
  const system =
    'Você escreve um briefing matinal curto e direto em português do Brasil para um dev. ' +
    'Formato EXATO: a primeira linha é um título de no máximo 6 palavras (sem "#", sem emoji no título); ' +
    'depois 2 a 4 marcadores, um por linha, cada um começando com "- ", priorizando atrasadas e as que vencem hoje. ' +
    'Seja específico e acionável, mencione #IDs quando útil. Sem saudação, sem despedida, sem markdown além do "- ".';
  const text = await aiComplete(ai.provider, ai.key, {
    system,
    user,
    maxTokens: 300,
    fast: true,
    uid: data.uid,
  });
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!rows.length) return fallbackDigest(data);
  const headline = rows[0].replace(/^[-•#\s]+/, '').trim();
  const lines = rows.slice(1).map((l) => l.replace(/^[-•]\s*/, '').trim());
  return { headline, lines: lines.length ? lines : fallbackDigest(data).lines };
}

// Chips pra telinha do K86 (só os que têm contagem > 0).
function digestChips(counts) {
  const chips = [];
  if (counts.overdue)
    chips.push({
      text: `${counts.overdue} atrasada${counts.overdue > 1 ? 's' : ''}`,
      color: '#ef4444',
    });
  if (counts.dueToday) chips.push({ text: `${counts.dueToday} hoje`, color: '#f59e0b' });
  if (counts.toReview) chips.push({ text: `${counts.toReview} revisar`, color: '#a855f7' });
  if (!chips.length) chips.push({ text: `${counts.assigned} abertas`, color: '#3b82f6' });
  return chips.slice(0, 3);
}

// Onde o último digest de cada usuário fica guardado (pra exibir in-app).
const latestFile = (uid) => dataFile(`digest-${uid}.json`);
function getLatest(uid) {
  return readJsonSecure(latestFile(uid), null);
}
function saveLatest(uid, digest) {
  try {
    writeJsonSecure(latestFile(uid), digest);
  } catch (e) {
    console.warn('[digest] falha ao persistir:', e.message);
  }
}

// Monta o digest completo pra um `rec` (assinatura de push, tem creds do Redmine
// + uid). Não entrega por push aqui — quem tem as inscrições é o push.js.
async function build(rec) {
  const data = await gather(rec);
  const ai = rec.uid ? providerFor(rec.uid) : null;
  let digest;
  try {
    digest = ai ? await aiDigest(data, ai) : fallbackDigest(data);
  } catch (e) {
    console.warn('[digest] IA falhou, usando fallback:', e.message);
    digest = fallbackDigest(data);
  }
  const result = {
    name: data.name,
    headline: digest.headline,
    lines: digest.lines,
    counts: data.counts,
    generatedAt: Date.now(),
    ai: !!ai,
  };
  saveLatest(data.uid, result);
  // Telinha do teclado (best-effort).
  keyboard.notify({
    type: 'summary',
    title: `Bom dia${data.name ? ', ' + data.name : ''}`,
    subtitle: result.headline,
    chips: digestChips(data.counts),
  });
  return { uid: data.uid, result };
}

// Resolve o provedor de IA do cofre por uid (versão sem req, pra jobs de fundo).
function providerFor(uid) {
  const ai = getAi(uid) || {};
  let provider = null;
  if (ai.anthropic) provider = 'anthropic';
  else if (ai.openai) provider = 'openai';
  else if (ai.gemini) provider = 'gemini';
  else if (ai.local) provider = 'local';
  if (!provider) return null;
  const key = provider === 'local' ? ai.local || 'local' : ai[provider];
  return { provider, key };
}

// Payload de Web Push do digest (o push.js chama sendPush com isto).
function pushPayload(result) {
  return {
    title: `☀️ Bom dia — ${result.headline}`,
    body: result.lines.slice(0, 3).join('\n'),
    tag: 'bluemine-digest',
    url: '/?digest=1',
  };
}

module.exports = { build, getLatest, pushPayload, providerFor };
