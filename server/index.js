const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path'); // <-- ADICIONADO: Importação explícita do path
const fs = require('fs');
const webpush = require('web-push');
const { spawnSync, spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const zimbra = require('./zimbra');
const doku = require('./dokuwiki');

const app = express();
const PORT = process.env.PORT || 3001;

const DEFAULT_URL = '';
const DEFAULT_KEY = '';

// AJUSTADO: Adicionado suporte para a porta 3001 onde o front+back rodarão juntos
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001'] }));
app.use(express.json());

// Guarda as últimas credenciais autenticadas (para requests sem headers, como <img> de anexos).
let lastAuth = { url: DEFAULT_URL, key: DEFAULT_KEY, username: '', password: '' };

// Retorna os headers de autenticação corretos dependendo do modo (token vs usuário/senha).
function buildAuthHeaders(key, username, password) {
  if (username && password) {
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    return { 'Authorization': `Basic ${token}` };
  }
  return { 'X-Redmine-API-Key': key };
}

// Cria instância do axios para cada request com as credenciais certas
function makeRedmine(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  if (url && (key || (username && password))) lastAuth = { url, key, username, password };
  return axios.create({
    baseURL: url,
    headers: { ...buildAuthHeaders(key, username, password), 'Content-Type': 'application/json' },
  });
}

// --- Sincronizacao com o Concierge (app Delphi local) ---
// Quando uma issue vai para "Em andamento", aponta a tarefa no Concierge
// automaticamente, rodando o agente PowerShell (fire-and-forget).
const CONCIERGE_SCRIPT = path.join(__dirname, '..', 'automation', 'concierge-set-task.ps1');
// nome do status considerado "em andamento" (regex, configuravel por env)
const CONCIERGE_INPROGRESS_RE = new RegExp(process.env.CONCIERGE_INPROGRESS || 'andamento|progress', 'i');
const CONCIERGE_ENABLED = process.env.CONCIERGE_AUTOMATION !== '0'; // ligado por padrao

function syncConcierge(taskId, subject) {
  if (!CONCIERGE_ENABLED) return;
  if (process.platform !== 'win32') return;
  if (!fs.existsSync(CONCIERGE_SCRIPT)) return;
  try {
    const args = ['-ExecutionPolicy', 'Bypass', '-File', CONCIERGE_SCRIPT, '-TaskId', String(taskId)];
    if (subject) args.push('-ExpectTitle', subject);
    const child = spawn('powershell', args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => console.error('[concierge] spawn falhou:', e.message));
    child.unref();
    console.log(`[concierge] sincronizando tarefa ${taskId}${subject ? ` (${subject})` : ''}`);
  } catch (e) {
    console.error('[concierge] erro ao sincronizar:', e.message);
  }
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

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) {
    const status = err.statusCode || err.response?.status || 500;
    const data   = err.response?.data ?? (err.statusCode ? { error: err.message } : undefined);
    console.error(`[${req.method} ${req.path}] ${status}:`, JSON.stringify(data ?? err.message));
    res.status(status).json(data ?? { error: err.message });
  }
};

// Busca TODAS as páginas de um recurso paginado (genérico).
async function fetchAllPages(redmine, path, key, params, max = 2000) {
  const limit = 100;
  let offset = 0, all = [], total = Infinity;
  while (offset < total && all.length < max) {
    const { data } = await redmine.get(path, { params: { ...params, limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data[key] || []);
    if ((data[key] || []).length === 0) break;
    offset += limit;
  }
  return all;
}

// Roda `fn` sobre os itens com no máximo `limit` chamadas simultâneas.
// Usado para buscar detalhes (relations/journals) de várias issues sem
// estourar o Redmine com N requests paralelos.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Busca TODAS as páginas de issues para um conjunto de filtros (remove o teto de 100).
// Trava de segurança em 2000 para não varrer bases enormes sem querer.
async function fetchAllIssues(redmine, params) {
  const limit = 100;
  const MAX = 2000;
  let offset = 0, all = [], total = Infinity;
  while (offset < total && all.length < MAX) {
    const { data } = await redmine.get('/issues.json', { params: { ...params, limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data.issues || []);
    if ((data.issues || []).length === 0) break;
    offset += limit;
  }
  return all;
}

// Minhas issues
app.get('/api/issues', handle(async (req, res) => {
  const { limit, offset, ...rest } = req.query; // ignora limit/offset do cliente; paginamos tudo
  const params = { assigned_to_id: 'me', status_id: '*', include: 'children', ...rest };
  const issues = await fetchAllIssues(makeRedmine(req), params);
  res.json({ issues, total_count: issues.length });
}));

// Tarefas por ID (para "Observadas" locais) — sem filtro de responsável, qualquer tarefa visível
app.get('/api/issues/by-ids', handle(async (req, res) => {
  const ids = String(req.query.ids || '').trim();
  if (!ids) return res.json({ issues: [], total_count: 0 });
  const issues = await fetchAllIssues(makeRedmine(req), { issue_id: ids, status_id: '*' });
  res.json({ issues, total_count: issues.length });
}));

// Issues onde sou o DEV Desenvolvedor(a) (CF 141) mas NÃO estou como responsável
app.get('/api/issues/monitored', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  const all = await fetchAllIssues(makeRedmine(req), { cf_141: userId, status_id: 'open' });
  const issues = all.filter(
    i => !i.assigned_to || String(i.assigned_to.id) !== String(userId)
  );
  res.json({ issues, total_count: issues.length });
}));

// Issues que eu criei
app.get('/api/issues/authored', handle(async (req, res) => {
  const issues = await fetchAllIssues(makeRedmine(req), { author_id: 'me', status_id: 'open' });
  res.json({ issues, total_count: issues.length });
}));

// Para eu revisar: sou o DEV Revisor (CF 210) e a tarefa está em Pendente Revisão (71)
app.get('/api/issues/to-review', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  const issues = await fetchAllIssues(makeRedmine(req), { cf_210: userId, status_id: 71 });
  res.json({ issues, total_count: issues.length });
}));

// Detecção de @menção: varre os journals recentes das tarefas em que estou
// envolvido e devolve as notas que citam meu nome/login.
app.get('/api/issues/mentions', handle(async (req, res) => {
  const redmine = makeRedmine(req);
  const { data: me } = await redmine.get('/users/current.json');
  const user = me.user;
  const userId = user.id;
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Conjunto de candidatas: atribuídas a mim, criadas por mim, onde sou dev (141) ou revisor (210).
  const sets = await Promise.all([
    fetchAllIssues(redmine, { assigned_to_id: 'me', status_id: '*', sort: 'updated_on:desc' }),
    fetchAllIssues(redmine, { author_id: 'me', status_id: 'open', sort: 'updated_on:desc' }),
    fetchAllIssues(redmine, { cf_141: userId, status_id: 'open', sort: 'updated_on:desc' }),
    fetchAllIssues(redmine, { cf_210: userId, status_id: 'open', sort: 'updated_on:desc' }),
  ]);
  const byId = new Map();
  sets.flat().forEach(i => { if (!byId.has(i.id)) byId.set(i.id, i); });
  // Só vale a pena abrir as que mudaram na última semana.
  const candidates = [...byId.values()]
    .filter(i => new Date(i.updated_on).getTime() >= sinceMs)
    .slice(0, 60);

  // Padrões de menção: "@login", "@Nome", nome completo, ou login isolado.
  const needles = [user.login, user.firstname, `${user.firstname} ${user.lastname}`]
    .filter(Boolean).map(s => s.toLowerCase());
  const matches = (text) => {
    const t = text.toLowerCase();
    if (t.includes(`@${user.login.toLowerCase()}`)) return true;
    if (t.includes(`@${user.firstname.toLowerCase()}`)) return true;
    return needles.some(n => n.includes(' ') && t.includes(n)); // nome completo
  };

  const detailed = await mapLimit(candidates, 6, async (i) => {
    const { data } = await redmine.get(`/issues/${i.id}.json`, { params: { include: 'journals' } });
    return data.issue;
  });

  const mentions = [];
  for (const issue of detailed) {
    if (!issue) continue;
    for (const j of (issue.journals || [])) {
      if (!j.notes?.trim()) continue;
      if (j.user?.id === userId) continue;
      if (new Date(j.created_on).getTime() < sinceMs) continue;
      if (!matches(j.notes)) continue;
      mentions.push({
        journalId: j.id,
        issue: { id: issue.id, subject: issue.subject, project: issue.project },
        author: j.user,
        snippet: j.notes.trim().replace(/\s+/g, ' ').slice(0, 160),
        created_on: j.created_on,
      });
    }
  }
  mentions.sort((a, b) => new Date(b.created_on) - new Date(a.created_on));
  res.json({ mentions: mentions.slice(0, 30) });
}));

// Tarefas abertas de um projeto (qualquer responsável) — para o Quadro do time
// Sem project_id = todos os projetos visíveis ao usuário
app.get('/api/issues/by-project', handle(async (req, res) => {
  const projectId = req.query.project_id;
  const params = { status_id: 'open' };
  if (projectId) params.project_id = projectId;
  const issues = await fetchAllIssues(makeRedmine(req), params);
  res.json({ issues, total_count: issues.length });
}));

// Issues que eu observo (watcher)
app.get('/api/issues/watched', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  const { data } = await makeRedmine(req).get('/issues.json', {
    params: { watcher_id: userId, status_id: 'open', limit: 100 }
  });
  res.json(data);
}));

// Concluídas recentemente (para dashboard) — fechadas nos últimos 30 dias
app.get('/api/issues/completed', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/issues.json', {
    params: { assigned_to_id: 'me', status_id: 'closed', sort: 'updated_on:desc', limit: 100 }
  });
  res.json(data);
}));

// Busca global por ID ou texto (qualquer issue, não só minhas)
app.get('/api/search', handle(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ issues: [] });
  const redmine = makeRedmine(req);

  // Se for número, tenta buscar pelo ID direto
  if (/^\d+$/.test(q)) {
    try {
      const { data } = await redmine.get(`/issues/${q}.json`);
      return res.json({ issues: [data.issue] });
    } catch { /* cai para busca textual */ }
  }

  const { data } = await redmine.get('/issues.json', {
    params: { subject: `~${q}`, status_id: '*', limit: 30, sort: 'updated_on:desc' }
  });
  res.json({ issues: data.issues || [] });
}));

// Watchers: adicionar / remover
app.post('/api/issues/:id/watch', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  await makeRedmine(req).post(`/issues/${req.params.id}/watchers.json`, { user_id: userId });
  res.json({ success: true });
}));

app.delete('/api/issues/:id/watch', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  await makeRedmine(req).delete(`/issues/${req.params.id}/watchers/${userId}.json`);
  res.json({ success: true });
}));

// Issue individual com journals, relações, filhos e status permitidos
app.get('/api/issues/:id', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get(`/issues/${req.params.id}.json`, {
    params: { include: 'journals,attachments,relations,children,watchers,allowed_statuses' }
  });
  res.json(data);
}));

// Atualizar issue — verifica se o status realmente mudou (workflow silencioso)
app.put('/api/issues/:id', handle(async (req, res) => {
  const redmine = makeRedmine(req);
  await redmine.put(`/issues/${req.params.id}.json`, req.body);

  const requestedStatusId = req.body?.issue?.status_id;
  if (requestedStatusId) {
    const { data } = await redmine.get(`/issues/${req.params.id}.json`);
    const actual = data.issue.status;
    if (String(actual.id) !== String(requestedStatusId)) {
      return res.status(422).json({
        error: `Transição não permitida pelo workflow do Redmine. Status atual: "${actual.name}". Configure as transições em Administração → Workflow.`
      });
    }
    // Status confirmado: se virou "Em andamento", aponta no Concierge.
    if (CONCIERGE_INPROGRESS_RE.test(actual.name)) {
      syncConcierge(req.params.id, data.issue.subject);
    }
  }

  res.json({ success: true });
}));

