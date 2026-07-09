// Rotas de issues do Redmine + busca, journals, uploads e status.
// Montadas em /api (os paths aqui não incluem o prefixo /api).
const express = require('express');
const axios = require('axios');
const router = express.Router();
const {
  makeRedmine,
  getMyUserId,
  buildAuthHeaders,
  DEFAULT_URL,
  DEFAULT_KEY,
} = require('../lib/redmine');
const handle = require('../lib/handle');
const { mapLimit, fetchAllIssues } = require('../lib/pagination');
const { parseEditFormSchema } = require('../lib/editFormSchema');
const { REDMINE_CF, REDMINE_STATUS } = require('../lib/config');
const { sanitizeIssueBody, toLatin1Safe } = require('../lib/latin1');

// Filtros nomeados por campo custom, resolvidos pela config central (env-overridable).
const CF_DEVELOPER = `cf_${REDMINE_CF.developer}`;
const CF_REVIEWER = `cf_${REDMINE_CF.reviewer}`;

// Minhas issues
router.get(
  '/issues',
  handle(async (req, res) => {
    const { limit, offset, ...rest } = req.query; // ignora limit/offset do cliente; paginamos tudo
    const params = { assigned_to_id: 'me', status_id: '*', include: 'children', ...rest };
    const issues = await fetchAllIssues(makeRedmine(req), params);
    res.json({ issues, total_count: issues.length });
  }),
);

// Tarefas por ID (para "Observadas" locais) — sem filtro de responsável, qualquer tarefa visível
router.get(
  '/issues/by-ids',
  handle(async (req, res) => {
    const ids = String(req.query.ids || '').trim();
    if (!ids) return res.json({ issues: [], total_count: 0 });
    const issues = await fetchAllIssues(makeRedmine(req), { issue_id: ids, status_id: '*' });
    res.json({ issues, total_count: issues.length });
  }),
);

// Issues onde sou o DEV Desenvolvedor(a) (CF 141) mas NÃO estou como responsável
router.get(
  '/issues/monitored',
  handle(async (req, res) => {
    const userId = await getMyUserId(req);
    const all = await fetchAllIssues(makeRedmine(req), {
      [CF_DEVELOPER]: userId,
      status_id: 'open',
    });
    const issues = all.filter((i) => !i.assigned_to || String(i.assigned_to.id) !== String(userId));
    res.json({ issues, total_count: issues.length });
  }),
);

// Issues que eu criei
router.get(
  '/issues/authored',
  handle(async (req, res) => {
    const issues = await fetchAllIssues(makeRedmine(req), { author_id: 'me', status_id: 'open' });
    res.json({ issues, total_count: issues.length });
  }),
);

// Para eu revisar: sou o DEV Revisor (CF 210) e a tarefa está em Pendente Revisão (71)
router.get(
  '/issues/to-review',
  handle(async (req, res) => {
    const userId = await getMyUserId(req);
    const issues = await fetchAllIssues(makeRedmine(req), {
      [CF_REVIEWER]: userId,
      status_id: REDMINE_STATUS.pendingReview,
    });
    res.json({ issues, total_count: issues.length });
  }),
);

