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

module.exports = router;