// OpenGraph metadata para preview de links no chat
app.get('/api/og', handle(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL inválida' });
  try {
    const { data: html } = await axios.get(url, {
      timeout: 6000,
      maxContentLength: 400 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlumineFetch/1.0)' },
      responseType: 'text',
    });
    const get = (prop) => {
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      return (html.match(re1) || html.match(re2))?.[1]?.trim() ?? '';
    };
    const title       = get('og:title') || get('twitter:title') || html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || '';
    const description = get('og:description') || get('twitter:description') || '';
    const image       = get('og:image') || get('twitter:image') || '';
    const siteName    = get('og:site_name') || new URL(url).hostname;
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ url, title: title.slice(0, 200), description: description.slice(0, 300), image, siteName });
  } catch {
    try { res.json({ url, title: '', description: '', image: '', siteName: new URL(url).hostname }); }
    catch { res.json({ url, title: '', description: '', image: '', siteName: '' }); }
  }
}));

// Editar nota de journal (PUT /journals/:id.json)
app.put('/api/journals/:id', handle(async (req, res) => {
  await makeRedmine(req).put(`/journals/${req.params.id}.json`, req.body);
  res.json({ success: true });
}));

// Criar issue
app.post('/api/issues', handle(async (req, res) => {
  const { data } = await makeRedmine(req).post('/issues.json', req.body);
  res.json(data);
}));

// Upload de anexo: recebe o binário do arquivo e devolve o token do Redmine.
// (Express.raw específico desta rota; o express.json global ignora octet-stream.)
app.post('/api/uploads', express.raw({ type: '*/*', limit: '50mb' }), handle(async (req, res) => {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  if (url && (key || (username && password))) lastAuth = { url, key, username, password };
  const filename = String(req.query.filename || 'arquivo');
  const { data } = await axios.post(`${url}/uploads.json`, req.body, {
    params: { filename },
    headers: { ...buildAuthHeaders(key, username, password), 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  res.json({ token: data.upload?.token, filename });
}));

// Status
app.get('/api/issue_statuses', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/issue_statuses.json');
  res.json(data);
}));

// Time entries (minhas horas apontadas)
app.get('/api/time_entries', handle(async (req, res) => {
  const { from, to, issue_id, limit = 100 } = req.query;
  const params = { user_id: 'me', limit };
  if (from) params.from = from;
  if (to) params.to = to;
  if (issue_id) params.issue_id = issue_id;
  const entries = await fetchAllPages(makeRedmine(req), '/time_entries.json', 'time_entries', params, 500);
  res.json({ time_entries: entries, total_count: entries.length });
}));

app.post('/api/time_entries', handle(async (req, res) => {
  const { data } = await makeRedmine(req).post('/time_entries.json', req.body);
  res.json(data);
}));

// Atividades de time entries
app.get('/api/enumerations/time_entry_activities', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/enumerations/time_entry_activities.json');
  res.json(data);
}));

// Versões de um projeto
app.get('/api/projects/:id/versions', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get(`/projects/${req.params.id}/versions.json`);
  res.json(data);
}));

// Todas as issues de uma versão (open + closed) — para estatísticas de sprint
app.get('/api/issues/by-version', handle(async (req, res) => {
  const { project_id, version_id } = req.query;
  if (!project_id || !version_id) return res.json({ issues: [], total_count: 0 });
  const issues = await fetchAllIssues(makeRedmine(req), {
    project_id,
    fixed_version_id: version_id,
    status_id: '*',
  });
  res.json({ issues, total_count: issues.length });
}));

// Lista de projetos (paginada). Se o /projects.json do Redmine falhar (ex: 500),
// cai num fallback que monta a lista a partir dos projetos das tarefas visíveis.
async function getProjectList(redmine) {
  try {
    const limit = 100;
    let offset = 0, all = [], total = Infinity;
    while (offset < total) {
      const { data } = await redmine.get('/projects.json', { params: { limit, offset } });
      if (data.total_count != null) total = data.total_count;
      all = all.concat(data.projects || []);
      offset += limit;
      if ((data.projects || []).length === 0) break;
    }
    return all.map(p => ({ id: p.id, name: p.name }));
  } catch (err) {
    console.error('[projects] /projects.json falhou:', err.response?.status,
      JSON.stringify(err.response?.data ?? err.message));
    const { data } = await redmine.get('/issues.json', {
      params: { assigned_to_id: 'me', status_id: '*', limit: 100 }
    });
    const map = new Map();
    for (const i of (data.issues || [])) if (i.project) map.set(i.project.id, i.project.name);
    const projects = [...map.entries()].map(([id, name]) => ({ id, name }));
    console.warn(`[projects] usando fallback por tarefas: ${projects.length} projetos`);
    return projects;
  }
}

// Projetos
app.get('/api/projects', handle(async (req, res) => {
  const projects = (await getProjectList(makeRedmine(req)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json({ projects, total_count: projects.length });
}));

// Membros de TODOS os projetos, unificados (para a opção "Todos os projetos" em Pessoas)
app.get('/api/members', handle(async (req, res) => {
  const redmine = makeRedmine(req);
  const projects = await getProjectList(redmine);
  const overrides = loadTeamOverrides();
  const refTeams = await loadReferenceTeams(req);

  const byId = new Map();
  for (const p of projects) {
    let memberships = [];
    try { memberships = await fetchAllMemberships(redmine, p.id); } catch { /* projeto inacessível */ }
    for (const m of memberships) {
      if (!m.user || byId.has(m.user.id)) continue;
      byId.set(m.user.id, {
        id: m.user.id,
        name: m.user.name,
        team: deriveTeam(m.roles, m.user.id, overrides, refTeams),
      });
    }
  }
  const users = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json({ users });
}));

// Trackers
app.get('/api/trackers', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/trackers.json');
  res.json(data);
}));

// Prioridades
app.get('/api/enumerations/issue_priorities', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/enumerations/issue_priorities.json');
  res.json(data);
}));

// Usuário atual
app.get('/api/users/current', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/users/current.json');
  res.json(data);
}));

// Mapa de prefixo de role → nome amigável de equipe
const TEAM_LABELS = {
  DEV: 'Desenvolvimento',
  REDES: 'Redes & Infra',
  SUP: 'Suporte',
  SUPORTE: 'Suporte',
  COM: 'Comercial',
  CS: 'Customer Success',
  PROJ: 'Projetos',
  IMP: 'Implantação',
  CONTRATO: 'Contratos',
};

// Papel ("role") do Redmine → nome de equipe, pelo prefixo (ex: "DEV Desenvolvedor" → Desenvolvimento)
function roleToTeam(roleName) {
  const prefix = (roleName || '').split(' ')[0].toUpperCase();
  return TEAM_LABELS[prefix] || null;
}

// AJUSTADO: Agora ele usa process.cwd() para buscar o teams.json na mesma pasta que o .exe rodar no Windows.
function loadTeamsConfig() {
  try {
    const raw = require('fs').readFileSync(path.join(__dirname, 'teams.json'), 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}
function loadTeamOverrides() { return loadTeamsConfig().overrides || {}; }

// Busca TODAS as páginas de membros de um projeto
async function fetchAllMemberships(redmine, projectId) {
  const limit = 100;
  let offset = 0, all = [], total = Infinity;
  while (offset < total) {
    const { data } = await redmine.get(`/projects/${projectId}/memberships.json`, { params: { limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data.memberships || []);
    offset += limit;
    if ((data.memberships || []).length === 0) break;
  }
  return all;
}

// Mapa userId -> equipe, derivado de UM projeto de referência (onde os papéis estão certos:
// "DEV ...", "REDES ..." etc). Fica independente do projeto que está sendo olhado na tela.
// O projeto de referência vem do teams.json ("teamSourceProjectId") ou é detectado
// automaticamente entre os projetos das tarefas do próprio usuário (o que tiver mais papéis
// de equipe reconhecíveis). Cacheado por url:key. Não precisa de admin.
const REF_TEAMS_TTL = 10 * 60 * 1000;
const refTeamsCache = new Map(); // "url:key" -> { map: Map<id, team>, projectId, ts }

async function loadReferenceTeams(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const cacheKey = `${url}:${key}`;
  const cached = refTeamsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < REF_TEAMS_TTL) return cached.map;

  const map = new Map();
  let projectId = null;
  try {
    const redmine = makeRedmine(req);

    // 1) Projeto de referência fixado no teams.json?
    const configured = loadTeamsConfig().teamSourceProjectId;
    if (configured) {
      projectId = configured;
    } else {
      // 2) Auto-detecta: entre os projetos das minhas tarefas, o que tem mais papéis de equipe
      const { data } = await redmine.get('/issues.json', {
        params: { assigned_to_id: 'me', status_id: '*', limit: 100 }
      });
      const projIds = [...new Set((data.issues || []).map(i => i.project?.id).filter(Boolean))];
      let bestScore = -1;
      for (const pid of projIds) {
        try {
          const { data: md } = await redmine.get(`/projects/${pid}/memberships.json`, { params: { limit: 100 } });
          const score = (md.memberships || []).reduce(
            (s, m) => s + ((m.roles || []).some(r => roleToTeam(r.name)) ? 1 : 0), 0);
          if (score > bestScore) { bestScore = score; projectId = pid; }
        } catch { /* ignora projeto inacessível */ }
      }
    }

    // 3) Monta o mapa a partir dos membros do projeto de referência
    if (projectId) {
      const memberships = await fetchAllMemberships(redmine, projectId);
      for (const m of memberships) {
        if (!m.user || map.has(m.user.id)) continue;
        for (const r of (m.roles || [])) {
          const t = roleToTeam(r.name);
          if (t) { map.set(m.user.id, t); break; }
        }
      }
    }
  } catch (err) {
    console.warn('[teams] não foi possível montar o mapa de equipes de referência:',
      err.response?.status || err.message);
  }

  refTeamsCache.set(cacheKey, { map, projectId, ts: Date.now() });
  console.log(`[teams] projeto de referência = ${projectId ?? 'nenhum'}, ${map.size} pessoas mapeadas`);
  return map;
}

function deriveTeam(roles, userId, overrides, refTeams) {
  // 1) Override manual tem prioridade
  if (overrides[String(userId)]) return overrides[String(userId)];
  // 2) Equipe vinda do projeto de referência (independente do projeto atual)
  if (refTeams && refTeams.has(userId)) return refTeams.get(userId);
  // 3) Fallback: papel da pessoa no próprio projeto atual
  for (const r of (roles || [])) {
    const t = roleToTeam(r.name);
    if (t) return t;
  }
  return 'Outros';
}

// Membros de um projeto — busca todas as páginas, agrupa por equipe e ordena
app.get('/api/projects/:id/memberships', handle(async (req, res) => {
  const redmine = makeRedmine(req);
  const allMemberships = await fetchAllMemberships(redmine, req.params.id);

  const overrides = loadTeamOverrides();
  const refTeams = await loadReferenceTeams(req);
  const seen = new Set();
  const users = allMemberships
    .filter(m => m.user)
    .map(m => ({ id: m.user.id, name: m.user.name, team: deriveTeam(m.roles, m.user.id, overrides, refTeams) }))
    .filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true; })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  res.json({ users });
}));

// Proxy de download de anexo (imagens inline). Requests de <img> não enviam
// os headers de auth, então usamos as últimas credenciais autenticadas.
app.get('/api/attachments/:id/:filename', handle(async (req, res) => {
  const { url, key, username, password } = lastAuth;
  if (!url || (!key && !(username && password))) return res.status(401).json({ error: 'Não autenticado' });
  const path = `/attachments/download/${req.params.id}/${encodeURIComponent(req.params.filename)}`;
  const upstream = await axios.get(`${url}${path}`, {
    headers: buildAuthHeaders(key, username, password),
    responseType: 'arraybuffer',
  });
  res.set('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(upstream.data));
}));

// =========================================================================
// IA — geração de prompt via Claude API (key por usuário, via header)
// =========================================================================
// A Claude API key é configurada individualmente por cada usuário no próprio
// cliente (localStorage) e enviada ao servidor via header x-anthropic-key.
// O servidor age como proxy — nunca armazena a chave.

// Resolve um ID de usuário do Redmine para o nome completo.
// Retorna o próprio valor se não for um ID numérico ou se a chamada falhar.
async function resolveUserName(redmine, value) {
  if (!value || !/^\d+$/.test(String(value).trim())) return value;
  try {
    const { data } = await redmine.get(`/users/${value}.json`);
    const u = data.user;
    return u ? `${u.firstname} ${u.lastname}`.trim() : value;
  } catch { return value; }
}

// inlineImageNames: set de filenames já enviados inline — excluídos da lista de texto
// para não confundir o modelo (ele já vê as imagens, não precisa do metadado duplicado).
// revisorName: nome já resolvido (passado pelo endpoint para evitar async aqui).
function buildIssueContext(issue, inlineImageNames = new Set(), revisorName = '') {
  const cf = (id) => (issue.custom_fields || []).find(f => f.id === id)?.value || '';
  const branch    = cf(140);
  const revisor   = revisorName || cf(210);
  const notaVersao = cf(213);
  const impacto   = cf(229);
  const previsao  = cf(228);

  const journalLines = (issue.journals || [])
    .filter(j => j.notes?.trim() || j.details?.some(d => d.property === 'attr' && d.name === 'status_id'))
    .slice(-8)
    .map(j => {
      const st = j.details?.find(d => d.property === 'attr' && d.name === 'status_id');
      const parts = [];
      if (st) parts.push(`mudou status → ${st.new_value}`);
      if (j.notes?.trim()) parts.push(j.notes.trim().slice(0, 400));
      return `[${j.created_on?.slice(0, 10)}] ${j.user?.name || '?'}: ${parts.join(' | ')}`;
    }).join('\n');

  // Separa anexos: os que vão inline (imagens já enviadas) vs os demais (listados em texto).
  const otherAttachments = (issue.attachments || [])
    .filter(a => !inlineImageNames.has(a.filename))
    .map(a => `- ${a.filename} (${a.content_type}, ${Math.round((a.filesize || 0) / 1024)}KB)`)
    .join('\n');

  const inlineNote = inlineImageNames.size > 0
    ? `\nImagens enviadas inline (${inlineImageNames.size}): ${[...inlineImageNames].join(', ')}`
    : '';

  return [
    `Tarefa: #${issue.id} — ${issue.subject}`,
    `Status: ${issue.status?.name} | Prioridade: ${issue.priority?.name} | Projeto: ${issue.project?.name}`,
    branch     && `Branch: ${branch}`,
    revisor    && `Revisor: ${revisor}`,
    impacto    && `Impacto: ${impacto}`,
    notaVersao && `Nota de versão: ${notaVersao}`,
    previsao   && `Previsão revisão: ${previsao}`,
    '',
    'Descrição:',
    (issue.description || '(sem descrição)').slice(0, 2000),
    journalLines && `\nHistórico:\n${journalLines}`,
    inlineNote,
    otherAttachments && `\nOutros anexos (não disponíveis inline):\n${otherAttachments}`,
  ].filter(Boolean).join('\n');
}

// Extrai provider + key dos headers. Suporta:
//   x-ai-provider (anthropic|openai) + x-ai-key  ← novo padrão
//   x-anthropic-key                               ← legado
function getAICredentials(req) {
  const provider = req.headers['x-ai-provider'] || 'anthropic';
  const key = req.headers['x-ai-key'] || req.headers['x-anthropic-key'] || '';
  return { provider, key };
}

// Busca um anexo do Redmine e devolve { base64, mediaType } ou null se falhar/muito grande.
const MAX_ATTACH_BYTES = 5 * 1024 * 1024; // 5 MB
async function fetchAttachmentBase64(redmineUrl, authHeaders, attachId, filename) {
  try {
    const resp = await axios.get(
      `${redmineUrl}/attachments/download/${attachId}/${encodeURIComponent(filename)}`,
      { headers: authHeaders, responseType: 'arraybuffer', maxContentLength: MAX_ATTACH_BYTES }
    );
    return {
      base64: Buffer.from(resp.data).toString('base64'),
      mediaType: resp.headers['content-type']?.split(';')[0].trim() || 'image/jpeg',
    };
  } catch (e) {
    console.warn(`[ai] falha ao buscar anexo ${filename}:`, e.message);
    return null;
  }
}

// Bloco de imagem no formato do provider.
function imageBlock(provider, base64, mediaType) {
  if (provider === 'anthropic') {
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
  }
  // OpenAI
  return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } };
}

