// Derivação de equipe a partir dos papéis (roles) do Redmine, com override manual
// (teams.json) e mapa de um projeto de referência. Não precisa de admin.
const path = require('path');
const fs = require('fs');
const { makeRedmine, DEFAULT_URL, DEFAULT_KEY } = require('../lib/redmine');

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

// Lê o teams.json da pasta server/ (__dirname aqui é server/services).
function loadTeamsConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'teams.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function loadTeamOverrides() {
  return loadTeamsConfig().overrides || {};
}

// Busca TODAS as páginas de membros de um projeto
async function fetchAllMemberships(redmine, projectId) {
  const limit = 100;
  let offset = 0,
    all = [],
    total = Infinity;
  while (offset < total) {
    const { data } = await redmine.get(`/projects/${projectId}/memberships.json`, {
      params: { limit, offset },
    });
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
        params: { assigned_to_id: 'me', status_id: '*', limit: 100 },
      });
      const projIds = [...new Set((data.issues || []).map((i) => i.project?.id).filter(Boolean))];
      let bestScore = -1;
      for (const pid of projIds) {
        try {
          const { data: md } = await redmine.get(`/projects/${pid}/memberships.json`, {
            params: { limit: 100 },
          });
          const score = (md.memberships || []).reduce(
            (s, m) => s + ((m.roles || []).some((r) => roleToTeam(r.name)) ? 1 : 0),
            0,
          );
          if (score > bestScore) {
            bestScore = score;
            projectId = pid;
          }
        } catch {
          /* ignora projeto inacessível */
        }
      }
    }

    // 3) Monta o mapa a partir dos membros do projeto de referência
    if (projectId) {
      const memberships = await fetchAllMemberships(redmine, projectId);
      for (const m of memberships) {
        if (!m.user || map.has(m.user.id)) continue;
        for (const r of m.roles || []) {
          const t = roleToTeam(r.name);
          if (t) {
            map.set(m.user.id, t);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      '[teams] não foi possível montar o mapa de equipes de referência:',
      err.response?.status || err.message,
    );
  }

  refTeamsCache.set(cacheKey, { map, projectId, ts: Date.now() });
  console.log(
    `[teams] projeto de referência = ${projectId ?? 'nenhum'}, ${map.size} pessoas mapeadas`,
  );
  return map;
}

function deriveTeam(roles, userId, overrides, refTeams) {
  // 1) Override manual tem prioridade
  if (overrides[String(userId)]) return overrides[String(userId)];
  // 2) Equipe vinda do projeto de referência (independente do projeto atual)
  if (refTeams && refTeams.has(userId)) return refTeams.get(userId);
  // 3) Fallback: papel da pessoa no próprio projeto atual
  for (const r of roles || []) {
    const t = roleToTeam(r.name);
    if (t) return t;
  }
  return 'Outros';
}

module.exports = {
  TEAM_LABELS,
  roleToTeam,
  loadTeamsConfig,
  loadTeamOverrides,
  fetchAllMemberships,
  loadReferenceTeams,
  deriveTeam,
};