// Detecção de @menção: varre os journals recentes das tarefas em que estou
// envolvido e devolve as notas que citam meu nome/login.
router.get(
  '/issues/mentions',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const { data: me } = await redmine.get('/users/current.json');
    const user = me.user;
    const userId = user.id;
    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Conjunto de candidatas: atribuídas a mim, criadas por mim, onde sou dev (141) ou revisor (210).
    const sets = await Promise.all([
      fetchAllIssues(redmine, { assigned_to_id: 'me', status_id: '*', sort: 'updated_on:desc' }),
      fetchAllIssues(redmine, { author_id: 'me', status_id: 'open', sort: 'updated_on:desc' }),
      fetchAllIssues(redmine, {
        [CF_DEVELOPER]: userId,
        status_id: 'open',
        sort: 'updated_on:desc',
      }),
      fetchAllIssues(redmine, {
        [CF_REVIEWER]: userId,
        status_id: 'open',
        sort: 'updated_on:desc',
      }),
    ]);
    const byId = new Map();
    sets.flat().forEach((i) => {
      if (!byId.has(i.id)) byId.set(i.id, i);
    });
    // Só vale a pena abrir as que mudaram na última semana.
    const candidates = [...byId.values()]
      .filter((i) => new Date(i.updated_on).getTime() >= sinceMs)
      .slice(0, 60);

    // Padrões de menção: "@login", "@Nome", nome completo, ou login isolado.
    const needles = [user.login, user.firstname, `${user.firstname} ${user.lastname}`]
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    const matches = (text) => {
      const t = text.toLowerCase();
      if (t.includes(`@${user.login.toLowerCase()}`)) return true;
      if (t.includes(`@${user.firstname.toLowerCase()}`)) return true;
      return needles.some((n) => n.includes(' ') && t.includes(n)); // nome completo
    };

    const detailed = await mapLimit(candidates, 6, async (i) => {
      const { data } = await redmine.get(`/issues/${i.id}.json`, {
        params: { include: 'journals' },
      });
      return data.issue;
    });

    const mentions = [];
    for (const issue of detailed) {
      if (!issue) continue;
      for (const j of issue.journals || []) {
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
  }),
);

// Tarefas abertas de um projeto (qualquer responsável) — para o Quadro do time
// Sem project_id = todos os projetos visíveis ao usuário
router.get(
  '/issues/by-project',
  handle(async (req, res) => {
    const projectId = req.query.project_id;
    const params = { status_id: 'open' };
    if (projectId) params.project_id = projectId;
    const issues = await fetchAllIssues(makeRedmine(req), params);
    res.json({ issues, total_count: issues.length });
  }),
);

// Issues que eu observo (watcher)
router.get(
  '/issues/watched',
  handle(async (req, res) => {
    const userId = await getMyUserId(req);
    const { data } = await makeRedmine(req).get('/issues.json', {
      params: { watcher_id: userId, status_id: 'open', limit: 100 },
    });
    res.json(data);
  }),
);

// Concluídas recentemente (para dashboard) — fechadas nos últimos 30 dias
router.get(
  '/issues/completed',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get('/issues.json', {
      params: { assigned_to_id: 'me', status_id: 'closed', sort: 'updated_on:desc', limit: 100 },
    });
    res.json(data);
  }),
);

// Busca global por ID ou texto (qualquer issue, não só minhas)
router.get(
  '/search',
  handle(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ issues: [] });
    const redmine = makeRedmine(req);

    // Se for número, tenta buscar pelo ID direto
    if (/^\d+$/.test(q)) {
      try {
        const { data } = await redmine.get(`/issues/${q}.json`);
        return res.json({ issues: [data.issue] });
      } catch {
        /* cai para busca textual */
      }
    }

    const { data } = await redmine.get('/issues.json', {
      params: { subject: `~${q}`, status_id: '*', limit: 30, sort: 'updated_on:desc' },
    });
    res.json({ issues: data.issues || [] });
  }),
);

// Watchers: adicionar / remover
router.post(
  '/issues/:id/watch',
  handle(async (req, res) => {
    const userId = await getMyUserId(req);
    await makeRedmine(req).post(`/issues/${req.params.id}/watchers.json`, { user_id: userId });
    res.json({ success: true });
  }),
);

router.delete(
  '/issues/:id/watch',
  handle(async (req, res) => {
    const userId = await getMyUserId(req);
    await makeRedmine(req).delete(`/issues/${req.params.id}/watchers/${userId}.json`);
    res.json({ success: true });
  }),
);