// Chama o modelo correto e retorna o texto gerado.
// `userContent` aceita array multimodal (texto + imagens); `user` aceita string simples.
async function aiComplete(provider, key, { system, user, userContent, maxTokens = 2048, fast = false }) {
  const content = userContent ?? user;

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key });
    const model = fast ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    });
    return msg.content[0]?.text?.trim() || '';
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: key });
    // Sobe para gpt-4o quando há imagens inline — o mini tende a ignorar a instrução de descrever.
    const hasImages = Array.isArray(content) && content.some(c => c.type === 'image_url');
    const model = (hasImages && !fast) ? 'gpt-4o' : 'gpt-4o-mini';
    const msg = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    });
    return msg.choices[0]?.message?.content?.trim() || '';
  }

  throw new Error(`provider desconhecido: ${provider}`);
}

const PROMPT_SYSTEM = `Você é um assistente especializado no ERP B2click (frontend Delphi, backend Java 21 com sintaxe legada).
Gere prompts autocontidos em Markdown para serem colados em outra sessão de Claude Code.
Responda APENAS com o conteúdo Markdown, sem explicações extras.`;

const PROMPT_TEMPLATE = (context) => `Com base nos dados abaixo, gere um prompt Markdown autocontido seguindo EXATAMENTE esta estrutura:

# Prompt — Tarefa #<ID> (<PRIORIDADE> — <STATUS>)

> Cole o bloco abaixo no Claude Code de destino. O Claude não tem acesso ao Redmine — todo o contexto está aqui.

---

## Contexto do Sistema
<descrição técnica do projeto — usar "ERP cliente-servidor da B2click. Frontend em Delphi, backend em Java 21 com sintaxe legada." e ajustar se o Impacto indicar tecnologia específica>

## Branch
<se há branch preenchida: "Branch existente (não criar nova): \`<branch>\`"; se não há: "Branch a criar: \`#<ID padded 6>-MAS-joao-<slug do assunto>\`">
<se há Revisor preenchido, adicionar: "Revisor: <nome>">
<se há Nota de Versão, citar>
<se há Impacto, citar>

## O Problema
<descrição da issue — preservar informações técnicas, não resumir demais>

## Comentários da revisão *(apenas se status = Pendente Correção — omitir seção caso contrário)*
> <citar literalmente a nota do revisor que voltou a tarefa>

## Histórico relevante *(apenas se houver notas técnicas relevantes no journal — omitir se vazio)*
<citar literalmente comentários técnicos do journal>

## Anexos *(apenas se houver anexos — omitir se vazio)*
<Para cada imagem recebida inline: crie uma subseção "### filename.png" com descrição factual completa — UI visível, textos na tela, mensagens de erro transcritas literalmente, campos e valores. O Claude de destino não terá acesso às imagens originais.>
<Para outros arquivos (PDFs, ZIPs, vídeos): mencione nome + tamanho e instrua o Claude de destino a solicitar o arquivo ao usuário.>

## Hipóteses Técnicas
<3-5 hipóteses inferidas do problema, marcadas como hipótese>

## Sua Tarefa
1. <passo numerado começando por checkout/criação de branch>
2. ...
<incluir: apresentar levantamento ANTES de mudar código para tarefas complexas ou Pendente Correção>
<última etapa: avisar usuário ao terminar para ele atualizar o Redmine>

## Critérios de aceite
- <bullets concretos e verificáveis>

---

DADOS DA TAREFA:
${context}`;

// Gera o prompt completo seguindo o template da skill gerar-prompt-tarefa.
app.post('/api/ai/generate-prompt', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  // Busca imagens dos anexos para enviar inline ao modelo (multimodal).
  // Limite: imagens ≤ 5 MB, no máximo 5 por issue (custo/latência).
  const redmineUrl = req.headers['x-redmine-url'] || lastAuth.url;
  const redmineKey = req.headers['x-redmine-key'] || lastAuth.key;
  const redmineUser = req.headers['x-redmine-user'] || lastAuth.username;
  const redminePass = req.headers['x-redmine-pass'] || lastAuth.password;
  const redmineAuthHeaders = buildAuthHeaders(redmineKey, redmineUser, redminePass);
  const hasRedmineAuth = !!(redmineUrl && (redmineKey || (redmineUser && redminePass)));
  const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
  const imageAttachments = (issue.attachments || [])
    .filter(a => imageTypes.includes(a.content_type?.toLowerCase()) && (a.filesize || 0) <= MAX_ATTACH_BYTES)
    .slice(0, 5);

  const fetchedImages = [];
  if (hasRedmineAuth) {
    for (const att of imageAttachments) {
      const img = await fetchAttachmentBase64(redmineUrl, redmineAuthHeaders, att.id, att.filename);
      if (img) fetchedImages.push({ ...img, filename: att.filename });
    }
  }

  // Resolve o ID do revisor (CF 210) para nome antes de montar o contexto.
  const redmineClient = makeRedmine(req);
  const rawRevisorId = (issue.custom_fields || []).find(f => f.id === 210)?.value || '';
  const revisorName = await resolveUserName(redmineClient, rawRevisorId);

  const inlineNames = new Set(fetchedImages.map(i => i.filename));
  const textContent = PROMPT_TEMPLATE(buildIssueContext(issue, inlineNames, revisorName));

  // Monta conteúdo: texto do template + imagens inline com instrução explícita antes de cada uma.
  // Monta conteúdo multimodal: instrução de descrição fica IMEDIATAMENTE antes de cada imagem
  // para o modelo associar claramente qual imagem descrever.
  const userContent = fetchedImages.length === 0
    ? textContent
    : [
        { type: 'text', text: textContent },
        { type: 'text', text: `\n\n---\nOs ${fetchedImages.length} anexo(s) de imagem desta tarefa seguem abaixo. Para cada um, você DEVE incluir uma subseção "### <nome>" dentro de "## Anexos" do prompt gerado com descrição visual completa e factual.` },
        ...fetchedImages.flatMap(img => [
          {
            type: 'text',
            text: `\n### ${img.filename}\nOLHE com atenção para a imagem abaixo e descreva factualmente: (1) que tela/módulo do sistema está sendo exibida, (2) todos os textos visíveis na tela, especialmente mensagens de erro — transcrever LITERALMENTE, (3) campos preenchidos e seus valores, (4) o que está destacado, selecionado ou anotado. Esta descrição vai para "## Anexos" do prompt:`,
          },
          imageBlock(provider, img.base64, img.mediaType),
        ]),
      ];

  if (fetchedImages.length > 0) {
    console.log(`[ai] ${fetchedImages.length} imagem(ns) enviada(s) inline para ${provider}`);
  }

  const prompt = await aiComplete(provider, key, {
    system: PROMPT_SYSTEM,
    userContent,
    maxTokens: 2048,
  });

  res.json({ prompt });
}));

// Resumo dos journals — destila o histórico em bullets.
app.post('/api/ai/summarize-history', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const notes = (issue.journals || [])
    .filter(j => j.notes?.trim())
    .map(j => `[${j.created_on?.slice(0, 10)}] ${j.user?.name || '?'}: ${j.notes.trim()}`)
    .join('\n\n');

  if (!notes) return res.json({ summary: 'Sem comentários no histórico desta tarefa.' });

  const summary = await aiComplete(provider, key, {
    system: 'Você é um assistente de desenvolvimento de software. Responda em português do Brasil.',
    user: `Resuma o histórico de comentários abaixo em bullets (•), destacando: o que foi feito, problemas encontrados, decisões tomadas e pendências. Seja direto. Máximo 8 bullets.

Tarefa: #${issue.id} — ${issue.subject}
Status atual: ${issue.status?.name}

Histórico:
${notes}`,
    maxTokens: 500,
    fast: true,
  });

  res.json({ summary });
}));

