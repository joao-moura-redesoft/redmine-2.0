// ANALYTICS DE FLUXO — envelhecimento (aging WIP), gargalos por status e tempo
// de ciclo. Computado no servidor a partir das issues do Redmine (uma vez, sem
// varrer journals: usa `updated_on` como proxy de "tempo parada").
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const { makeRedmine } = require('../lib/redmine');
const { fetchAllIssues } = require('../lib/pagination');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (iso) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : 0;

// Limiares de envelhecimento (dias sem atualização). Configuráveis por query.
const bucketOf = (d, watch, stuck) => (d >= stuck ? 'stuck' : d >= watch ? 'watch' : 'fresh');

// Cache em memória para os dashboards (evita refazer agregações pesadas).
// TTL de 5 minutos, separado por usuário (usando a key).
const analyticsCache = new Map();
const ANALYTICS_CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of analyticsCache) if (now > v.expiresAt) analyticsCache.delete(k);
}, Math.max(5000, ANALYTICS_CACHE_TTL)).unref();

router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const authKey = req.headers['x-redmine-key'] || req.headers['x-redmine-user'] || 'anon';
  const key = `${authKey}|${req.originalUrl}`;
  
  const cached = analyticsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.data);
  }
  
  const originalJson = res.json;
  res.json = function (data) {
    analyticsCache.set(key, { data, expiresAt: Date.now() + ANALYTICS_CACHE_TTL });
    originalJson.call(this, data);
  };
  next();
});