// Cache das transições de workflow. A chave NÃO é a tarefa: as transições
// dependem apenas do (projeto, tracker, status atual, se sou autor, se sou
// responsável) + credencial. Duas tarefas no mesmo estado/tracker/projeto
// compartilham a mesma lista — então raspamos uma vez, não uma por tarefa.
// TTL longo porque workflow do Redmine muda raríssimas vezes (config de admin).
const allowedCache = new Map(); // cacheKey -> { value, expiresAt }
const ALLOWED_TTL_MS = 10 * 60 * 1000;
// Cache do schema de campos (popup de obrigatórios), por projeto+tracker.
const fieldSchemaCache = new Map(); // cacheKey -> { value, expiresAt }
const FIELD_SCHEMA_TTL_MS = 5 * 60 * 1000;

function workflowCacheKey(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const cred = key || `${username}:${password}`;
  const { project_id, tracker_id, status_id, is_author, is_assignee } = req.query;
  return `${url}:${cred}:p${project_id}:t${tracker_id}:s${status_id}:a${is_author}:g${is_assignee}`;
}

// Limpeza periódica de entradas expiradas (evita crescimento ilimitado do Map).
setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of allowedCache) if (now > v.expiresAt) allowedCache.delete(k);
    for (const [k, v] of fieldSchemaCache) if (now > v.expiresAt) fieldSchemaCache.delete(k);
  },
  5 * 60 * 1000,
).unref();

// Redmine < 5.0 não expõe `allowed_statuses` na API REST. As transições de
// workflow só existem no <select> de status da página HTML da issue — mesma
// lista que a interface web mostra. Extraímos de lá. (Sem cache aqui: o cache
// é feito por workflow no endpoint, não por tarefa.)
async function scrapeAllowedStatuses(redmine, id) {
  try {
    const { data } = await redmine.get(`/issues/${id}`, {
      headers: { Accept: 'text/html' },
      responseType: 'text',
    });
    const sel = String(data).match(
      /<select[^>]*name="issue\[status_id\]"[^>]*>([\s\S]*?)<\/select>/i,
    );
    if (!sel) return null;
    const opts = [...sel[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map(
      (m) => ({ id: Number(m[1]), name: m[2].trim() }),
    );
    return opts.length ? opts : null;
  } catch {
    return null; // sem permissão de editar / HTML mudou: cai no fallback (mostra todos)
  }
}

// Transições de workflow permitidas — endpoint dedicado e "lazy" (o front busca
// sob demanda). Cacheado por workflow, não por tarefa: o front manda os
// determinantes (projeto/tracker/status/autor/responsável) como query params.
router.get(
  '/issues/:id/allowed-statuses',
  handle(async (req, res) => {
    const cacheKey = workflowCacheKey(req);
    const cached = allowedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ allowed_statuses: cached.value });
    }
    const allowed = await scrapeAllowedStatuses(makeRedmine(req), req.params.id);
    allowedCache.set(cacheKey, { value: allowed, expiresAt: Date.now() + ALLOWED_TTL_MS });
    res.json({ allowed_statuses: allowed });
  }),
);

// Schema dos campos editáveis (rótulo, tipo, opções) extraído do formulário da
// página show. Usado pelo popup de campos obrigatórios. Cache por projeto+tracker
// (a estrutura de campos depende disso).
router.get(
  '/issues/:id/edit-fields',
  handle(async (req, res) => {
    const url = req.headers['x-redmine-url'] || DEFAULT_URL;
    const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
    const username = req.headers['x-redmine-user'] || '';
    const password = req.headers['x-redmine-pass'] || '';
    const cred = key || `${username}:${password}`;
    const { project_id, tracker_id } = req.query;
    const cacheKey = `${url}:${cred}:p${project_id}:t${tracker_id}`;

    const cached = fieldSchemaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ fields: cached.value });
    }
    let fields = [];
    try {
      const { data } = await makeRedmine(req).get(`/issues/${req.params.id}`, {
        headers: { Accept: 'text/html' },
        responseType: 'text',
      });
      fields = parseEditFormSchema(data);
    } catch {
      /* sem permissão / HTML mudou: devolve vazio */
    }
    fieldSchemaCache.set(cacheKey, { value: fields, expiresAt: Date.now() + FIELD_SCHEMA_TTL_MS });
    res.json({ fields });
  }),
);

