// =========================================================================
// Integração com DokuWiki via HTTP (HTTPS/443) — XMLRPC bloqueado por ACL.
// Usa Basic Auth com as mesmas credenciais do AD (igual ao Zimbra/Redmine).
//
// Endpoints utilizados:
//   GET /doku.php?do=export_xhtmlbody&id=PAGE_ID  → HTML do conteúdo da página
//   GET /doku.php?do=search&q=QUERY               → HTML com resultados de busca
// =========================================================================
const axios = require('axios');
const { getMyUserId } = require('./lib/redmine');
const { getAd } = require('./services/secretsStore');

const DEFAULT_HOST = process.env.DOKUWIKI_HOST || 'wiki.redesoft.com.br';

let lastWikiCreds = { host: DEFAULT_HOST, user: '', pass: '' };

// Credenciais AD: no login usuário/senha vêm da sessão (x-redmine-*, injetadas
// pela authMiddleware); no login por API key, do cofre cifrado server-side.
async function resolveWikiCreds(req) {
  const host = req.headers['x-wiki-host'] || DEFAULT_HOST;
  let user = req.headers['x-redmine-user'] || '';
  let pass = req.headers['x-redmine-pass'] || '';
  if (!user || !pass) {
    try {
      const uid = await getMyUserId(req);
      const ad = uid ? getAd(uid) : null;
      if (ad) { user = ad.user; pass = ad.pass; }
    } catch { /* sem credenciais no cofre */ }
  }
  if (user && pass) lastWikiCreds = { host, user, pass };
  return { host, user, pass };
}

function getLastWikiCreds() { return lastWikiCreds; }

function basicAuth(user, pass) {
  if (!user || !pass) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

async function dokuGet(host, user, pass, path) {
  if (!user || !pass) throw Object.assign(new Error('credentials_required'), { code: 'WIKI_NO_CREDS' });
  const url = `https://${host}${path}`;
  const { data } = await axios.get(url, {
    headers: { ...basicAuth(user, pass) },
    timeout: 8000,
    maxRedirects: 3,
  });
  return data;
}

// --- Parsers HTML ---

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

// Extrai os resultados da página de busca do DokuWiki.
// Estrutura: <div class="search_fullpage_result"><dt><a data-wiki-id="...">TITLE</a></dt>
//            <dd class="meta">... <time datetime="ISO">...</time></dd>
//            <dd class="snippet">...TEXTO...</dd></div>
function parseSearchHTML(html) {
  const results = [];
  const blockRe = /<div class="search_fullpage_result">([\s\S]*?)<\/div>\s*(?:<div|<\/dl>)/g;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];

    const idMatch = block.match(/data-wiki-id="([^"]+)"/);
    const titleMatch = block.match(/data-wiki-id="[^"]+"[^>]*>(.*?)<\/a>/);
    const dtimeMatch = block.match(/<time datetime="([^"]+)"/);
    const snippetMatch = block.match(/<dd class="snippet">([\s\S]*?)<\/dd>/);

    if (!idMatch) continue;

    const id = idMatch[1];
    const title = titleMatch ? stripTags(titleMatch[1]) : id.split(':').pop()?.replace(/_/g, ' ') || id;
    const ns = id.includes(':') ? id.split(':').slice(0, -1).join(':') : '';
    const mtime = dtimeMatch ? Math.floor(new Date(dtimeMatch[1]).getTime() / 1000) : 0;
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).slice(0, 200) : '';

    results.push({ id, title, namespace: ns, snippet, mtime, score: 0 });
  }
  return results;
}

function decodeHtmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

// Reescreve links relativos para absolutos e imagens para o proxy local (auth necessária)
function rewriteLinks(html, host) {
  const base = `https://${host}`;
  return html
    .replace(/href="\/doku\.php\?([^"]+)"/g, `href="${base}/doku.php?$1" target="_blank" rel="noreferrer"`)
    .replace(/href="(\/[^"]+)"/g, `href="${base}$1" target="_blank" rel="noreferrer"`)
    .replace(/src="(\/[^"]+)"/g, (_, path) => {
      const mediaUrl = `https://${host}${decodeHtmlEntities(path)}`;
      return `src="/api/wiki/media?url=${encodeURIComponent(mediaUrl)}"`;
    });
}

// --- Operações públicas ---

async function searchPages(req, q) {
  const { host, user, pass } = await resolveWikiCreds(req);
  const html = await dokuGet(host, user, pass, `/doku.php?do=search&q=${encodeURIComponent(q)}`);
  return parseSearchHTML(html);
}

// Extrai o conteúdo real da página DokuWiki completa (inclui output de plugins como checkmarks).
// O template usa id="dokuwiki__content" para o conteúdo principal.
function extractPageContent(html) {
  // Localiza o div principal de conteúdo
  const contentIdx = html.indexOf('id="dokuwiki__content"');
  if (contentIdx === -1) return html;
  const tagEnd = html.indexOf('>', contentIdx) + 1;

  // Pula meta-boxes: DokuWiki usa <h1 class="sectionedit1"> como primeiro elemento real de conteúdo
  const firstSectionH1 = html.indexOf('<h1 class="sectionedit', tagEnd);
  const firstH1 = html.indexOf('<h1', tagEnd);
  const firstLevel = html.indexOf('<div class="level', tagEnd);
  const candidates = [firstSectionH1, firstH1, firstLevel].filter(n => n !== -1);
  const wikiStart = candidates.length ? Math.min(...candidates) : tagEnd;

  // Termina antes do footer ou do cookie banner (que aparece no final da área de conteúdo)
  const endMarkers = ['class="cookielaw-banner', 'class="page-footer"', 'id="dokuwiki__footer"'];
  let wikiEnd = html.length;
  for (const marker of endMarkers) {
    const idx = html.indexOf(marker, wikiStart);
    if (idx !== -1 && idx < wikiEnd) wikiEnd = idx;
  }
  // Recua até o '<' que abre a tag do marcador
  while (wikiEnd > wikiStart && html[wikiEnd] !== '<') wikiEnd--;

  return html.slice(wikiStart, wikiEnd).trim();
}

async function getPageHTML(req, id) {
  const { host, user, pass } = await resolveWikiCreds(req);
  // Página completa para incluir output de plugins (checkmarks, etc.)
  const raw = String(await dokuGet(host, user, pass, `/doku.php?id=${encodeURIComponent(id)}`) || '');
  const content = extractPageContent(raw);
  const sanitized = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  return rewriteLinks(sanitized, host);
}

module.exports = {
  DEFAULT_HOST,
  resolveWikiCreds,
  getLastWikiCreds,
  basicAuth,
  searchPages,
  getPageHTML,
};