// Rascunho de nota para postar no journal.
app.post('/api/ai/draft-note', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const cf = (id) => (issue.custom_fields || []).find(f => f.id === id)?.value || '';
  const branch = cf(140);
  const lastNote = (issue.journals || []).filter(j => j.notes?.trim()).slice(-1)[0];

  const draft = await aiComplete(provider, key, {
    system: 'Você é um desenvolvedor do ERP B2click (frontend Delphi, backend Java 21). Escreva em português do Brasil, tom técnico e direto. Gere APENAS o texto da nota, sem título nem formatação extra.',
    user: `Gere um rascunho de nota de atualização para o journal desta tarefa. O desenvolvedor quer registrar progresso. Deve ser objetivo (2-4 parágrafos curtos), mencionar o que foi feito e próximos passos. Não invente detalhes técnicos — baseie-se no contexto.

Tarefa: #${issue.id} — ${issue.subject}
Status: ${issue.status?.name}
${branch ? `Branch: ${branch}` : ''}
${lastNote ? `Último comentário (${lastNote.created_on?.slice(0, 10)}): ${lastNote.notes?.trim().slice(0, 300)}` : ''}`,
    maxTokens: 350,
    fast: true,
  });

  res.json({ draft });
}));

// Rascunho de resposta ao cliente — tom de suporte, baseado no histórico do chamado.
app.post('/api/ai/draft-reply', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue, instruction } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const history = (issue.journals || [])
    .filter(j => j.notes?.trim())
    .slice(-6)
    .map(j => `[${j.created_on?.slice(0, 10)}] ${j.user?.name || '?'}: ${j.notes.trim().slice(0, 500)}`)
    .join('\n\n');

  const reply = await aiComplete(provider, key, {
    system: 'Você é um analista de suporte da B2click respondendo a um cliente em um chamado. Escreva em português do Brasil, com tom cordial, profissional e claro. Trate o cliente com respeito. Seja conciso e objetivo, sem jargão técnico interno nem detalhes de implementação. Gere APENAS o texto da resposta, pronto para enviar.',
    user: `Escreva uma resposta para o cliente neste chamado.${instruction ? ` Objetivo da resposta: ${instruction}.` : ''} Baseie-se no histórico; não invente prazos ou fatos que não estejam no contexto. Se faltar informação, peça educadamente o que for necessário.

Chamado: #${issue.id} — ${issue.subject}
Status: ${issue.status?.name}

Histórico recente:
${history || '(sem mensagens anteriores)'}`,
    maxTokens: 500,
    fast: true,
  });

  res.json({ reply });
}));

// ── Chat Redmine (assistente conversacional, somente leitura) ───────────────
// Loop agêntico de tool-use: a IA escolhe ferramentas, o servidor executa no
// Redmine (via makeRedmine) e devolve os resultados até a IA responder.
// Remove tags HTML e normaliza espaços — usado para entregar conteúdo de wiki
// como texto puro para a IA (mais barato e legível que HTML).
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Resume uma mensagem do Zimbra (formato slimMessage) para a IA.
function slimMail(m) {
  const de = m.from?.name && m.from.name !== m.from.address ? `${m.from.name} <${m.from.address}>` : (m.from?.address || '?');
  return { id: m.id, de, assunto: m.subject, data: m.date ? new Date(m.date).toISOString() : null, lido: !m.unread, anexo: !!m.hasAttachment, trecho: (m.snippet || '').slice(0, 200) };
}

const CHAT_TOOLS = [
  // ── Redmine: tarefas, projetos, horas ─────────────────────────────────
  {
    name: 'buscar_tarefas',
    description: 'Busca tarefas (issues) do Redmine por texto livre (assunto, número, palavra-chave). Use para localizar tarefas.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'texto a buscar' } }, required: ['query'] },
    run: async (a, { redmine }) => {
      const { data } = await redmine.get('/search.json', { params: { q: a.query, issues: 1, limit: 15 } });
      return (data.results || []).map(x => ({ id: x.id, titulo: x.title, atualizado: x.datetime }));
    },
  },
  {
    name: 'listar_minhas_tarefas',
    description: 'Lista as tarefas atribuídas ao usuário atual. status opcional: open (padrão), closed ou *.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed', '*'] } } },
    run: async (a, { redmine }) => {
      const { data } = await redmine.get('/issues.json', { params: { assigned_to_id: 'me', status_id: a.status || 'open', limit: 50 } });
      return (data.issues || []).map(i => ({ id: i.id, assunto: i.subject, status: i.status?.name, projeto: i.project?.name, prioridade: i.priority?.name, atualizado: i.updated_on }));
    },
  },
  {
    name: 'detalhes_tarefa',
    description: 'Detalhes de uma tarefa pelo ID, incluindo descrição e os últimos comentários do histórico.',
    input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    run: async (a, { redmine }) => {
      const { data } = await redmine.get(`/issues/${a.id}.json`, { params: { include: 'journals,attachments' } });
      const i = data.issue;
      const comentarios = (i.journals || []).filter(j => j.notes?.trim()).slice(-5)
        .map(j => ({ data: j.created_on?.slice(0, 10), autor: j.user?.name, nota: j.notes.slice(0, 800) }));
      return {
        id: i.id, assunto: i.subject, status: i.status?.name, responsavel: i.assigned_to?.name,
        autor: i.author?.name, projeto: i.project?.name, prioridade: i.priority?.name,
        descricao: (i.description || '').slice(0, 2000), criada: i.created_on, atualizada: i.updated_on, comentarios,
      };
    },
  },
  {
    name: 'listar_projetos',
    description: 'Lista os projetos disponíveis no Redmine.',
    input_schema: { type: 'object', properties: {} },
    run: async (_a, { redmine }) => {
      const { data } = await redmine.get('/projects.json', { params: { limit: 100 } });
      return (data.projects || []).map(p => ({ id: p.id, nome: p.name, identificador: p.identifier }));
    },
  },
  {
    name: 'listar_horas',
    description: 'Lista lançamentos de horas (time entries). Filtros opcionais: issue_id, from e to (datas YYYY-MM-DD).',
    input_schema: { type: 'object', properties: { issue_id: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } } },
    run: async (a, { redmine }) => {
      const params = { limit: 50 };
      if (a.issue_id) params.issue_id = a.issue_id;
      if (a.from) params.from = a.from;
      if (a.to) params.to = a.to;
      const { data } = await redmine.get('/time_entries.json', { params });
      return (data.time_entries || []).map(t => ({ id: t.id, horas: t.hours, data: t.spent_on, usuario: t.user?.name, tarefa: t.issue?.id, atividade: t.activity?.name, comentario: t.comments }));
    },
  },
  {
    name: 'usuario_atual',
    description: 'Retorna o usuário autenticado no Redmine (nome, login, email).',
    input_schema: { type: 'object', properties: {} },
    run: async (_a, { redmine }) => {
      const { data } = await redmine.get('/users/current.json');
      return { id: data.user.id, nome: `${data.user.firstname} ${data.user.lastname}`, login: data.user.login, email: data.user.mail };
    },
  },
  // ── Wiki corporativa (DokuWiki) ───────────────────────────────────────
  {
    name: 'buscar_wiki',
    description: 'Busca páginas na wiki corporativa (DokuWiki) por texto livre. Use para encontrar documentação, procedimentos e notas internas.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'texto a buscar' } }, required: ['query'] },
    run: async (a, { req }) => {
      const results = await doku.searchPages(req, a.query);
      return results.slice(0, 10).map(p => ({ id: p.id, titulo: p.title, namespace: p.namespace, trecho: p.snippet }));
    },
  },
  {
    name: 'ler_pagina_wiki',
    description: 'Lê o conteúdo de uma página da wiki (DokuWiki) pelo seu id (ex.: "namespace:pagina"). Use após buscar_wiki para obter o texto completo.',
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'id da página, ex.: "ti:backup"' } }, required: ['id'] },
    run: async (a, { req }) => {
      const html = await doku.getPageHTML(req, a.id);
      return { id: a.id, conteudo: htmlToText(html).slice(0, 6000) };
    },
  },
  // ── E-mail (Zimbra) — somente leitura ─────────────────────────────────
  {
    name: 'listar_emails',
    description: 'Lista os e-mails de uma pasta do Zimbra. folder opcional (padrão "inbox"): inbox, sent, junk, trash. Não marca como lido.',
    input_schema: { type: 'object', properties: { folder: { type: 'string' }, limit: { type: 'number' } } },
    run: async (a, { req }) => {
      const { messages = [] } = await zimbra.listMessages(req, { folder: a.folder || 'inbox', limit: Math.min(a.limit || 15, 30) });
      return messages.map(slimMail);
    },
  },
  {
    name: 'buscar_emails',
    description: 'Busca e-mails no Zimbra por texto livre (assunto, remetente, conteúdo). Não marca como lido.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    run: async (a, { req }) => {
      const { messages = [] } = await zimbra.searchMessages(req, a.query, { limit: Math.min(a.limit || 15, 30) });
      return messages.map(slimMail);
    },
  },
  {
    name: 'ler_email',
    description: 'Lê o conteúdo completo de um e-mail do Zimbra pelo id. Não marca como lido.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (a, { req }) => {
      const m = await zimbra.getMessage(req, a.id, { markRead: false });
      const fmtAddr = e => (e?.name && e.name !== e.address ? `${e.name} <${e.address}>` : e?.address || '');
      return {
        id: m.id, de: fmtAddr(m.from), para: (m.to || []).map(fmtAddr).join(', '),
        assunto: m.subject, data: m.date ? new Date(m.date).toISOString() : null,
        corpo: htmlToText(m.html || m.text || '').slice(0, 6000),
        anexos: (m.attachments || []).map(x => x.filename),
      };
    },
  },
  // ── Notas pessoais (escrita segura) ───────────────────────────────────
  {
    name: 'listar_notas',
    description: 'Lista as notas pessoais do usuário neste app.',
    input_schema: { type: 'object', properties: {} },
    run: async (_a, { req }) => {
      const uid = await getMyUserId(req);
      return userNotes(uid).map(n => ({ id: n.id, titulo: n.title, corpo: (n.body || '').slice(0, 500), tags: n.tags, fixada: n.pinned, tarefa: n.linkedIssueId }));
    },
  },
  {
    name: 'criar_nota',
    description: 'Cria uma nota pessoal para o usuário neste app. Útil para registrar lembretes, resumos ou pendências. Opcionalmente vincule a uma tarefa via linkedIssueId.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, linkedIssueId: { type: 'number' } }, required: ['body'] },
    run: async (a, { req }) => {
      const uid = await getMyUserId(req);
      const now = Date.now();
      const note = {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        title: typeof a.title === 'string' ? a.title : '',
        body: typeof a.body === 'string' ? a.body : '',
        tags: Array.isArray(a.tags) ? a.tags.filter(t => typeof t === 'string') : [],
        pinned: false, color: null,
        linkedIssueId: Number.isInteger(a.linkedIssueId) ? a.linkedIssueId : null,
        linkedProjectId: null, createdAt: now, updatedAt: now,
      };
      userNotes(uid).unshift(note);
      saveNotes();
      return { ok: true, id: note.id, titulo: note.title };
    },
  },
  // ── Horas (escrita segura) ────────────────────────────────────────────
  {
    name: 'lancar_horas',
    description: 'Lança horas (time entry) em uma tarefa do Redmine. spent_on opcional (YYYY-MM-DD, padrão hoje). activity_id opcional. Confirme com o usuário antes de lançar.',
    input_schema: { type: 'object', properties: { issue_id: { type: 'number' }, hours: { type: 'number' }, comments: { type: 'string' }, spent_on: { type: 'string' }, activity_id: { type: 'number' } }, required: ['issue_id', 'hours'] },
    run: async (a, { redmine }) => {
      const time_entry = { issue_id: a.issue_id, hours: a.hours };
      if (a.comments) time_entry.comments = a.comments;
      if (a.spent_on) time_entry.spent_on = a.spent_on;
      if (a.activity_id) time_entry.activity_id = a.activity_id;
      const { data } = await redmine.post('/time_entries.json', { time_entry });
      const t = data.time_entry;
      return { ok: true, id: t.id, horas: t.hours, tarefa: t.issue?.id, data: t.spent_on };
    },
  },
];

