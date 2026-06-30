const axios = require('axios');

const URL = process.env.REDMINE_URL || 'https://redmine.b2click.com';
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
  console.log('Teste 1: Apenas notes');
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: 'Teste 1.',
      },
    });
    console.log('Teste 1 sucesso:', res.status);
  } catch (err) {
    console.log('Teste 1 falhou:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\nTeste 2: notes + estimated_hours (numero)');
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: 'Teste 2.',
        estimated_hours: 26,
      },
    });
    console.log('Teste 2 sucesso:', res.status);
  } catch (err) {
    console.log('Teste 2 falhou:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\nTeste 3: notes + custom_fields YYYY-MM-DD');
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: 'Teste 3.',
        custom_fields: [{ id: 228, value: '2026-08-08' }],
      },
    });
    console.log('Teste 3 sucesso:', res.status);
  } catch (err) {
    console.log('Teste 3 falhou:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\nTeste 4: notes + custom_fields DD/MM/YYYY');
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: 'Teste 4.',
        custom_fields: [{ id: 228, value: '08/08/2026' }],
      },
    });
    console.log('Teste 4 sucesso:', res.status);
  } catch (err) {
    console.log('Teste 4 falhou:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\nTeste 5: tudo (notes + number + YYYY-MM-DD)');
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: '.',
        estimated_hours: 26,
        custom_fields: [{ id: 228, value: '2026-08-08' }],
      },
    });
    console.log('Teste 5 sucesso:', res.status);
  } catch (err) {
    console.log('Teste 5 falhou:', err.response?.status, err.response?.data || err.message);
  }
}

test();
