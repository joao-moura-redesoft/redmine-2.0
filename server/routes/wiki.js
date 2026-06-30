// DokuWiki — leitura e busca de páginas da wiki corporativa. Ver server/dokuwiki.js.
// Usa as mesmas credenciais do AD (x-redmine-user / x-redmine-pass).
const express = require('express');
const axios = require('axios');
const router = express.Router();
const doku = require('../dokuwiki');

// Busca full-text no DokuWiki (scraping do HTML de resultados).
router.get('/wiki/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ results: [] });
    res.json({ results: await doku.searchPages(req, q) });
  } catch (err) {
    if (err.code === 'WIKI_NO_CREDS')
      return res.status(401).json({ error: 'credentials_required' });
    console.error('[wiki/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Conteúdo HTML de uma página via export_xhtmlbody (links reescritos para absolutos).
router.get('/wiki/page', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const html = await doku.getPageHTML(req, id);
    res.json({ id, html });
  } catch (err) {
    if (err.code === 'WIKI_NO_CREDS')
      return res.status(401).json({ error: 'credentials_required' });
    console.error('[wiki/page]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Proxy de mídia (imagens) do DokuWiki — necessário pois o browser não envia Basic Auth em <img>.
router.get('/wiki/media', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    // Allowlist: só busca mídia do host configurado do DokuWiki (evita SSRF —
    // o cliente não controla mais o host, então é sempre o host corporativo).
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).end();
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== doku.DEFAULT_HOST) {
      return res.status(400).end();
    }
    // Credenciais resolvidas por-usuário a partir da sessão (a rota está atrás do
    // authMiddleware e o <img> same-origin carrega o cookie de sessão) — sem mais
    // a variável global lastWikiCreds, que vazaria credenciais entre usuários.
    const { user, pass } = await doku.resolveWikiCreds(req);
    const response = await axios.get(url, {
      headers: { ...doku.basicAuth(user, pass) },
      responseType: 'stream',
      timeout: 10000,
      maxRedirects: 0, // mídia é direta; não seguir redirect (anti-SSRF)
    });
    const ct = response.headers['content-type'] || 'image/png';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=3600');
    response.data.pipe(res);
  } catch (err) {
    console.error('[wiki/media]', err.message);
    res.status(404).end();
  }
});

module.exports = router;