const CHAT_SYSTEM = `Você é o assistente do Bluemine, integrado ao sistema da B2click. Responda em português do Brasil, de forma objetiva e útil.
Você tem acesso a vários subsistemas via ferramentas:
- Redmine: tarefas, projetos, horas e usuário.
- Wiki corporativa (DokuWiki): documentação e procedimentos internos (buscar_wiki, ler_pagina_wiki).
- E-mail (Zimbra): consulta de mensagens (listar_emails, buscar_emails, ler_email).
- Notas pessoais do app (listar_notas, criar_nota).
Regras:
- Use as ferramentas para obter dados REAIS. Nunca invente IDs, status, nomes, números, conteúdo de e-mails ou de wiki.
- Sempre cite tarefas no formato #ID (ex.: #83314) para ficarem clicáveis.
- Para responder sobre "como fazer X" ou procedimentos internos, prefira buscar na wiki antes de responder de memória.
- Você pode ESCREVER apenas em duas situações: criar nota pessoal (criar_nota) e lançar horas (lancar_horas). Antes de lançar horas, confirme com o usuário os valores (tarefa, horas, data).
- Você NÃO envia e-mails, NÃO altera/exclui tarefas e NÃO muda status. Se pedirem, explique gentilmente que ainda não consegue fazer isso.
- Se uma busca não retornar resultados, diga isso claramente em vez de inventar.`;

async function execChatTool(name, args, ctx) {
  const tool = CHAT_TOOLS.find(t => t.name === name);
  if (!tool) return { erro: `ferramenta desconhecida: ${name}` };
  try { return await tool.run(args || {}, ctx); }
  catch (e) { return { erro: e.response?.status ? `${e.response.status} ${e.response.statusText || ''}`.trim() : (e.message || 'falha') }; }
}

app.post('/api/ai/chat', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages obrigatório' });

  const redmine = makeRedmine(req);
  const ctx = { redmine, req };
  const trace = [];
  const MAX_STEPS = 8;

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key });
    const tools = CHAT_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const convo = messages.map(m => ({ role: m.role, content: m.content }));
    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: CHAT_SYSTEM, tools, messages: convo });
      const toolUses = resp.content.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return res.json({ reply: text, trace });
      }
      convo.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const tu of toolUses) {
        trace.push({ tool: tu.name, args: tu.input });
        const out = await execChatTool(tu.name, tu.input, ctx);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 8000) });
      }
      convo.push({ role: 'user', content: results });
    }
    return res.json({ reply: 'Não consegui concluir a consulta em tempo hábil. Tente reformular.', trace });
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: key });
    const tools = CHAT_TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const convo = [{ role: 'system', content: CHAT_SYSTEM }, ...messages.map(m => ({ role: m.role, content: m.content }))];
    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await client.chat.completions.create({ model: 'gpt-4o', max_tokens: 1500, messages: convo, tools });
      const msg = resp.choices[0].message;
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return res.json({ reply: (msg.content || '').trim(), trace });
      }
      convo.push(msg);
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
        trace.push({ tool: tc.function.name, args });
        const out = await execChatTool(tc.function.name, args, ctx);
        convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 8000) });
      }
    }
    return res.json({ reply: 'Não consegui concluir a consulta em tempo hábil. Tente reformular.', trace });
  }

  return res.status(400).json({ error: `provider desconhecido: ${provider}` });
}));

// Daily standup — gera texto de standup a partir das tarefas abertas.
app.post('/api/ai/standup', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issues } = req.body;
  if (!Array.isArray(issues) || issues.length === 0) {
    return res.json({ standup: 'Nenhuma tarefa aberta encontrada.' });
  }

  const list = issues.slice(0, 25).map(i =>
    `- #${i.id} [${i.status?.name}] ${i.subject}`
  ).join('\n');

  const standup = await aiComplete(provider, key, {
    system: 'Você é um assistente de daily standup para um time de desenvolvimento. Responda em português do Brasil.',
    user: `Com base nas tarefas abaixo, gere um texto de daily standup no formato:

**Ontem:** [o que provavelmente foi trabalhado com base nos status]
**Hoje:** [o que planejo fazer — foque nas tarefas em andamento e pendências imediatas]
**Impedimentos:** [bloqueios evidentes, ou "Nenhum"]

Use primeira pessoa. Seja conciso. Cite IDs das tarefas relevantes.

Minhas tarefas:
${list}`,
    maxTokens: 400,
    fast: true,
  });

  res.json({ standup });
}));

// Retrospectiva semanal — resumo das entregas da semana + em andamento + riscos.
app.post('/api/ai/weekly-digest', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { open = [], completed = [] } = req.body;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const doneThisWeek = completed.filter(i => {
    const d = i.closed_on || i.updated_on;
    return d && new Date(d).getTime() >= weekAgo;
  });

  if (doneThisWeek.length === 0 && open.length === 0) {
    return res.json({ digest: 'Nenhuma atividade na última semana.' });
  }

  const fmt = (arr) => arr.slice(0, 30).map(i =>
    `- #${i.id} [${i.status?.name}] ${i.subject}`
  ).join('\n');
  const inProgress = open.filter(i => /andamento|progress/i.test(i.status?.name || ''));

  const digest = await aiComplete(provider, key, {
    system: 'Você é um assistente que escreve retrospectivas semanais para um desenvolvedor de um time de software. Responda em português do Brasil, em markdown.',
    user: `Escreva uma retrospectiva semanal concisa e útil com base nas tarefas abaixo. Use exatamente estas seções:

## ✅ Entregue esta semana
[liste as concluídas com IDs; se vazio, "Nada concluído nesta semana."]

## 🔄 Em andamento
[tarefas em andamento e o que falta]

## ⚠️ Riscos e bloqueios
[infira riscos pelos status — tarefas paradas, muitas pendências, nada concluído — ou "Nenhum aparente"]

## 🎯 Foco sugerido para a próxima semana
[2-4 bullets priorizando o que destravar primeiro]

Seja específico e cite IDs. Não invente dados além do que está nas listas.

Concluídas nos últimos 7 dias (${doneThisWeek.length}):
${fmt(doneThisWeek) || '(nenhuma)'}

Em andamento (${inProgress.length}):
${fmt(inProgress) || '(nenhuma)'}

Demais tarefas abertas (${open.length}):
${fmt(open) || '(nenhuma)'}`,
    maxTokens: 700,
    fast: false,
  });

  res.json({ digest });
}));

// Avaliação de complexidade — o modelo avalia o quão complexa é a tarefa com base
// nos requisitos descritos. Não inventa horas: dá um nível qualitativo + raciocínio
// + fatores de risco. Muito mais honesto e útil do que um número fabricado.
app.post('/api/ai/assess-complexity', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const cf = (id) => (issue.custom_fields || []).find(f => f.id === id)?.value || '';
  const impacto   = cf(229);
  const numReqs   = (issue.children || []).length; // subtarefas como proxy de escopo
  const rejections = (issue.journals || [])
    .filter(j => j.details?.some(d => d.property === 'attr' && d.name === 'status_id' && d.new_value === '34'))
    .length;

  const result = await aiComplete(provider, key, {
    system: 'Você é um tech lead experiente no ERP B2click (frontend Delphi, backend Java 21 legado). Responda APENAS com JSON válido, sem markdown.',
    user: `Avalie a complexidade desta tarefa de desenvolvimento. Retorne um JSON com:
- "level": um de "Baixa" | "Média" | "Alta" | "Muito Alta"
- "reasoning": string (2-3 frases) explicando por que este nível, citando os aspectos mais relevantes da descrição
- "risks": array de strings (2-5 itens) listando os principais fatores de risco ou pontos de atenção
- "roughHours": string com faixa aproximada de esforço (ex: "4-8h", "2-5 dias") — deixe claro que é uma estimativa bruta baseada apenas na descrição

Considere: número de requisitos listados, módulos afetados, integrações (PDV/retaguarda), novidade da funcionalidade, clareza dos requisitos.

Tarefa: #${issue.id} — ${issue.subject}
Tracker: ${issue.tracker?.name || ''}
${impacto      ? `Impacto (módulos): ${impacto}` : ''}
${numReqs > 0  ? `Subtarefas: ${numReqs}` : ''}
${rejections > 0 ? `Voltou da revisão ${rejections}x (histórico de correções)` : ''}

Descrição:
${(issue.description || '(sem descrição)').slice(0, 1500)}`,
    maxTokens: 400,
    fast: false,
  });

  try {
    res.json(JSON.parse(result));
  } catch {
    res.json({ level: '?', reasoning: result, risks: [], roughHours: '?' });
  }
}));

// Checklist de revisão para o revisor (status Pendente Revisão).
app.post('/api/ai/review-checklist', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const cf = (id) => (issue.custom_fields || []).find(f => f.id === id)?.value || '';
  const impacto = cf(229);
  const branch  = cf(140);

  const lastDevNotes = (issue.journals || [])
    .filter(j => j.notes?.trim())
    .slice(-3)
    .map(j => `- ${j.notes.trim().slice(0, 300)}`)
    .join('\n');

  const checklist = await aiComplete(provider, key, {
    system: 'Você é um revisor de software experiente no ERP B2click (frontend Delphi, backend Java 21). Responda em português do Brasil.',
    user: `Gere um checklist de revisão de código para a tarefa abaixo. Cada item deve ser uma pergunta ou verificação concreta que o revisor deve checar. Use formato markdown com checkboxes: "- [ ] Verificar que...". Entre 6 e 12 itens. Baseie nos requisitos descritos e no impacto informado.

Tarefa: #${issue.id} — ${issue.subject}
${branch  ? `Branch: ${branch}` : ''}
${impacto ? `Impacto (módulos afetados): ${impacto}` : ''}

Descrição:
${(issue.description || '').slice(0, 1500)}

${lastDevNotes ? `Notas do desenvolvedor:\n${lastDevNotes}` : ''}`,
    maxTokens: 600,
    fast: false,
  });

  res.json({ checklist });
}));

// Sugestão de campos para nova issue com base no título e descrição.
app.post('/api/ai/suggest-fields', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { subject, description, trackers, priorities } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject obrigatório' });

  const trackerList  = (trackers  || []).map(t => `${t.id}: ${t.name}`).join(', ');
  const priorityList = (priorities || []).map(p => `${p.id}: ${p.name}`).join(', ');

  const IMPACTO_OPTS = 'JAVA, B2CLICK, B2CLICKPAF, ROTEADORPDV, AUTOMACAO, B2CLICKPOS, B2CLICKPAY (pode combinar com +)';

  const result = await aiComplete(provider, key, {
    system: 'Você é um assistente de triagem de tarefas do ERP B2click. Responda APENAS com JSON válido, sem markdown.',
    user: `Com base no título e descrição da tarefa abaixo, sugira os campos mais adequados. Retorne um JSON com:
- "tracker_id": número do tracker mais adequado (ou null se incerto)
- "priority_id": número da prioridade mais adequada (ou null se incerto)
- "impacto": string com o valor de impacto (ou null se incerto)
- "reasoning": string curta (1 frase) explicando as escolhas

Trackers disponíveis: ${trackerList || '(não informados)'}
Prioridades disponíveis: ${priorityList || '(não informadas)'}
Opções de impacto: ${IMPACTO_OPTS}

Título: ${subject}
Descrição: ${(description || '').slice(0, 500)}`,
    maxTokens: 200,
    fast: true,
  });

  try {
    res.json(JSON.parse(result));
  } catch {
    res.json({ tracker_id: null, priority_id: null, impacto: null, reasoning: result });
  }
}));