router.get(
  '/analytics/flow',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
    const watch = Number(req.query.watch) || 3;
    const stuck = Number(req.query.stuck) || 7;
    const base = projectId ? { project_id: projectId } : {};

    const open = await fetchAllIssues(redmine, { status_id: 'open', ...base });

    // ── Distribuição por status (gargalos) ──
    const byStatus = new Map();
    const buckets = { fresh: 0, watch: 0, stuck: 0 };
    const byAssignee = new Map();
    for (const i of open) {
      const age = daysAgo(i.updated_on);
      const b = bucketOf(age, watch, stuck);
      buckets[b]++;

      const s = i.status?.name || '—';
      const rec = byStatus.get(s) || { status: s, count: 0, ageSum: 0, stuck: 0 };
      rec.count++;
      rec.ageSum += age;
      if (b === 'stuck') rec.stuck++;
      byStatus.set(s, rec);

      if (b === 'stuck') {
        const a = i.assigned_to?.name || 'Sem responsável';
        byAssignee.set(a, (byAssignee.get(a) || 0) + 1);
      }
    }
    const statusDistribution = [...byStatus.values()]
      .map((r) => ({
        status: r.status,
        count: r.count,
        stuck: r.stuck,
        avgAge: Math.round(r.ageSum / r.count),
      }))
      .sort((a, b) => b.count - a.count);

    // ── Lista das mais paradas ──
    const agingList = open
      .map((i) => ({
        id: i.id,
        subject: i.subject,
        status: i.status?.name || '—',
        assignee: i.assigned_to?.name || null,
        priority: i.priority?.name || null,
        project: i.project?.name || null,
        days: daysAgo(i.updated_on),
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 20);

    const stuckByAssignee = [...byAssignee.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ── Tempo de ciclo (fechadas nos últimos 30 dias) ──
    let cycle = { count: 0, avg: null, median: null };
    try {
      const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
      const closed = await fetchAllIssues(redmine, {
        status_id: 'closed',
        updated_on: `>=${since}`,
        ...base,
      });
      const durations = closed
        .filter((i) => i.closed_on && i.created_on)
        .map((i) => Math.max(0, (new Date(i.closed_on) - new Date(i.created_on)) / DAY))
        .sort((a, b) => a - b);
      if (durations.length) {
        const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
        const mid = Math.floor(durations.length / 2);
        const median =
          durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
        cycle = { count: durations.length, avg: +avg.toFixed(1), median: +median.toFixed(1) };
      }
    } catch {
      /* fechadas são best-effort */
    }

    const oldest = agingList[0]?.days || 0;
    res.json({
      totalOpen: open.length,
      capped: open.length >= 2000,
      thresholds: { watch, stuck },
      buckets,
      statusDistribution,
      agingList,
      stuckByAssignee,
      cycle,
      oldest,
      generatedAt: Date.now(),
    });
  }),
);

// Primeiro dia do mês (monthsBack-1) meses atrás — início da janela.
const windowStartOf = (now, monthsBack) =>
  new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

// TENDÊNCIAS HISTÓRICAS — agregação pura (testável). Recebe as issues já buscadas
// e monta criadas/fechadas por mês + backlog reconstruído a partir do total aberto
// AGORA, andando para trás pelo saldo mensal (criadas − fechadas). É uma aproximação
// (ignora reaberturas e itens excluídos), mas direcionalmente correta e barata.
function computeTrends({ createdIssues, closedIssues, openIssues, monthsBack, now = new Date() }) {
  const windowStart = windowStartOf(now, monthsBack);

  // Buckets de mês, do mais antigo ao atual.
  const monthKeys = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(windowStart.getFullYear(), windowStart.getMonth() + i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const idx = new Map(monthKeys.map((k, i) => [k, i]));
  const created = new Array(monthsBack).fill(0);
  const closed = new Array(monthsBack).fill(0);
  const monthKey = (iso) => (iso ? iso.slice(0, 7) : null);

  for (const i of createdIssues) {
    const k = monthKey(i.created_on);
    if (k != null && idx.has(k)) created[idx.get(k)]++;
  }
  for (const i of closedIssues) {
    const k = monthKey(i.closed_on);
    if (k != null && idx.has(k)) closed[idx.get(k)]++;
  }

  // Backlog reconstruído a partir do total aberto agora.
  const totalOpenNow = openIssues.length;
  const net = monthKeys.map((_, i) => created[i] - closed[i]);
  const backlog = new Array(monthsBack).fill(0);
  backlog[monthsBack - 1] = totalOpenNow;
  for (let i = monthsBack - 2; i >= 0; i--) backlog[i] = backlog[i + 1] - net[i + 1];

  const months = monthKeys.map((key, i) => ({
    key,
    created: created[i],
    closed: closed[i],
    net: net[i],
    backlog: backlog[i],
  }));

  const createdTotal = created.reduce((s, n) => s + n, 0);
  const closedTotal = closed.reduce((s, n) => s + n, 0);
  const backlogStart = backlog[0];
  const backlogEnd = backlog[monthsBack - 1];
  const backlogDelta = backlogEnd - backlogStart;
  const trend = backlogDelta > 2 ? 'growing' : backlogDelta < -2 ? 'shrinking' : 'stable';

  return {
    months,
    monthsBack,
    totalOpenNow,
    capped:
      createdIssues.length >= 2000 || closedIssues.length >= 2000 || openIssues.length >= 2000,
    summary: {
      createdTotal,
      closedTotal,
      netTotal: createdTotal - closedTotal,
      avgCreated: +(createdTotal / monthsBack).toFixed(1),
      avgClosed: +(closedTotal / monthsBack).toFixed(1),
      backlogStart,
      backlogEnd,
      backlogDelta,
      trend,
    },
  };
}

router.get(
  '/analytics/trends',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
    const monthsBack = Math.min(24, Math.max(3, Number(req.query.months) || 6));
    const base = projectId ? { project_id: projectId } : {};

    const now = new Date();
    const startIso = windowStartOf(now, monthsBack).toISOString().slice(0, 10);

    // Criadas na janela (qualquer status).
    const createdIssues = await fetchAllIssues(redmine, {
      status_id: '*',
      created_on: `>=${startIso}`,
      ...base,
    });
    // Fechadas na janela — proxy por updated_on, contadas pelo closed_on real.
    const closedIssues = await fetchAllIssues(redmine, {
      status_id: 'closed',
      updated_on: `>=${startIso}`,
      ...base,
    });
    // Total aberto agora — âncora do backlog.
    const openIssues = await fetchAllIssues(redmine, { status_id: 'open', ...base });

    const result = computeTrends({ createdIssues, closedIssues, openIssues, monthsBack, now });
    res.json({ ...result, generatedAt: Date.now() });
  }),
);