// Todas as issues de uma versão (open + closed) — para estatísticas de sprint.
// DEVE vir antes de '/issues/:id' senão o :id captura "by-version" e dá 404.
router.get(
  '/issues/by-version',
  handle(async (req, res) => {
    const { project_id, version_id } = req.query;
    if (!version_id) return res.json({ issues: [], total_count: 0 });
    // project_id é opcional: versões compartilhadas têm tarefas em vários
    // projetos, então filtrar só por fixed_version_id traz a versão inteira.
    const filter = { fixed_version_id: version_id, status_id: '*' };
    if (project_id) filter.project_id = project_id;
    const issues = await fetchAllIssues(makeRedmine(req), filter);
    res.json({ issues, total_count: issues.length });
  }),
);

// Issue individual com journals, relações, filhos e status permitidos
router.get(
  '/issues/:id',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get(`/issues/${req.params.id}.json`, {
      params: { include: 'journals,attachments,relations,children,watchers,allowed_statuses' },
    });
    res.json(data);
  }),
);

// Atualizar issue — verifica se o status realmente mudou (workflow silencioso)
router.put(
  '/issues/:id',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    // Guarda latin1: o banco do Redmine rejeita (500) caracteres > U+00FF.
    // Fecha os caminhos de escrita que não passam pelo markdownToTextile do cliente.
    sanitizeIssueBody(req.body);
    console.log(
      `[PUT /issues/:id] URL Alvo: ${req.headers['x-redmine-url']} -> /issues/${req.params.id}.json`,
    );
    await redmine.put(`/issues/${req.params.id}.json`, req.body);

    const requestedStatusId = req.body?.issue?.status_id;
    if (requestedStatusId) {
      const { data } = await redmine.get(`/issues/${req.params.id}.json`);
      const actual = data.issue.status;
      if (String(actual.id) !== String(requestedStatusId)) {
        return res.status(422).json({
          error: `Transição não permitida pelo workflow do Redmine. Status atual: "${actual.name}". Configure as transições em Administração → Workflow.`,
        });
      }
    }

    res.json({ success: true });
  }),
);

// Editar nota de journal (PUT /journals/:id.json)
router.put(
  '/journals/:id',
  handle(async (req, res) => {
    // Guarda latin1 (banco do Redmine rejeita > U+00FF com 500).
    if (typeof req.body?.journal?.notes === 'string') {
      req.body.journal.notes = toLatin1Safe(req.body.journal.notes);
    }
    await makeRedmine(req).put(`/journals/${req.params.id}.json`, req.body);
    res.json({ success: true });
  }),
);

// Criar issue
router.post(
  '/issues',
  handle(async (req, res) => {
    sanitizeIssueBody(req.body);
    const { data } = await makeRedmine(req).post('/issues.json', req.body);
    res.json(data);
  }),
);

// Upload de anexo: recebe o binário do arquivo e devolve o token do Redmine.
// (Express.raw específico desta rota; o express.json global ignora octet-stream.)
router.post(
  '/uploads',
  express.raw({ type: '*/*', limit: '50mb' }),
  handle(async (req, res) => {
    const url = req.headers['x-redmine-url'] || DEFAULT_URL;
    const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
    const username = req.headers['x-redmine-user'] || '';
    const password = req.headers['x-redmine-pass'] || '';
    const filename = String(req.query.filename || 'arquivo');
    const { data } = await axios.post(`${url}/uploads.json`, req.body, {
      params: { filename },
      headers: {
        ...buildAuthHeaders(key, username, password),
        'Content-Type': 'application/octet-stream',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    res.json({ token: data.upload?.token, filename });
  }),
);

// Status
router.get(
  '/issue_statuses',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get('/issue_statuses.json');
    res.json(data);
  }),
);

module.exports = router;