// Revisão de nota antes de postar no journal.
app.post('/api/ai/review-note', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { noteText, issueSubject, issueStatus } = req.body;
  if (!noteText) return res.status(400).json({ error: 'noteText obrigatório' });

  const feedback = await aiComplete(provider, key, {
    system: 'Você é um revisor técnico de notas de progresso de software. Responda em português do Brasil. Seja direto e conciso.',
    user: `Revise a nota de journal abaixo e aponte em 2-4 bullets (•) o que poderia ser melhorado: informações faltando, pontos ambíguos, ou aspectos importantes não mencionados. Se a nota estiver boa, diga "✓ Nota clara e completa." sem bullets.

Contexto da tarefa: ${issueSubject || '(não informado)'} [${issueStatus || ''}]

Nota a revisar:
${noteText.slice(0, 1000)}`,
    maxTokens: 250,
    fast: true,
  });

  res.json({ feedback });
}));

// Detector de requisitos ambíguos — aponta o que está incompleto ou contraditório
// antes do dev começar, evitando retrabalho e ping-pong de revisão.
app.post('/api/ai/detect-ambiguities', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const redmineUrl = req.headers['x-redmine-url'] || lastAuth.url;
  const redmineKey = req.headers['x-redmine-key'] || lastAuth.key;
  const redmineUser = req.headers['x-redmine-user'] || lastAuth.username;
  const redminePass = req.headers['x-redmine-pass'] || lastAuth.password;
  const redmineAuthHeaders = buildAuthHeaders(redmineKey, redmineUser, redminePass);
  const hasRedmineAuth = !!(redmineUrl && (redmineKey || (redmineUser && redminePass)));

  // Separa anexos por tipo
  const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
  const textTypes  = ['text/plain', 'text/csv', 'application/sql', 'application/json', 'text/html', 'text/xml', 'application/xml'];
  const attachments = issue.attachments || [];

  const imageAtts = attachments.filter(a => imageTypes.includes(a.content_type?.toLowerCase()) && (a.filesize || 0) <= MAX_ATTACH_BYTES).slice(0, 3);
  const isTextFile = (a) => {
    const ct = a.content_type?.toLowerCase() || '';
    return textTypes.some(t => ct.includes(t)) || ct.startsWith('text/') || /\.(txt|log|sql|csv|json|xml|md)$/i.test(a.filename || '');
  };
  const textAtts      = attachments.filter(a => isTextFile(a) && (a.filesize || 0) <= 80 * 1024).slice(0, 4);
  const largeTextAtts = attachments.filter(a => isTextFile(a) && (a.filesize || 0) > 80 * 1024);
  const otherAtts = attachments.filter(a =>
    !imageAtts.find(x => x.id === a.id) && !textAtts.find(x => x.id === a.id)
  );

  // Busca imagens base64
  const fetchedImages = [];
  if (hasRedmineAuth) {
    for (const att of imageAtts) {
      const img = await fetchAttachmentBase64(redmineUrl, redmineAuthHeaders, att.id, att.filename);
      if (img) fetchedImages.push({ ...img, filename: att.filename });
    }
  }

  // Busca conteúdo de arquivos de texto
  const textContents = [];
  if (hasRedmineAuth) {
    for (const att of textAtts) {
      try {
        const resp = await axios.get(
          `${redmineUrl}/attachments/download/${att.id}/${encodeURIComponent(att.filename)}`,
          { headers: redmineAuthHeaders, responseType: 'text', maxContentLength: 80 * 1024 }
        );
        textContents.push({ filename: att.filename, content: resp.data.slice(0, 4000) });
      } catch (e) {
        console.warn(`[ambiguities] falha ao buscar texto ${att.filename}:`, e.message);
      }
    }
  }

  // Monta texto base do prompt
  let userText = `Analise os requisitos abaixo e identifique pontos ambíguos, incompletos ou contraditórios que podem causar retrabalho. Retorne um JSON com:
- "hasIssues": boolean — true se encontrou problemas
- "ambiguities": array de objetos com:
  - "trecho": string — o trecho exato da descrição ou do anexo que está ambíguo (copiar literal)
  - "problema": string — por que isso é ambíguo ou incompleto
  - "pergunta": string — a pergunta que o dev deveria fazer antes de codar

Se os requisitos estiverem claros e completos, retorne hasIssues: false e ambiguities: [].

Tarefa: #${issue.id} — ${issue.subject}
Tracker: ${issue.tracker?.name || ''}

Descrição:
${(issue.description || '(sem descrição)').slice(0, 2000)}`;

  if (textContents.length > 0) {
    userText += '\n\n--- ANEXOS DE TEXTO ---';
    for (const tc of textContents) {
      userText += `\n\n### ${tc.filename}\n${tc.content}`;
    }
  }
  if (largeTextAtts.length > 0) {
    userText += `\n\n⚠ Arquivos de texto grandes (não lidos automaticamente por exceder 80 KB):\n`;
    userText += largeTextAtts.map(a => `- ${a.filename} (${Math.round((a.filesize || 0) / 1024)} KB) — considere mencionar o conteúdo relevante na descrição da tarefa`).join('\n');
  }
  if (otherAtts.length > 0) {
    userText += `\n\nOutros anexos presentes (não lidos): ${otherAtts.map(a => `${a.filename} (${a.content_type})`).join(', ')}`;
  }
  if (fetchedImages.length > 0) {
    userText += `\n\nImagens em anexo (${fetchedImages.length}): ${fetchedImages.map(i => i.filename).join(', ')} — analise-as como parte dos requisitos visuais.`;
  }

  // Monta conteúdo: texto + imagens inline
  const userContent = fetchedImages.length === 0
    ? userText
    : [
        { type: 'text', text: userText },
        ...fetchedImages.flatMap(img => [
          { type: 'text', text: `\n### Imagem: ${img.filename}` },
          imageBlock(provider, img.base64, img.mediaType),
        ]),
      ];

  if (fetchedImages.length > 0 || textContents.length > 0) {
    console.log(`[ambiguities] ${fetchedImages.length} imagem(ns), ${textContents.length} texto(s) incluído(s)`);
  }

  const result = await aiComplete(provider, key, {
    system: 'Você é um analista de requisitos sênior no ERP B2click (frontend Delphi, backend Java 21). Responda APENAS com JSON válido, sem markdown.',
    userContent,
    maxTokens: 800,
    fast: false,
  });

  try {
    res.json(JSON.parse(result));
  } catch {
    res.json({ hasIssues: false, ambiguities: [], raw: result });
  }
}));

// Sugestão de nota de versão seguindo o padrão B2click:
// (MÓDULO OPERACIONAL\ SUBMÓDULO\ TELA) O que foi feito
// O caminho do menu vem da própria descrição (sempre citada nas issues do ERP).
app.post('/api/ai/suggest-version-note', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const cf = (id) => (issue.custom_fields || []).find(f => f.id === id)?.value || '';
  const currentNote = cf(213); // Nota de versão atual (CF 213)

  const lastNotes = (issue.journals || [])
    .filter(j => j.notes?.trim())
    .slice(-3)
    .map(j => `[${j.created_on?.slice(0, 10)}] ${j.notes.trim().slice(0, 300)}`)
    .join('\n');

  const result = await aiComplete(provider, key, {
    system: 'Você é um desenvolvedor do ERP B2click. Responda APENAS com JSON válido, sem markdown.',
    user: `Gere uma sugestão de Nota de Versão para esta tarefa seguindo EXATAMENTE o padrão B2click:

PADRÃO: (CAMINHO DO MENU NO ERP) Descrição concisa do que foi alterado/adicionado/corrigido

Exemplos reais do padrão:
- (MODULO OPERACIONAL\\ PRODUTOS\\ A. PRODUTOS aba DADOS NAS FILIAIS) Foi adicionado o parâmetro NAO_USAR_ALIQUOTAS_IBPT para Lei 12.741
- (MODULO PADRÃO\\ CONFIGURAÇÃO\\ G. CONFIGURAÇÃO DE PDV) Adicionado novo parâmetro NÃO USAR ALÍQUOTAS DO IBPT
- (MODULO VENDAS\\ VENDAS\\ C. CONSULTA DE PEDIDO DE VENDA) Corrigido erro no envio de e-mail pelo [F6]

Regras:
- O caminho do menu DEVE vir da descrição da tarefa (ela sempre cita onde é a mudança, como "Em MODULO X\\ Y\\ Z...")
- Use \\ como separador no caminho
- A descrição deve ser curta (1 frase), no passado ("Foi adicionado", "Adicionado", "Corrigido", "Implementado")
- Se há múltiplas telas afetadas, gere uma nota por tela (retorne array)

Retorne JSON com:
- "notes": array de strings — uma nota por tela/mudança
- "reasoning": string — como você extraiu o caminho do menu e o que foi feito

${currentNote && currentNote !== '*' ? `Nota atual (para referência de estilo): ${currentNote}` : ''}

Tarefa: #${issue.id} — ${issue.subject}

Descrição:
${(issue.description || '').slice(0, 2000)}

${lastNotes ? `Histórico recente:\n${lastNotes}` : ''}`,
    maxTokens: 500,
    fast: false,
  });

  try {
    res.json(JSON.parse(result));
  } catch {
    res.json({ notes: [], reasoning: result });
  }
}));

// Resumo rápido de 1 linha — para o card do Kanban.
app.post('/api/ai/quick', handle(async (req, res) => {
  const { provider, key } = getAICredentials(req);
  if (!key) return res.status(400).json({ error: 'header x-ai-key obrigatório' });

  const { issue } = req.body;
  if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

  const oneLiner = await aiComplete(provider, key, {
    system: 'Você é um assistente de software. Responda em português do Brasil.',
    user: `Em no máximo 12 palavras, descreva o estado atual desta tarefa:
Tarefa: ${issue.subject}
Status: ${issue.status?.name}
Descrição: ${(issue.description || '').slice(0, 300)}

Retorne APENAS a frase, sem aspas, sem ponto final.`,
    maxTokens: 80,
    fast: true,
  });

  res.json({ oneLiner });
}));

// =========================================================================
// WEB PUSH — notificações mesmo com a aba do navegador fechada
// =========================================================================
// O servidor (que continua de pé enquanto o .exe roda) faz polling do Redmine
// por inscrição e empurra notificações. O service worker só EXIBE a notificação
// quando não há nenhuma janela do app aberta — se houver (aberta ou minimizada),
// o próprio app já cuida via o polling em segundo plano (refetchIntervalInBackground),
// evitando notificações duplicadas.

// Pasta gravável: ao lado do .exe quando empacotado (pkg), senão a pasta do server.
const DATA_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const dataFile = (name) => path.join(DATA_DIR, name);

// Escrita atômica: grava num .tmp e renomeia, pra nunca deixar o arquivo pela metade.
function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// ── Criptografia em repouso via Windows DPAPI (escopo CurrentUser) ─────────
// Liga a criptografia à conta Windows logada: só aquele usuário, naquela
// máquina, descriptografa — sem gerenciar senha. Mesmo nível do localStorage
// do navegador (que é o teto realista aqui). Fora do Windows ou se o DPAPI
// falhar, cai pra texto puro com aviso, pra nunca quebrar o boot.
const IS_WINDOWS = process.platform === 'win32';

function runPowerShell(script, input) {
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `powershell saiu com código ${r.status}`);
  return (r.stdout || '').trim();
}

