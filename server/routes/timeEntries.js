// Rotas de lançamento de horas (time entries) e atividades.
const express = require('express');
const router = express.Router();
const { makeRedmine } = require('../lib/redmine');
const handle = require('../lib/handle');
const { fetchAllPages } = require('../lib/pagination');

// Time entries (minhas horas apontadas)
router.get('/time_entries', handle(async (req, res) => {
  const { from, to, issue_id, limit = 100 } = req.query;
  const params = { user_id: 'me', limit };
  if (from) params.from = from;
  if (to) params.to = to;
  if (issue_id) params.issue_id = issue_id;
  const entries = await fetchAllPages(makeRedmine(req), '/time_entries.json', 'time_entries', params, 500);
  res.json({ time_entries: entries, total_count: entries.length });
}));

router.post('/time_entries', handle(async (req, res) => {
  const { data } = await makeRedmine(req).post('/time_entries.json', req.body);
  res.json(data);
}));

// Atividades de time entries
router.get('/enumerations/time_entry_activities', handle(async (req, res) => {
  const { data } = await makeRedmine(req).get('/enumerations/time_entry_activities.json');
  res.json(data);
}));

module.exports = router;