// SLA / PRAZOS — agregação pura (testável). A partir das abertas e das fechadas
// recentes, mede: cumprimento de prazo (fechadas no prazo × atrasadas), vencidas
// agora e o que vence no horizonte, agrupado por responsável. Só usa due_date e
// closed_on — campos padrão da issue, sem varrer journals.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeSla({ openIssues, closedIssues, horizon = 7, now = new Date() }) {
  const today = ymd(now);
  const horizonDate = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + horizon));
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

  // ── Abertas com prazo ──
  const withDue = openIssues.filter((i) => i.due_date);
  const overdue = withDue.filter((i) => i.due_date < today);
  const dueToday = withDue.filter((i) => i.due_date === today);
  const dueSoon = withDue.filter((i) => i.due_date > today && i.due_date <= horizonDate);

  const overdueList = overdue
    .map((i) => ({
      id: i.id,
      subject: i.subject,
      assignee: i.assigned_to?.name || null,
      project: i.project?.name || null,
      due_date: i.due_date,
      daysOverdue: dayDiff(i.due_date, today),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 20);

  // ── Vencendo no horizonte (hoje..+horizon), agrupado por responsável ──
  const byAssignee = new Map();
  for (const i of [...dueToday, ...dueSoon]) {
    const name = i.assigned_to?.name || 'Sem responsável';
    const rec = byAssignee.get(name) || { name, count: 0, issues: [] };
    rec.count++;
    rec.issues.push({
      id: i.id,
      subject: i.subject,
      due_date: i.due_date,
      daysUntil: dayDiff(today, i.due_date),
    });
    byAssignee.set(name, rec);
  }
  const upcoming = [...byAssignee.values()]
    .map((r) => ({
      ...r,
      issues: r.issues.sort((a, b) => a.due_date.localeCompare(b.due_date)),
    }))
    .sort((a, b) => b.count - a.count);

  // ── Vencidas por responsável (barra) ──
  const overdueByAssignee = new Map();
  for (const i of overdue) {
    const name = i.assigned_to?.name || 'Sem responsável';
    overdueByAssignee.set(name, (overdueByAssignee.get(name) || 0) + 1);
  }
  const byAssigneeOverdue = [...overdueByAssignee.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ── Performance de entrega (fechadas com prazo na janela) ──
  const closedWithDue = closedIssues.filter((i) => i.due_date && i.closed_on);
  let onTime = 0,
    late = 0,
    lateSum = 0;
  for (const i of closedWithDue) {
    const closedYmd = i.closed_on.slice(0, 10);
    if (closedYmd <= i.due_date) onTime++;
    else {
      late++;
      lateSum += dayDiff(i.due_date, closedYmd);
    }
  }
  const totalDelivered = onTime + late;
  const rate = totalDelivered ? Math.round((onTime / totalDelivered) * 100) : null;
  const avgLateDays = late ? +(lateSum / late).toFixed(1) : 0;

  const avgOverdueDays = overdue.length
    ? +(overdue.reduce((s, i) => s + dayDiff(i.due_date, today), 0) / overdue.length).toFixed(1)
    : 0;

  return {
    open: {
      total: openIssues.length,
      withDue: withDue.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
      avgOverdueDays,
    },
    delivery: { closedWithDue: totalDelivered, onTime, late, rate, avgLateDays },
    overdueList,
    upcoming,
    byAssigneeOverdue,
    horizon,
    capped: openIssues.length >= 2000 || closedIssues.length >= 2000,
  };
}

router.get(
  '/analytics/sla',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
    const horizon = Math.min(30, Math.max(1, Number(req.query.horizon) || 7));
    const days = Math.min(365, Math.max(30, Number(req.query.days) || 90));
    const base = projectId ? { project_id: projectId } : {};

    const now = new Date();
    const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

    // Abertas — vencidas e a vencer.
    const openIssues = await fetchAllIssues(redmine, { status_id: 'open', ...base });
    // Fechadas na janela — cumprimento de prazo (proxy por updated_on).
    const closedIssues = await fetchAllIssues(redmine, {
      status_id: 'closed',
      updated_on: `>=${since}`,
      ...base,
    });

    const result = computeSla({ openIssues, closedIssues, horizon, now });
    res.json({ ...result, window: { days, horizon }, generatedAt: Date.now() });
  }),
);

