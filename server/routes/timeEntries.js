// Rotas de lançamento de horas (time entries) e atividades.
const express = require('express');
const router = express.Router();
const { makeRedmine } = require('../lib/redmine');
const handle = require('../lib/handle');
const { fetchAllPages } = require('../lib/pagination');
const { toLatin1Safe } = require('../lib/latin1');

// Guarda latin1: o banco do Redmine rejeita (500) caracteres > U+00FF.
function sanitizeEntryBody(body) {
  const entry = body && body.time_entry;
  if (entry && typeof entry.comments === 'string') entry.comments = toLatin1Safe(entry.comments);
  return body;
}

// Time entries (minhas horas apontadas)
router.get(
  '/time_entries',
  handle(async (req, res) => {
    const { from, to, issue_id, limit = 100 } = req.query;
    const params = { user_id: 'me', limit };
    if (from) params.from = from;
    if (to) params.to = to;
    if (issue_id) params.issue_id = issue_id;
    const entries = await fetchAllPages(
      makeRedmine(req),
      '/time_entries.json',
      'time_entries',
      params,
      500,
    );
    res.json({ time_entries: entries, total_count: entries.length });
  }),
);

router.post(
  '/time_entries',
  handle(async (req, res) => {
    sanitizeEntryBody(req.body);
    const { data } = await makeRedmine(req).post('/time_entries.json', req.body);
    res.json(data);
  }),
);

// O Redmine responde 204 sem corpo no PUT; devolvemos a entrada atualizada para
// o cliente não precisar de um refetch só para reexibir o que acabou de salvar.
router.put(
  '/time_entries/:id',
  handle(async (req, res) => {
    sanitizeEntryBody(req.body);
    const redmine = makeRedmine(req);
    await redmine.put(`/time_entries/${req.params.id}.json`, req.body);
    const { data } = await redmine.get(`/time_entries/${req.params.id}.json`);
    res.json(data);
  }),
);

router.delete(
  '/time_entries/:id',
  handle(async (req, res) => {
    await makeRedmine(req).delete(`/time_entries/${req.params.id}.json`);
    res.json({ success: true });
  }),
);

// Atividades de time entries
router.get(
  '/enumerations/time_entry_activities',
  handle(async (req, res) => {
    const { data } = await makeRedmine(req).get('/enumerations/time_entry_activities.json');
    res.json(data);
  }),
);

module.exports = router;
