const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Credenciais vêm sempre dos headers do request (definidas no login).
// Sem fallback: quem não autenticar não acessa nada.
const DEFAULT_URL = '';
const DEFAULT_KEY = '';

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

// Guarda as últimas credenciais autenticadas vistas (para requests sem headers,
// como <img> de anexos, que não passam pelos headers do axios do cliente).
let lastAuth = { url: DEFAULT_URL, key: DEFAULT_KEY };

// Cria instância do axios para cada request com as credenciais certas
function makeRedmine(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  if (url && key) lastAuth = { url, key };
  return axios.create({
    baseURL: url,
    headers: { 'X-Redmine-API-Key': key, 'Content-Type': 'application/json' },
  });
}

// Cache de userId por "url:key"
const userIdCache = new Map();
async function getMyUserId(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const cacheKey = `${url}:${key}`;
  if (userIdCache.has(cacheKey)) return userIdCache.get(cacheKey);
  const { data } = await makeRedmine(req).get('/users/current.json');
  userIdCache.set(cacheKey, data.user.id);
  return data.user.id;
}

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) {
    const status = err.response?.status || 500;
    const data   = err.response?.data;
    console.error(`[${req.method} ${req.path}] ${status}:`, JSON.stringify(data ?? err.message));
    res.status(status).json(data ?? { error: err.message });
  }
};

// Busca TODAS as páginas de issues para um conjunto de filtros (remove o teto de 100).
// Trava de segurança em 2000 para não varrer bases enormes sem querer.
async function fetchAllIssues(redmine, params) {
  const limit = 100;
  const MAX = 2000;
  let offset = 0, all = [], total = Infinity;
  while (offset < total && all.length < MAX) {
    const { data } = await redmine.get('/issues.json', { params: { ...params, limit, offset } });
    total = data.total_count ?? 0;
    all = all.concat(data.issues || []);
    if ((data.issues || []).length === 0) break;
    offset += limit;
  }
  return all;
}

// Minhas issues
app.get('/api/issues', handle(async (req, res) => {
  const { limit, offset, ...rest } = req.query; // ignora limit/offset do cliente; paginamos tudo
  const params = { assigned_to_id: 'me', status_id: '*', ...rest };
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

// Tarefas abertas de um projeto (qualquer responsável) — para o Quadro do time
app.get('/api/issues/by-project', handle(async (req, res) => {
  const projectId = req.query.project_id;
  if (!projectId) return res.json({ issues: [], total_count: 0 });
  const issues = await fetchAllIssues(makeRedmine(req), { project_id: projectId, status_id: 'open' });
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
  }

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
  if (url && key) lastAuth = { url, key };
  const filename = String(req.query.filename || 'arquivo');
  const { data } = await axios.post(`${url}/uploads.json`, req.body, {
    params: { filename },
    headers: { 'X-Redmine-API-Key': key, 'Content-Type': 'application/octet-stream' },
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

// Lista de projetos (paginada). Se o /projects.json do Redmine falhar (ex: 500),
// cai num fallback que monta a lista a partir dos projetos das tarefas visíveis.
async function getProjectList(redmine) {
  try {
    const limit = 100;
    let offset = 0, all = [], total = Infinity;
    while (offset < total) {
      const { data } = await redmine.get('/projects.json', { params: { limit, offset } });
      total = data.total_count ?? 0;
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

// Lê o teams.json (overrides manuais + projeto de referência), recarregado a cada request
function loadTeamsConfig() {
  try {
    const raw = require('fs').readFileSync(require('path').join(__dirname, 'teams.json'), 'utf8');
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
    total = data.total_count ?? 0;
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
  const { url, key } = lastAuth;
  if (!url || !key) return res.status(401).json({ error: 'Não autenticado' });
  const path = `/attachments/download/${req.params.id}/${encodeURIComponent(req.params.filename)}`;
  const upstream = await axios.get(`${url}${path}`, {
    headers: { 'X-Redmine-API-Key': key },
    responseType: 'arraybuffer',
  });
  res.set('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(upstream.data));
}));

app.listen(PORT, () => {
  console.log(`\n🚀 Redmine Kanban API rodando em http://localhost:${PORT}\n`);
});