// DASHBOARD DE PROJETO — agregação pura (testável). Diferente das demais abas,
// olha UM projeto e TODAS as suas tarefas (não só as minhas): totais e conclusão,
// distribuição por status/tipo/prioridade/responsável e saúde das versões.
// `closed_on` presente = tarefa fechada (indicador confiável no REST).
function computeProject({ issues, versions, now = new Date() }) {
  const today = ymd(now);
  const isClosed = (i) => !!i.closed_on;

  const total = issues.length;
  const openArr = issues.filter((i) => !isClosed(i));
  const closed = total - openArr.length;
  const completion = total ? Math.round((closed / total) * 100) : 0;

  const countBy = (arr, keyFn) => {
    const m = new Map();
    for (const i of arr) {
      const k = keyFn(i);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  };

  const byStatus = countBy(openArr, (i) => i.status?.name || '—');
  const byPriority = countBy(openArr, (i) => i.priority?.name || '—');
  const byAssignee = countBy(openArr, (i) => i.assigned_to?.name || 'Sem responsável').slice(0, 10);

  // Por tipo (tracker): aberto/fechado/total.
  const trackerMap = new Map();
  for (const i of issues) {
    const name = i.tracker?.name || '—';
    const rec = trackerMap.get(name) || { name, open: 0, closed: 0, total: 0 };
    rec.total++;
    if (isClosed(i)) rec.closed++;
    else rec.open++;
    trackerMap.set(name, rec);
  }
  const byTracker = [...trackerMap.values()].sort((a, b) => b.total - a.total);

  // Versões: progresso e risco (aberta e vencida).
  const statusRank = (s) => (s === 'closed' ? 2 : s === 'locked' ? 1 : 0);
  const versionAgg = versions
    .map((v) => {
      const vIssues = issues.filter((i) => i.fixed_version?.id === v.id);
      const vTotal = vIssues.length;
      const vClosed = vIssues.filter(isClosed).length;
      const vOpen = vTotal - vClosed;
      return {
        id: v.id,
        name: v.name,
        status: v.status,
        due_date: v.due_date || null,
        total: vTotal,
        closed: vClosed,
        open: vOpen,
        pct: vTotal ? Math.round((vClosed / vTotal) * 100) : 0,
        overdue: !!v.due_date && v.due_date < today && vOpen > 0,
      };
    })
    .sort((a, b) => {
      if (statusRank(a.status) !== statusRank(b.status))
        return statusRank(a.status) - statusRank(b.status);
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99');
    });

  // Refs das abertas para drill-down no client (filtra por status/tipo/prioridade/
  // responsável ao clicar num card). Limitado para não inflar o payload.
  const openList = openArr.slice(0, 500).map((i) => ({
    id: i.id,
    subject: i.subject,
    status: i.status?.name || '—',
    tracker: i.tracker?.name || '—',
    priority: i.priority?.name || '—',
    assignee: i.assigned_to?.name || 'Sem responsável',
  }));

  return {
    totals: { total, open: openArr.length, closed, completion },
    byStatus,
    byTracker,
    byPriority,
    byAssignee,
    versions: versionAgg,
    openList,
    capped: issues.length >= 2000,
  };
}

router.get(
  '/analytics/project',
  handle(async (req, res) => {
    const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
    if (!projectId) return res.status(400).json({ error: 'project_id obrigatório' });

    const redmine = makeRedmine(req);
    const now = new Date();

    // Todas as tarefas do projeto (abertas e fechadas).
    const issues = await fetchAllIssues(redmine, { status_id: '*', project_id: projectId });

    // Versões — best-effort (nem todo projeto tem).
    let versions = [];
    try {
      const { data } = await redmine.get(`/projects/${projectId}/versions.json`);
      versions = data.versions || [];
    } catch {
      /* sem versões */
    }

    const result = computeProject({ issues, versions, now });
    res.json({ ...result, project_id: projectId, generatedAt: Date.now() });
  }),
);

// Início da semana (segunda-feira) da data dada.
function weekStartMonday(d) {
  const x = new Date(d);
  const day = x.getDay();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day + (day === 0 ? -6 : 1));
  return x;
}