function dpapiProtect(plaintext) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$inB64 = [Console]::In.ReadToEnd()',
    '$bytes = [Convert]::FromBase64String($inB64)',
    '$prot = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($prot)',
  ].join('; ');
  return runPowerShell(script, Buffer.from(plaintext, 'utf8').toString('base64'));
}

function dpapiUnprotect(b64blob) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$inB64 = [Console]::In.ReadToEnd()',
    '$bytes = [Convert]::FromBase64String($inB64)',
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($plain)',
  ].join('; ');
  return Buffer.from(runPowerShell(script, b64blob), 'base64').toString('utf8');
}

// Lê JSON, descriptografando se estiver no formato { __dpapi }. Aceita texto
// puro também (compat com arquivos antigos / fallback).
function readJsonSecure(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.__dpapi === 'string') {
      if (!IS_WINDOWS) { console.warn('[push] arquivo cifrado com DPAPI fora do Windows — ignorando'); return fallback; }
      return JSON.parse(dpapiUnprotect(parsed.__dpapi));
    }
    return parsed;
  } catch { return fallback; }
}

// Grava JSON cifrado com DPAPI; cai pra texto puro se o DPAPI não estiver disponível.
function writeJsonSecure(file, data) {
  const plaintext = JSON.stringify(data);
  if (IS_WINDOWS) {
    try {
      writeFileAtomic(file, JSON.stringify({ __dpapi: dpapiProtect(plaintext) }, null, 2));
      return;
    } catch (e) {
      console.warn('[push] DPAPI indisponível, gravando em texto puro:', e.message);
    }
  }
  try { writeFileAtomic(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[push] falha ao gravar', file, e.message); }
}

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

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

app.post('/api/push/subscribe', handle(async (req, res) => {
  const url = req.headers['x-redmine-url'];
  const key = req.headers['x-redmine-key'] || '';
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const subscription = req.body?.subscription;
  const talkAuth = req.body?.talkAuth || null; // { url, user, token } — opcional
  const hasAuth = !!(key || (username && password));
  if (!url || !hasAuth || !subscription?.endpoint) {
    console.warn('[push] subscribe rejeitado — faltando:', { url: !!url, hasAuth, endpoint: !!subscription?.endpoint });
    return res.status(400).json({ error: 'subscription e credenciais são obrigatórios' });
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
  res.json({ success: true });
}));

app.post('/api/push/unsubscribe', handle(async (req, res) => {
  const endpoint = req.body?.endpoint;
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  saveSubs();
  res.json({ success: true });
}));

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
setInterval(pollPush, PUSH_POLL_MS);

// =========================================================================
// NEXTCLOUD LOGIN FLOW v2
// =========================================================================

app.post('/api/talk/login-flow/init', handle(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const base = url.replace(/\/$/, '');
  const { data } = await axios.post(`${base}/index.php/login/v2`);
  res.json({ loginUrl: data.login, pollEndpoint: data.poll.endpoint, pollToken: data.poll.token });
}));

app.post('/api/talk/login-flow/poll', handle(async (req, res) => {
  const { pollEndpoint, pollToken } = req.body;
  if (!pollEndpoint || !pollToken) return res.status(400).json({ error: 'missing params' });
  try {
    const { data } = await axios.post(
      pollEndpoint,
      `token=${encodeURIComponent(pollToken)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    res.json({ done: true, server: data.server, user: data.loginName, token: data.appPassword });
  } catch (e) {
    // 404 = ainda aguardando o usuário fazer login
    if (e.response?.status === 404) return res.json({ done: false });
    throw e;
  }
}));

// =========================================================================
// NEXTCLOUD TALK PROXY
// =========================================================================

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

app.get('/api/talk/avatar/:userId', handle(async (req, res) => {
  const size = parseInt(req.query.size) || 40;
  const response = await makeTalk(req).get(
    `/index.php/avatar/${encodeURIComponent(req.params.userId)}/${size}`,
    { responseType: 'arraybuffer' }
  );
  res.set('Content-Type', response.headers['content-type'] || 'image/png');
  res.set('Cache-Control', 'public, max-age=1800');
  res.send(response.data);
}));

app.get('/api/talk/me', handle(async (req, res) => {
  const { data } = await makeTalk(req).get('/ocs/v2.php/cloud/user?format=json');
  res.json({ id: data.ocs.data.id, displayName: data.ocs.data.display_name });
}));

app.get('/api/talk/rooms', handle(async (req, res) => {
  const { data } = await makeTalk(req).get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
  res.json(data.ocs.data);
}));

app.get('/api/talk/rooms/:token/messages', handle(async (req, res) => {
  const params = { limit: 50, lookIntoFuture: 0 };
  // Sem cursor = busca as 50 mais recentes usando um ID alto como âncora.
  // Sem isso, algumas versões do Talk retornam as mensagens mais ANTIGAS primeiro.
  params.lastKnownMessageId = req.query.lastKnownMessageId || 2147483647;
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}?format=json`,
    { params }
  );
  res.json(data.ocs.data);
}));

app.post('/api/talk/rooms/:token/messages', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}?format=json`,
    req.body
  );
  res.json(data.ocs.data);
}));

app.post('/api/talk/rooms/:token/upload',
  express.raw({ type: '*/*', limit: '100mb' }),
  handle(async (req, res) => {
    const user     = req.headers['x-nextcloud-user'];
    const filename = decodeURIComponent(req.headers['x-filename'] || `upload_${Date.now()}`);
    const ct       = req.headers['x-content-type'] || 'application/octet-stream';
    const caption  = req.headers['x-caption'] ? decodeURIComponent(req.headers['x-caption']) : '';
    const { token } = req.params;
    const talk = makeTalk(req);

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!body.length) {
      return res.status(400).json({ error: 'Arquivo vazio — tente novamente.' });
    }

    const OCS_TIMEOUT = 8000;
    const ncUrl = req.headers['x-nextcloud-url'];
    const putOpts = {
      headers: { 'Content-Type': ct, 'Content-Length': body.length },
      maxBodyLength: 100 * 1024 * 1024,
      maxContentLength: 100 * 1024 * 1024,
    };

    // Subpasta única dentro de /Talk: evita conflito de nome (clipboard manda sempre
    // "image.png") e mantém o filename limpo na exibição do chat.
    const subdir = `Talk/talk_${Date.now()}`;
    try { await talk.request({ method: 'MKCOL', url: `/remote.php/webdav/Talk` }); } catch {}
    try { await talk.request({ method: 'MKCOL', url: `/remote.php/webdav/${subdir}` }); } catch {}
    await talk.put(`/remote.php/webdav/${subdir}/${encodeURIComponent(filename)}`, body, putOpts);

    // shareType 10 = Talk room (inline) — sempre a opção preferida.
    // caption vai como talkMetaData (legenda da imagem/arquivo).
    const shareToRoom = async (filePath) => {
      try {
        const shareBody = { shareType: 10, shareWith: token, path: filePath };
        if (caption) shareBody.talkMetaData = JSON.stringify({ caption });
        await talk.post(
          '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
          shareBody,
          { timeout: OCS_TIMEOUT }
        );
        return { method: 'share' };
      } catch { return null; }
    };

    // shareType 3 = link público — só usado se o inline estiver indisponível.
    const sharePublic = async (filePath) => {
      try {
        const { data: pd } = await talk.post(
          '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
          { shareType: 3, path: filePath },
          { timeout: OCS_TIMEOUT }
        );
        const url = pd?.ocs?.data?.url;
        if (url) {
          const msg = caption ? `${caption}\n📎 ${filename}\n${url}` : `📎 ${filename}\n${url}`;
          await talk.post(`/ocs/v2.php/apps/spreed/api/v1/chat/${token}?format=json`,
            { message: msg }, { timeout: OCS_TIMEOUT });
          return { method: 'public-link' };
        }
      } catch {}
      return null;
    };

    // 1. Inline a partir da subpasta /Talk
    const r1 = await shareToRoom(`/${subdir}/${filename}`);
    if (r1) return res.json({ success: true, ...r1 });

    // 2. Inline a partir da raiz (contorna restrições de share na pasta Talk)
    const rootName = `talk_${Date.now()}_${filename}`;
    try {
      await talk.put(`/remote.php/webdav/${encodeURIComponent(rootName)}`, body, putOpts);
      const r2 = await shareToRoom(`/${rootName}`);
      if (r2) return res.json({ success: true, ...r2 });
      // 3. Link público como último recurso (shareType 10 indisponível)
      const r3 = await sharePublic(`/${rootName}`);
      if (r3) return res.json({ success: true, ...r3 });
    } catch {}

    // 4. Compartilhamento não disponível — informa com clareza
    res.status(200).json({
      success: false,
      method: 'none',
      error: `Arquivo enviado (${subdir}/${filename}), mas o compartilhamento está desativado para este usuário. Peça ao admin do Nextcloud para habilitar. Acesse: ${ncUrl}/apps/files`,
      uploadedPath: `${subdir}/${filename}`,
    });
  })
);

app.post('/api/talk/rooms/:token/read', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/read?format=json`,
    req.body
  );
  res.json(data.ocs.meta);
}));

app.get('/api/talk/rooms/:token/participants', handle(async (req, res) => {
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/participants?format=json`
  );
  res.json(data.ocs.data);
}));

app.get('/api/talk/file-preview', handle(async (req, res) => {
  const { fileId, path: filePath, actorId } = req.query;
  const user = req.headers['x-nextcloud-user'];
  const talk = makeTalk(req);
  const ext = (filePath || '').split('.').pop()?.toLowerCase() || 'jpg';
  const fallbackCt = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const tryDownload = async (url, useAuth = true) => {
    try {
      const client = useAuth ? talk : axios;
      const r = await client.get(url, { responseType: 'arraybuffer', maxRedirects: 5 });
      const ct = String(r.headers['content-type'] || '');
      if (r.data?.byteLength > 100 && !ct.includes('text/html') && !ct.includes('application/json')) {
        return { data: r.data, ct: ct || fallbackCt };
      }
    } catch {}
    return null;
  };

  // 1. OCS Direct Download — URL temporária sem auth, funciona para qualquer
  //    arquivo acessível ao usuário (inclusive compartilhamentos do Talk)
  try {
    const { data: ocsData } = await talk.post(
      `/ocs/v2.php/apps/dav/api/v1/direct?format=json`,
      { fileId: parseInt(fileId) }
    );
    const directUrl = ocsData?.ocs?.data?.url;
    if (directUrl) {
      const result = await tryDownload(directUrl, false);
      if (result) {
        res.set('Content-Type', result.ct);
        res.set('Cache-Control', 'private, max-age=300');
        return res.send(result.data);
      }
    }
  } catch {}

  const result =
    // 2. webdav relativo (sem precisar do principal name) — funciona para o usuário logado
    (filePath && await tryDownload(`/remote.php/webdav/${filePath}`)) ||
    // 3. WebDAV explícito do usuário logado
    (filePath && await tryDownload(`/remote.php/dav/files/${encodeURIComponent(user)}/${filePath}`)) ||
    // 4. WebDAV do remetente (se houver permissão de share)
    (actorId && actorId !== user && filePath && await tryDownload(`/remote.php/dav/files/${encodeURIComponent(actorId)}/${filePath}`)) ||
    // 5. Preview thumbnail como último recurso
    (fileId && await tryDownload(`/index.php/core/preview?fileId=${fileId}&x=800&y=800&a=true`));

  if (!result) return res.status(404).json({ error: 'not accessible' });
  res.set('Content-Type', result.ct);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(result.data);
}));

// ─── Endpoints Talk extras ────────────────────────────────────────────────────

// Indicador de digitação
app.post('/api/talk/rooms/:token/typing', handle(async (req, res) => {
  try {
    const { data } = await makeTalk(req).post(
      `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/typing?format=json`,
      req.body
    );
    res.json(data?.ocs?.meta ?? { status: 'ok' });
  } catch { res.json({ status: 'ok' }); }
}));

// Reações — GET, POST, DELETE
app.get('/api/talk/rooms/:token/messages/:messageId/reactions', handle(async (req, res) => {
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`
  );
  res.json(data.ocs.data ?? {});
}));

