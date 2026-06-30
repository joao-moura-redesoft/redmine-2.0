const axios = require('axios');

const URL = (process.env.REDMINE_URL || 'https://redmine.b2click.com').replace(/\/?$/, '/'); // TRAILING SLASH
const KEY = process.env.REDMINE_API_KEY;
if (!KEY) {
  console.error('Defina REDMINE_API_KEY no ambiente.');
  process.exit(1);
}
const ISSUE_ID = Number(process.env.REDMINE_ISSUE_ID) || 89521;

const api = axios.create({
  baseURL: URL,
  headers: {
    'X-Redmine-API-Key': KEY,
    'Content-Type': 'application/json',
  },
});

async function test() {
  console.log('\nTeste trailing slash: tudo (notes + number + YYYY-MM-DD)');
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: '.',
        estimated_hours: 26,
        custom_fields: [{ id: 228, value: '2026-08-08' }],
      },
    });
    console.log('Teste trailing slash sucesso:', res.status);
  } catch (err) {
    console.log(
      'Teste trailing slash falhou:',
      err.response?.status,
      err.response?.data || err.message,
    );
  }
}

test();