// DASHBOARD PESSOAL — agregação pura (testável). Desempenho do usuário ao longo
// do tempo: minhas abertas/em andamento/vencidas, concluídas na janela, throughput
// por semana, tempo de ciclo e cumprimento de prazo próprios. As listas de itens
// acompanham cada KPI para permitir o drill-down (cards clicáveis).
function computeMe({ myOpen, myClosed, now = new Date(), weeks = 8, days = 90 }) {
  const today = ymd(now);
  const ref = (i) => ({
    id: i.id,
    subject: i.subject,
    status: i.status?.name || '—',
    due_date: i.due_date || null,
  });

  const overdue = myOpen.filter((i) => i.due_date && i.due_date < today);
  const inProgress = myOpen.filter((i) =>
    (i.status?.name || '').toLowerCase().includes('andamento'),
  );

  // Throughput por semana (minhas fechadas por semana).
  const weekMap = new Map();
  for (const i of myClosed) {
    if (!i.closed_on) continue;
    const k = ymd(weekStartMonday(new Date(i.closed_on)));
    weekMap.set(k, (weekMap.get(k) || 0) + 1);
  }
  const weekBuckets = [];
  const thisMonday = weekStartMonday(now);
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - w * 7);
    const key = ymd(d);
    weekBuckets.push({ key, closed: weekMap.get(key) || 0 });
  }

  // Tempo de ciclo (criação → fechamento, em dias).
  const durations = myClosed
    .filter((i) => i.closed_on && i.created_on)
    .map((i) => Math.max(0, (Date.parse(i.closed_on) - Date.parse(i.created_on)) / DAY))
    .sort((a, b) => a - b);
  let cycle = { count: 0, avg: null, median: null };
  if (durations.length) {
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const mid = Math.floor(durations.length / 2);
    const median =
      durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
    cycle = { count: durations.length, avg: +avg.toFixed(1), median: +median.toFixed(1) };
  }

  // Cumprimento de prazo (minhas fechadas com prazo).
  const closedWithDue = myClosed.filter((i) => i.due_date && i.closed_on);
  let onTime = 0,
    late = 0,
    lateSum = 0;
  for (const i of closedWithDue) {
    const c = i.closed_on.slice(0, 10);
    if (c <= i.due_date) onTime++;
    else {
      late++;
      lateSum += Math.round((Date.parse(c) - Date.parse(i.due_date)) / DAY);
    }
  }
  const totalDelivered = onTime + late;

  const list = (arr) => arr.slice(0, 200).map(ref);
  return {
    weeks: weekBuckets,
    kpis: {
      open: { count: myOpen.length, issues: list(myOpen) },
      inProgress: { count: inProgress.length, issues: list(inProgress) },
      overdue: { count: overdue.length, issues: list(overdue) },
      completed: { count: myClosed.length, issues: list(myClosed) },
    },
    cycle,
    onTime: {
      closedWithDue: totalDelivered,
      onTime,
      late,
      rate: totalDelivered ? Math.round((onTime / totalDelivered) * 100) : null,
      avgLateDays: late ? +(lateSum / late).toFixed(1) : 0,
    },
    days,
    capped: myOpen.length >= 2000 || myClosed.length >= 2000,
  };
}

router.get(
  '/analytics/me',
  handle(async (req, res) => {
    const redmine = makeRedmine(req);
    const days = Math.min(365, Math.max(30, Number(req.query.days) || 90));
    const now = new Date();
    const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

    // Redmine aceita assigned_to_id=me — não precisa resolver o id do usuário.
    const myOpen = await fetchAllIssues(redmine, { status_id: 'open', assigned_to_id: 'me' });
    const myClosed = await fetchAllIssues(redmine, {
      status_id: 'closed',
      assigned_to_id: 'me',
      updated_on: `>=${since}`,
    });

    const result = computeMe({ myOpen, myClosed, now, days });
    res.json({ ...result, generatedAt: Date.now() });
  }),
);

module.exports = router;
module.exports.__testables = {
  computeTrends,
  windowStartOf,
  computeSla,
  ymd,
  computeProject,
  computeMe,
  weekStartMonday,
};
