// Rotas de metadados do Redmine: projetos, versões, membros/equipes, trackers,
// prioridades e usuário atual.
const express = require('express');
const router = express.Router();
const { makeRedmine } = require('../lib/redmine');
const handle = require('../lib/handle');
const {
  loadTeamOverrides,
  loadReferenceTeams,
  fetchAllMemberships,
  deriveTeam,
} = require('../services/teams');

// Lista de projetos (paginada). Se o /projects.json do Redmine falhar (ex: 500),
// cai num fallback que monta a lista a partir dos projetos das tarefas visíveis.
async function getProjectList(redmine) {
  try {
    const limit = 100;
    let offset = 0,
      all = [],
      total = Infinity;
    while (offset < total) {
      const { data } = await redmine.get('/projects.json', { params: { limit, offset } });
      if (data.total_count != null) total = data.total_count;
      all = all.concat(data.projects || []);
      offset += limit;
      if ((data.projects || []).length === 0) break;
    }
    return all.map((p) => ({ id: p.id, name: p.name }));
  } catch (err) {
    console.error(
      '[projects] /projects.json falhou:',
      err.response?.status,
      JSON.stringify(err.response?.data ?? err.message),
    );
    const { data } = await redmine.get('/issues.json', {
      params: { assigned_to_id: 'me', status_id: '*', limit: 100 },
    });
    const map = new Map();
    for (const i of data.issues || []) if (i.project) map.set(i.project.id, i.project.name);
    const projects = [...map.entries()].map(([id, name]) => ({ id, name }));
    console.warn(`[projects] usando fallback por tarefas: ${projects.length} projetos`);
    return projects;
  }
}

// Versões de um projeto
router.get(
  '/projects/:id/versions',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get(`/projects/${req.params.id}/versions.json`);
    res.json(data);
  }),
);

// Projetos
router.get(
  '/projects',
  handle(async (req, res) => {
    const projects = (await getProjectList(makeRedmine(req))).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR'),
    );
    res.json({ projects, total_count: projects.length });
  }),
);

// Membros de TODOS os projetos, unificados (para a opção "Todos os projetos" em Pessoas)
router.get(
  '/members',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const projects = await getProjectList(redmine);
    const overrides = loadTeamOverrides();
    const refTeams = await loadReferenceTeams(req);

    const byId = new Map();
    for (const p of projects) {
      let memberships = [];
      try {
        memberships = await fetchAllMemberships(redmine, p.id);
      } catch {
        /* projeto inacessível */
      }
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
  }),
);

// Trackers
router.get(
  '/trackers',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get('/trackers.json');
    res.json(data);
  }),
);

// Prioridades
router.get(
  '/enumerations/issue_priorities',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get('/enumerations/issue_priorities.json');
    res.json(data);
  }),
);

// Usuário atual
router.get(
  '/users/current',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get('/users/current.json');
    res.json(data);
  }),
);

// Membros de um projeto — busca todas as páginas, agrupa por equipe e ordena
router.get(
  '/projects/:id/memberships',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const allMemberships = await fetchAllMemberships(redmine, req.params.id);

    const overrides = loadTeamOverrides();
    const refTeams = await loadReferenceTeams(req);
    const seen = new Set();
    const users = allMemberships
      .filter((m) => m.user)
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        team: deriveTeam(m.roles, m.user.id, overrides, refTeams),
      }))
      .filter((u) => {
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    res.json({ users });
  }),
);

module.exports = router;
