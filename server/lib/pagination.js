// Utilitários de paginação e concorrência para a API do Redmine.

// Busca TODAS as páginas de um recurso paginado (genérico).
async function fetchAllPages(redmine, path, key, params, max = 2000) {
  const limit = 100;
  let offset = 0, all = [], total = Infinity;
  while (offset < total && all.length < max) {
    const { data } = await redmine.get(path, { params: { ...params, limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data[key] || []);
    if ((data[key] || []).length === 0) break;
    offset += limit;
  }
  return all;
}

// Roda `fn` sobre os itens com no máximo `limit` chamadas simultâneas.
// Usado para buscar detalhes (relations/journals) de várias issues sem
// estourar o Redmine com N requests paralelos.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Busca TODAS as páginas de issues para um conjunto de filtros (remove o teto de 100).
// Trava de segurança em 2000 para não varrer bases enormes sem querer.
async function fetchAllIssues(redmine, params) {
  const limit = 100;
  const MAX = 2000;
  let offset = 0, all = [], total = Infinity;
  while (offset < total && all.length < MAX) {
    const { data } = await redmine.get('/issues.json', { params: { ...params, limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data.issues || []);
    if ((data.issues || []).length === 0) break;
    offset += limit;
  }
  return all;
}

module.exports = { fetchAllPages, mapLimit, fetchAllIssues };