app.post('/api/talk/rooms/:token/messages/:messageId/reactions', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
    req.body
  );
  res.json(data.ocs.data ?? {});
}));

app.delete('/api/talk/rooms/:token/messages/:messageId/reactions', handle(async (req, res) => {
  const { data } = await makeTalk(req).delete(
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
    { params: { reaction: req.query.reaction } }
  );
  res.json(data.ocs.data ?? {});
}));

// Editar mensagem
app.put('/api/talk/rooms/:token/messages/:messageId', handle(async (req, res) => {
  const { data } = await makeTalk(req).put(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/${req.params.messageId}?format=json`,
    req.body
  );
  res.json(data.ocs.data ?? {});
}));

// Excluir mensagem
app.delete('/api/talk/rooms/:token/messages/:messageId', handle(async (req, res) => {
  await makeTalk(req).delete(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/${req.params.messageId}?format=json`
  );
  res.json({ success: true });
}));

// Avatar de sala (grupos)
app.get('/api/talk/rooms/:token/avatar', handle(async (req, res) => {
  try {
    const isDark = req.query.dark === '1';
    const response = await makeTalk(req).get(
      `/ocs/v2.php/apps/spreed/api/v1/room/${req.params.token}/avatar${isDark ? '/dark' : ''}`,
      { responseType: 'arraybuffer' }
    );
    res.set('Content-Type', response.headers['content-type'] || 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=1800');
    res.send(response.data);
  } catch { res.status(404).end(); }
}));

// Criar sala (DM roomType=1 ou grupo roomType=2)
app.post('/api/talk/rooms', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v4/room?format=json`,
    req.body
  );
  res.json(data.ocs.data);
}));

// Buscar usuários Nextcloud para iniciar conversa
app.get('/api/talk/search/users', handle(async (req, res) => {
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/core/autocomplete/get?format=json`,
    { params: { search: req.query.search || '', itemType: 'call', itemId: 'new', 'shareTypes[]': '0', limit: 20 } }
  );
  res.json(data.ocs.data || []);
}));

// SSE — proxy do long-poll do Talk para updates em tempo real.
// Auth via query string porque EventSource não suporta headers customizados.
app.get('/api/talk/rooms/:token/sse', (req, res) => {
  const ncUrl   = req.query.ncUrl   || '';
  const ncUser  = req.query.ncUser  || '';
  const ncToken = req.query.ncToken || '';
  if (!ncUrl || !ncUser || !ncToken) return res.status(401).json({ error: 'credenciais obrigatórias' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const talk = axios.create({
    baseURL: ncUrl,
    auth: { username: ncUser, password: ncToken },
    headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
  });

  let lastId = parseInt(req.query.lastKnownMessageId) || 0;
  let active = true;

  (async () => {
    while (active) {
      try {
        const { data } = await talk.get(
          `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}`,
          { params: { format: 'json', lookIntoFuture: 1, timeout: 30, lastKnownMessageId: lastId, limit: 50, includeLastKnown: 0 }, timeout: 35_000 }
        );
        const messages = data?.ocs?.data ?? [];
        if (messages.length > 0) {
          const newLastId = Math.max(...messages.map(m => m.id));
          if (newLastId > lastId) lastId = newLastId;
          const comments = messages.filter(m => m.messageType === 'comment');
          const typing = messages
            .filter(m => m.messageType === 'system' && m.systemMessage === 'typing')
            .map(m => ({ actorId: m.actorId, actorDisplayName: m.actorDisplayName }));
          if (comments.length > 0) res.write(`data: ${JSON.stringify({ type: 'messages', data: comments })}\n\n`);
          if (typing.length > 0) res.write(`data: ${JSON.stringify({ type: 'typing', data: typing })}\n\n`);
        } else {
          res.write(': ping\n\n');
        }
      } catch (err) {
        if (!active) break;
        if (err.code === 'ECONNABORTED' || err.response?.status === 304) continue;
        console.warn('[sse] erro no poll Talk:', err.response?.status || err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  })();

  req.on('close', () => { active = false; });
});

// =========================================================================
// NOTAS — bloco de notas pessoal, persistido por usuário do Redmine
// =========================================================================
const NOTES_FILE = dataFile('notes.json');
let notesStore = readJsonSecure(NOTES_FILE, {}); // { [userId]: Note[] }
const saveNotes = () => writeJsonSecure(NOTES_FILE, notesStore);

function userNotes(userId) {
  if (!notesStore[userId]) notesStore[userId] = [];
  return notesStore[userId];
}

const NOTE_FIELDS = ['title', 'body', 'tags', 'pinned', 'color', 'linkedIssueId', 'linkedProjectId'];

app.get('/api/notes', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  res.json(userNotes(uid));
}));

app.post('/api/notes', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const now = Date.now();
  const b = req.body || {};
  const note = {
    id: (typeof b.id === 'string' && b.id && !userNotes(uid).some(n => n.id === b.id))
      ? b.id
      : `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: typeof b.title === 'string' ? b.title : '',
    body: typeof b.body === 'string' ? b.body : '',
    tags: Array.isArray(b.tags) ? b.tags.filter(t => typeof t === 'string') : [],
    pinned: !!b.pinned,
    color: typeof b.color === 'string' ? b.color : null,
    linkedIssueId: Number.isInteger(b.linkedIssueId) ? b.linkedIssueId : null,
    linkedProjectId: Number.isInteger(b.linkedProjectId) ? b.linkedProjectId : null,
    createdAt: now,
    updatedAt: now,
  };
  userNotes(uid).unshift(note);
  saveNotes();
  res.json(note);
}));

app.put('/api/notes/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  const note = userNotes(uid).find(n => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'nota não encontrada' });
  const b = req.body || {};
  for (const k of NOTE_FIELDS) if (k in b) note[k] = b[k];
  note.updatedAt = Date.now();
  saveNotes();
  res.json(note);
}));

app.delete('/api/notes/:id', handle(async (req, res) => {
  const uid = await getMyUserId(req);
  notesStore[uid] = userNotes(uid).filter(n => n.id !== req.params.id);
  saveNotes();
  res.json({ ok: true });
}));

// =========================================================================
// E-MAIL — Zimbra via API SOAP (HTTPS). Ver server/zimbra.js.
// Credenciais: reaproveita o login usuário/senha do Redmine (mesma senha AD);
// no modo chave de API, usa os headers x-mail-* (config manual no front).
// =========================================================================

// Testa a conexão/autenticação no Zimbra com as credenciais resolvidas.
app.get('/api/mail/ping', handle(async (req, res) => {
  const { host, user } = zimbra.resolveMailCreds(req);
  await zimbra.tokenFor(req); // lança 401/412 se não autenticar
  res.json({ ok: true, host, user });
}));

// Lista de pastas com contadores (Inbox, Sent, Junk, Trash…).
app.get('/api/mail/folders', handle(async (req, res) => {
  res.json({ folders: await zimbra.listFolders(req) });
}));

// Lista mensagens de uma pasta (paginado).
app.get('/api/mail/messages', handle(async (req, res) => {
  const { folder = 'inbox', limit = 25, offset = 0 } = req.query;
  res.json(await zimbra.listMessages(req, { folder, limit, offset }));
}));

// Busca por texto livre (sintaxe de busca do Zimbra).
app.get('/api/mail/search', handle(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ messages: [], more: false });
  res.json(await zimbra.searchMessages(req, q, { limit: req.query.limit || 25 }));
}));

// Contador de não-lidos da Inbox (para o sino).
app.get('/api/mail/unread', handle(async (req, res) => {
  res.json(await zimbra.unreadCount(req));
}));

// Mensagem completa (corpo HTML/texto + anexos). Marca como lida por padrão.
app.get('/api/mail/messages/:id', handle(async (req, res) => {
  const markRead = req.query.markRead !== '0';
  res.json(await zimbra.getMessage(req, req.params.id, { markRead }));
}));

// Ações: marcar lido/não-lido, sinalizar, lixeira… op ∈ read|!read|flag|!flag|trash|spam
app.post('/api/mail/messages/:id/action', handle(async (req, res) => {
  const op = String(req.body?.op || '').trim();
  if (!op) return res.status(400).json({ error: 'op obrigatório' });
  res.json(await zimbra.actOnMessage(req, req.params.id, op));
}));

// Enviar e-mail (novo ou resposta).
app.post('/api/mail/send', handle(async (req, res) => {
  const { to, cc, subject, text, html, inReplyTo } = req.body || {};
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return res.status(400).json({ error: 'destinatário (to) obrigatório' });
  }
  res.json(await zimbra.sendMessage(req, { to, cc, subject, text, html, inReplyTo }));
}));

// Compromissos do calendário numa janela [start, end] (epoch ms).
app.get('/api/mail/calendar', handle(async (req, res) => {
  const { start, end } = req.query;
  res.json({ events: await zimbra.listAppointments(req, { start, end }) });
}));

// Debug: JSON cru do Zimbra para conferir o mapeamento de campos do appointment.
// Remover após validar slimAppointment contra o servidor real.
app.get('/api/mail/calendar/_debug', handle(async (req, res) => {
  const { start, end } = req.query;
  res.json(await zimbra.listAppointments(req, { start, end, raw: true }));
}));

// Responder convite: aceitar / recusar / talvez.
app.post('/api/mail/calendar/:id/reply', handle(async (req, res) => {
  const { verb, compNum } = req.body || {};
  res.json(await zimbra.replyToInvite(req, { id: req.params.id, verb, compNum }));
}));

// Download de anexo (proxy autenticado).
app.get('/api/mail/messages/:id/attachments/:part', handle(async (req, res) => {
  const { data, contentType } = await zimbra.fetchAttachment(req, req.params.id, req.params.part);
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(data);
}));

// =========================================================================
// DokuWiki XMLRPC — leitura e busca de páginas da wiki corporativa.
// Usa as mesmas credenciais do AD (x-redmine-user / x-redmine-pass).
// Host padrão: wiki.redesoft.com.br (ou DOKUWIKI_HOST env var).
// =========================================================================

// Busca full-text no DokuWiki (scraping do HTML de resultados).
app.get('/api/wiki/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ results: [] });
    res.json({ results: await doku.searchPages(req, q) });
  } catch (err) {
    if (err.code === 'WIKI_NO_CREDS') return res.status(401).json({ error: 'credentials_required' });
    console.error('[wiki/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Conteúdo HTML de uma página via export_xhtmlbody (links reescritos para absolutos).
app.get('/api/wiki/page', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const html = await doku.getPageHTML(req, id);
    res.json({ id, html });
  } catch (err) {
    if (err.code === 'WIKI_NO_CREDS') return res.status(401).json({ error: 'credentials_required' });
    console.error('[wiki/page]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Proxy de mídia (imagens) do DokuWiki — necessário pois o browser não envia Basic Auth em <img>.
app.get('/api/wiki/media', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!url.startsWith('https://')) return res.status(400).end();
    const { user, pass } = doku.getLastWikiCreds();
    const response = await axios.get(url, {
      headers: { ...doku.basicAuth(user, pass) },
      responseType: 'stream',
      timeout: 10000,
    });
    const ct = response.headers['content-type'] || 'image/png';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=3600');
    response.data.pipe(res);
  } catch (err) {
    console.error('[wiki/media]', err.message);
    res.status(404).end();
  }
});

// =========================================================================
// NOVO: CONFIGURAÇÃO PARA INJETAR O FRONTEND DENTRO DO EXECUTÁVEL DO BACKEND
// =========================================================================

// 1. Serve os arquivos estáticos compilados do frontend (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'dist')));

// 2. Rotas de navegação do SPA caem no index.html; rotas /api/ não registradas retornam 404
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// =========================================================================

app.listen(PORT, () => {
  console.log(`\n🔷 Bluemine rodando em http://localhost:${PORT}\n`);
});