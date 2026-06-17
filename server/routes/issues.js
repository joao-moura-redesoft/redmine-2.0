// Rotas de issues do Redmine + busca, journals, uploads e status.
// Montadas em /api (os paths aqui não incluem o prefixo /api).
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { makeRedmine, getMyUserId, buildAuthHeaders, DEFAULT_URL, DEFAULT_KEY } = require('../lib/redmine');
const handle = require('../lib/handle');
const { fetchAllPages, mapLimit, fetchAllIssues } = require('../lib/pagination');
const { syncConcierge, CONCIERGE_INPROGRESS_RE } = require('../services/concierge');

// Minhas issues
router.get('/issues', handle(async (req, res) => {
  const { limit, offset, ...rest } = req.query; // ignora limit/offset do cliente; paginamos tudo
  const params = { assigned_to_id: 'me', status_id: '*', include: 'children', ...rest };
  const issues = await fetchAllIssues(makeRedmine(req), params);
  res.json({ issues, total_count: issues.length });
}));

// Tarefas por ID (para "Observadas" locais) — sem filtro de responsável, qualquer tarefa visível
router.get('/issues/by-ids', handle(async (req, res) => {
  const ids = String(req.query.ids || '').trim();
  if (!ids) return res.json({ issues: [], total_count: 0 });
  const issues = await fetchAllIssues(makeRedmine(req), { issue_id: ids, status_id: '*' });
  res.json({ issues, total_count: issues.length });
}));

// Issues onde sou o DEV Desenvolvedor(a) (CF 141) mas NÃO estou como responsável
router.get('/issues/monitored', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  const all = await fetchAllIssues(makeRedmine(req), { cf_141: userId, status_id: 'open' });
  const issues = all.filter(
    i => !i.assigned_to || String(i.assigned_to.id) !== String(userId)
  );
  res.json({ issues, total_count: issues.length });
}));

// Issues que eu criei
router.get('/issues/authored', handle(async (req, res) => {
  const issues = await fetchAllIssues(makeRedmine(req), { author_id: 'me', status_id: 'open' });
  res.json({ issues, total_count: issues.length });
}));

// Para eu revisar: sou o DEV Revisor (CF 210) e a tarefa está em Pendente Revisão (71)
router.get('/issues/to-review', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  const issues = await fetchAllIssues(makeRedmine(req), { cf_210: userId, status_id: 71 });
  res.json({ issues, total_count: issues.length });
}));

// Detecção de @menção: varre os journals recentes das tarefas em que estou
// envolvido e devolve as notas que citam meu nome/login.
router.get('/issues/mentions', handle(async (req, res) => {
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
router.get('/issues/by-project', handle(async (req, res) => {
  const projectId = req.query.project_id;
  const params = { status_id: 'open' };
  if (projectId) params.project_id = projectId;
  const issues = await fetchAllIssues(makeRedmine(req), params);
  res.json({ issues, total_count: issues.length });
}));

// Issues que eu observo (watcher)
router.get('/issues/watched', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  const { data } = await makeRedmine(req).get('/issues.json', {
    params: { watcher_id: userId, status_id: 'open', limit: 100 }
  });
  res.json(data);
}));

// Concluídas recentemente (para dashboard) — fechadas nos últimos 30 dias
router.get('/issues/completed', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/issues.json', {
    params: { assigned_to_id: 'me', status_id: 'closed', sort: 'updated_on:desc', limit: 100 }
  });
  res.json(data);
}));

// Busca global por ID ou texto (qualquer issue, não só minhas)
router.get('/search', handle(async (req, res) => {
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
router.post('/issues/:id/watch', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  await makeRedmine(req).post(`/issues/${req.params.id}/watchers.json`, { user_id: userId });
  res.json({ success: true });
}));

router.delete('/issues/:id/watch', handle(async (req, res) => {
  const userId = await getMyUserId(req);
  await makeRedmine(req).delete(`/issues/${req.params.id}/watchers/${userId}.json`);
  res.json({ success: true });
}));

// Issue individual com journals, relações, filhos e status permitidos
router.get('/issues/:id', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get(`/issues/${req.params.id}.json`, {
    params: { include: 'journals,attachments,relations,children,watchers,allowed_statuses' }
  });
  res.json(data);
}));

// Atualizar issue — verifica se o status realmente mudou (workflow silencioso)
router.put('/issues/:id', handle(async (req, res) => {
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

// Editar nota de journal (PUT /journals/:id.json)
router.put('/journals/:id', handle(async (req, res) => {
  await makeRedmine(req).put(`/journals/${req.params.id}.json`, req.body);
  res.json({ success: true });
}));

// Criar issue
router.post('/issues', handle(async (req, res) => {
  const { data } = await makeRedmine(req).post('/issues.json', req.body);
  res.json(data);
}));

// Upload de anexo: recebe o binário do arquivo e devolve o token do Redmine.
// (Express.raw específico desta rota; o express.json global ignora octet-stream.)
router.post('/uploads', express.raw({ type: '*/*', limit: '50mb' }), handle(async (req, res) => {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
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
router.get('/issue_statuses', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/issue_statuses.json');
  res.json(data);
}));

// Todas as issues de uma versão (open + closed) — para estatísticas de sprint
router.get('/issues/by-version', handle(async (req, res) => {
  const { project_id, version_id } = req.query;
  if (!project_id || !version_id) return res.json({ issues: [], total_count: 0 });
  const issues = await fetchAllIssues(makeRedmine(req), {
    project_id,
    fixed_version_id: version_id,
    status_id: '*',
  });
  res.json({ issues, total_count: issues.length });
}));

module.exports = router;
