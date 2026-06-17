// Proxy de download de anexos do Redmine + preview de OpenGraph para links.
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { buildAuthHeaders } = require('../lib/redmine');
const { createSession, getSession } = require('../lib/sessions');
const handle = require('../lib/handle');

// Cria sessão de autenticação para o usuário atual. Retorna um token que
// deve ser incluído nas URLs de anexo como ?s=TOKEN.
router.post('/attachments/session', handle(async (req, res) => {
  const url = req.headers['x-redmine-url'];
  const key = req.headers['x-redmine-key'] || '';
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  if (!url || (!key && !(username && password))) {
    return res.status(400).json({ error: 'Credenciais ausentes' });
  }
  const token = createSession({ kind: 'redmine', url, key, username, password });
  res.json({ token });
}));

// OpenGraph metadata para preview de links no chat
router.get('/og', handle(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL inválida' });
  try {
    const { data: html } = await axios.get(url, {
      timeout: 6000,
      maxContentLength: 400 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlumineFetch/1.0)' },
      responseType: 'text',
    });
    const get = (prop) => {
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      return (html.match(re1) || html.match(re2))?.[1]?.trim() ?? '';
    };
    const title       = get('og:title') || get('twitter:title') || html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || '';
    const description = get('og:description') || get('twitter:description') || '';
    const image       = get('og:image') || get('twitter:image') || '';
    const siteName    = get('og:site_name') || new URL(url).hostname;
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ url, title: title.slice(0, 200), description: description.slice(0, 300), image, siteName });
  } catch {
    try { res.json({ url, title: '', description: '', image: '', siteName: new URL(url).hostname }); }
    catch { res.json({ url, title: '', description: '', image: '', siteName: '' }); }
  }
}));

// Proxy de download de anexo (imagens inline). Requests de <img> não enviam
// headers customizados — as credenciais são recuperadas via token de sessão (?s=TOKEN).
router.get('/attachments/:id/:filename', handle(async (req, res) => {
  const session = getSession(req.query.s, 'redmine');
  if (!session) return res.status(401).json({ error: 'Sessão inválida ou expirada. Recarregue a página.' });
  const { url, key, username, password } = session;
  const path = `/attachments/download/${req.params.id}/${encodeURIComponent(req.params.filename)}`;
  const upstream = await axios.get(`${url}${path}`, {
    headers: buildAuthHeaders(key, username, password),
    responseType: 'arraybuffer',
  });
  res.set('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(upstream.data));
}));

module.exports = router;
