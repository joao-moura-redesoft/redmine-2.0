// Nextcloud Files (Drive) — navegação e gestão de arquivos via WebDAV/OCS,
// reaproveitando a mesma autenticação do Talk (headers x-nextcloud-*).
const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const router = express.Router();
const handle = require('../lib/handle');
const { makeTalk } = require('../services/talk');

const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false });

// Id canônico do usuário no Nextcloud (necessário para os caminhos /dav/files/{id}
// e /trashbin/{id} — pode diferir do login, ex.: backends que usam UUID).
async function ncUserId(req) {
  try {
    const { data } = await makeTalk(req).get('/ocs/v2.php/cloud/user?format=json');
    return data?.ocs?.data?.id || req.headers['x-nextcloud-user'];
  } catch { return req.headers['x-nextcloud-user']; }
}

// Caminho relativo (vindo do cliente) → URL WebDAV do usuário logado.
function davUrl(relPath) {
  const clean = String(relPath || '').replace(/^\/+|\/+$/g, '');
  const enc = clean ? clean.split('/').map(encodeURIComponent).join('/') : '';
  return `/remote.php/webdav/${enc}`;
}

// Remove o prefixo do WebDAV/DAV de um href e devolve o caminho relativo (decodificado).
// Cobre tanto /remote.php/webdav/ (legado) quanto /remote.php/dav/files/{user}/ (SEARCH).
function relFromHref(href) {
  let p = decodeURIComponent(href || '').replace(/^https?:\/\/[^/]+/, '');
  const m = p.match(/\/remote\.php\/(?:webdav|dav\/files\/[^/]+)\//);
  if (m) p = p.slice(m.index + m[0].length);
  return p.replace(/^\/+|\/+$/g, '');
}

// Converte um <response> do multistatus em um item do Drive.
function entryFromResponse(r) {
  const rel = relFromHref(r.href);
  const stats = [].concat(r.propstat ?? []);
  const prop = (stats.find(s => /200/.test(s.status || '')) ?? stats[0])?.prop ?? {};
  const isDir = prop.resourcetype != null && typeof prop.resourcetype === 'object' && 'collection' in prop.resourcetype;
  return {
    rel,
    entry: {
      name: rel.split('/').pop() || rel,
      path: rel,
      isDir,
      size: Number(prop.size ?? prop.getcontentlength ?? 0) || 0,
      mtime: prop.getlastmodified ? Math.floor(Date.parse(prop.getlastmodified) / 1000) : 0,
      mime: isDir ? '' : (prop.getcontenttype || ''),
      etag: String(prop.getetag || '').replace(/"/g, ''),
      fileId: prop.fileid != null ? String(prop.fileid) : undefined,
      hasPreview: String(prop['has-preview']) === 'true',
      favorite: String(prop.favorite) === '1',
    },
  };
}

const DAV_PROPS = `<d:getlastmodified/><d:getcontentlength/><d:getcontenttype/><d:resourcetype/><d:getetag/><oc:fileid/><oc:size/><nc:has-preview/><oc:favorite/>`;

const PROPFIND_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:prop>
  <d:getlastmodified/><d:getcontentlength/><d:getcontenttype/>
  <d:resourcetype/><d:getetag/><oc:fileid/><oc:size/><nc:has-preview/><oc:favorite/>
 </d:prop>
</d:propfind>`;

// ─── Listar pasta ──────────────────────────────────────────────────────────────
router.get('/drive/list', handle(async (req, res) => {
  const reqPath = String(req.query.path || '').replace(/^\/+|\/+$/g, '');
  const talk = makeTalk(req);
  const { data } = await talk.request({
    method: 'PROPFIND',
    url: davUrl(reqPath),
    data: PROPFIND_BODY,
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    responseType: 'text',
    transformResponse: r => r,
  });

  const doc = xml.parse(data);
  const responses = [].concat(doc?.multistatus?.response ?? []);
  const entries = [];
  for (const r of responses) {
    const { rel, entry } = entryFromResponse(r);
    if (rel === reqPath) continue; // a própria pasta
    entries.push(entry);
  }
  res.json({ path: reqPath, entries });
}));

// ─── Busca global recursiva (WebDAV SEARCH em todo o Drive do usuário) ──────────
router.get('/drive/search', handle(async (req, res) => {
  const term = String(req.query.q || '').trim().replace(/[%\\]/g, '');
  if (term.length < 2) return res.json([]);
  const user = await ncUserId(req);
  const body = `<?xml version="1.0"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:basicsearch>
  <d:select><d:prop>${DAV_PROPS}</d:prop></d:select>
  <d:from><d:scope><d:href>/files/${user}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
  <d:where><d:like><d:prop><d:displayname/></d:prop><d:literal>%${term}%</d:literal></d:like></d:where>
  <d:limit><d:nresults>200</d:nresults></d:limit>
 </d:basicsearch>
</d:searchrequest>`;
  try {
    const { data } = await makeTalk(req).request({
      method: 'SEARCH', url: '/remote.php/dav/', data: body,
      headers: { 'Content-Type': 'application/xml' },
      responseType: 'text', transformResponse: r => r,
    });
    const doc = xml.parse(data);
    const responses = [].concat(doc?.multistatus?.response ?? []);
    const entries = responses.map(entryFromResponse).map(x => x.entry).filter(e => e.path);
    res.json(entries);
  } catch (e) {
    if (e.response?.status === 404 || e.response?.status === 501) return res.json([]);
    throw e;
  }
}));

// ─── Quota ───────────────────────────────────────────────────────────────────
router.get('/drive/quota', handle(async (req, res) => {
  try {
    const talk = makeTalk(req);
    const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>`;
    const { data } = await talk.request({
      method: 'PROPFIND', url: davUrl(''), data: body,
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      responseType: 'text', transformResponse: r => r,
    });
    const doc = xml.parse(data);
    const prop = [].concat(doc?.multistatus?.response ?? [])[0]?.propstat;
    const p = ([].concat(prop ?? []).find(s => /200/.test(s.status || '')) ?? {}).prop ?? {};
    const used = Number(p['quota-used-bytes'] ?? 0) || 0;
    const avail = Number(p['quota-available-bytes'] ?? -1);
    res.json({ used, available: avail });
  } catch { res.json({ used: 0, available: -1 }); }
}));

// ─── Download (attachment) ──────────────────────────────────────────────────────
router.get('/drive/download', handle(async (req, res) => {
  const reqPath = String(req.query.path || '');
  const name = reqPath.split('/').pop() || 'arquivo';
  const talk = makeTalk(req);
  const r = await talk.get(davUrl(reqPath), { responseType: 'arraybuffer' });
  res.set('Content-Type', r.headers['content-type'] || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(Buffer.from(r.data));
}));

// ─── Thumbnail ──────────────────────────────────────────────────────────────────
router.get('/drive/thumb', handle(async (req, res) => {
  const { fileId, path: filePath } = req.query;
  const talk = makeTalk(req);
  const size = Math.min(parseInt(req.query.size) || 128, 1024);
  const tryGet = async (url) => {
    try {
      const r = await talk.get(url, { responseType: 'arraybuffer' });
      const ct = String(r.headers['content-type'] || '');
      if (r.data?.byteLength > 64 && !ct.includes('text/html') && !ct.includes('application/json')) {
        return { data: r.data, ct: ct || 'image/jpeg' };
      }
    } catch {}
    return null;
  };
  // Só imagens podem usar o próprio arquivo como miniatura (fallback).
  const isImg = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(filePath || '');
  const result =
    (fileId && await tryGet(`/index.php/core/preview?fileId=${encodeURIComponent(fileId)}&x=${size}&y=${size}&a=0&forceIcon=0`)) ||
    (filePath && await tryGet(`/index.php/core/preview.png?file=${encodeURIComponent(filePath)}&x=${size}&y=${size}&a=0`)) ||
    // Fallback p/ servidores com gerador de preview desativado: baixa a imagem real.
    (isImg && filePath && await tryGet(davUrl(filePath)));
  if (!result) return res.status(404).end();
  res.set('Content-Type', result.ct);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(result.data));
}));

// ─── Upload (PUT) ────────────────────────────────────────────────────────────────
router.put('/drive/upload',
  express.raw({ type: '*/*', limit: '500mb' }),
  handle(async (req, res) => {
    const dir = String(req.query.path || '').replace(/^\/+|\/+$/g, '');
    const filename = decodeURIComponent(req.headers['x-filename'] || `upload_${Date.now()}`);
    const ct = req.headers['x-content-type'] || 'application/octet-stream';
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!body.length) return res.status(400).json({ error: 'Arquivo vazio.' });
    const full = dir ? `${dir}/${filename}` : filename;
    await makeTalk(req).put(davUrl(full), body, {
      headers: { 'Content-Type': ct, 'Content-Length': body.length },
      maxBodyLength: 500 * 1024 * 1024, maxContentLength: 500 * 1024 * 1024,
    });
    res.json({ success: true, path: full });
  })
);

// ─── Nova pasta (MKCOL) ───────────────────────────────────────────────────────────
router.post('/drive/folder', handle(async (req, res) => {
  const p = String(req.body.path || '').replace(/^\/+|\/+$/g, '');
  if (!p) return res.status(400).json({ error: 'Caminho obrigatório.' });
  await makeTalk(req).request({ method: 'MKCOL', url: davUrl(p) });
  res.json({ success: true, path: p });
}));

// ─── Excluir (vai para a lixeira do Nextcloud) ─────────────────────────────────────
router.delete('/drive/item', handle(async (req, res) => {
  const p = String(req.query.path || '').replace(/^\/+|\/+$/g, '');
  if (!p) return res.status(400).json({ error: 'Caminho obrigatório.' });
  await makeTalk(req).delete(davUrl(p));
  res.json({ success: true });
}));

// ─── Mover / renomear (MOVE) ───────────────────────────────────────────────────────
router.post('/drive/move', handle(async (req, res) => {
  const from = String(req.body.from || '').replace(/^\/+|\/+$/g, '');
  const to = String(req.body.to || '').replace(/^\/+|\/+$/g, '');
  if (!from || !to) return res.status(400).json({ error: 'from e to obrigatórios.' });
  const ncUrl = (req.headers['x-nextcloud-url'] || '').replace(/\/$/, '');
  await makeTalk(req).request({
    method: 'MOVE', url: davUrl(from),
    headers: { Destination: `${ncUrl}${davUrl(to)}`, Overwrite: 'F' },
  });
  res.json({ success: true, path: to });
}));

// ─── Visões inteligentes (Favoritos, Recentes, Compartilhados) ─────────────────

// Favoritos — REPORT oc:filter-files com favorite=1
router.get('/drive/favorites', handle(async (req, res) => {
  const user = await ncUserId(req);
  const body = `<?xml version="1.0"?>
<oc:filter-files xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:prop>${DAV_PROPS}</d:prop>
 <oc:filter-rules><oc:favorite>1</oc:favorite></oc:filter-rules>
</oc:filter-files>`;
  try {
    const { data } = await makeTalk(req).request({
      method: 'REPORT', url: `/remote.php/dav/files/${encodeURIComponent(user)}/`, data: body,
      headers: { Depth: 'infinity', 'Content-Type': 'application/xml' },
      responseType: 'text', transformResponse: r => r,
    });
    const doc = xml.parse(data);
    const entries = [].concat(doc?.multistatus?.response ?? []).map(entryFromResponse).map(x => x.entry).filter(e => e.path);
    res.json(entries);
  } catch (e) { if (e.response?.status === 404) return res.json([]); throw e; }
}));

// Recentes — SEARCH ordenado por data de modificação (desc). Faz fallback sem
// orderby (alguns servidores não suportam) e ordena no Node.
router.get('/drive/recent', handle(async (req, res) => {
  const user = await ncUserId(req);
  const buildBody = (withOrder) => `<?xml version="1.0"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:basicsearch>
  <d:select><d:prop>${DAV_PROPS}</d:prop></d:select>
  <d:from><d:scope><d:href>/files/${user}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
  <d:where><d:like><d:prop><d:displayname/></d:prop><d:literal>%</d:literal></d:like></d:where>
  ${withOrder ? '<d:orderby><d:order><d:prop><d:getlastmodified/></d:prop><d:descending/></d:order></d:orderby>' : ''}
  <d:limit><d:nresults>200</d:nresults></d:limit>
 </d:basicsearch>
</d:searchrequest>`;
  const run = async (withOrder) => {
    const { data } = await makeTalk(req).request({
      method: 'SEARCH', url: '/remote.php/dav/', data: buildBody(withOrder),
      headers: { 'Content-Type': 'application/xml' }, responseType: 'text', transformResponse: r => r,
    });
    return [].concat(xml.parse(data)?.multistatus?.response ?? []).map(entryFromResponse).map(x => x.entry).filter(e => e.path && !e.isDir);
  };
  try {
    let entries;
    try { entries = await run(true); }
    catch { entries = await run(false); } // servidor pode não aceitar orderby
    entries.sort((a, b) => b.mtime - a.mtime);
    res.json(entries.slice(0, 100));
  } catch (e) {
    if (e.response?.status === 404 || e.response?.status === 501) return res.json([]);
    throw e;
  }
}));

// Compartilhados — type: in (comigo) | out (por mim) | link (meus links)
router.get('/drive/shared-view', handle(async (req, res) => {
  const type = req.query.type || 'in';
  const params = { format: 'json' };
  if (type === 'in') params.shared_with_me = 'true';
  try {
    const { data } = await makeTalk(req).get(`/ocs/v2.php/apps/files_sharing/api/v1/shares`, { params });
    let list = data?.ocs?.data ?? [];
    if (type === 'link') list = list.filter(s => s.share_type === 3);
    if (type === 'out') list = list.filter(s => s.share_type !== 3 || true); // todos os meus shares
    // Deduplica por caminho e mapeia para o formato de item do Drive.
    const seen = new Set();
    const entries = [];
    for (const s of list) {
      const rel = String(s.file_target || s.path || '').replace(/^\/+|\/+$/g, '');
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      const isDir = s.item_type === 'folder' || s.mimetype === 'httpd/unix-directory';
      entries.push({
        name: rel.split('/').pop() || rel,
        path: rel, isDir,
        size: Number(s.item_size ?? 0) || 0,
        mtime: Number(s.stime ?? 0) || 0,
        mime: isDir ? '' : (s.mimetype || ''),
        etag: '', fileId: s.file_source != null ? String(s.file_source) : undefined,
        hasPreview: false, favorite: false,
        sharedWith: s.share_with_displayname || s.share_with || '',
        sharedBy: s.displayname_owner || s.uid_owner || '',
        shareUrl: s.url || '',
      });
    }
    res.json(entries);
  } catch (e) { if (e.response?.status === 404) return res.json([]); throw e; }
}));

// Marcar/desmarcar favorito (PROPPATCH oc:favorite)
router.post('/drive/favorite', handle(async (req, res) => {
  const p = String(req.body.path || '').replace(/^\/+|\/+$/g, '');
  const fav = req.body.favorite ? 1 : 0;
  const user = await ncUserId(req);
  const enc = p.split('/').map(encodeURIComponent).join('/');
  const body = `<?xml version="1.0"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
 <d:set><d:prop><oc:favorite>${fav}</oc:favorite></d:prop></d:set>
</d:propertyupdate>`;
  await makeTalk(req).request({
    method: 'PROPPATCH', url: `/remote.php/dav/files/${encodeURIComponent(user)}/${enc}`,
    data: body, headers: { 'Content-Type': 'application/xml' },
  });
  res.json({ success: true });
}));

// ─── Compartilhamento (OCS files_sharing) ─────────────────────────────────────
const SHARES = '/ocs/v2.php/apps/files_sharing/api/v1/shares';
const ocsPath = (p) => '/' + String(p || '').replace(/^\/+/, '');

// Lista compartilhamentos de um caminho
router.get('/drive/shares', handle(async (req, res) => {
  try {
    const { data } = await makeTalk(req).get(`${SHARES}?format=json`, {
      params: { path: ocsPath(req.query.path), reshares: false },
    });
    res.json(data?.ocs?.data ?? []);
  } catch (e) {
    if (e.response?.status === 404) return res.json([]);
    throw e;
  }
}));

// Cria compartilhamento. shareType 3 = link público; 0 = usuário (shareWith).
router.post('/drive/share', handle(async (req, res) => {
  const body = { path: ocsPath(req.body.path), shareType: req.body.shareType };
  if (req.body.shareWith) body.shareWith = req.body.shareWith;
  try {
    const { data } = await makeTalk(req).post(`${SHARES}?format=json`, body);
    res.json(data?.ocs?.data ?? {});
  } catch (e) {
    const msg = e.response?.data?.ocs?.meta?.message || e.message;
    res.status(e.response?.status || 500).json({ error: msg });
  }
}));

// Remove compartilhamento por id
router.delete('/drive/share/:id', handle(async (req, res) => {
  await makeTalk(req).delete(`${SHARES}/${req.params.id}?format=json`);
  res.json({ success: true });
}));

// ─── Copiar (COPY) ──────────────────────────────────────────────────────────────
router.post('/drive/copy', handle(async (req, res) => {
  const from = String(req.body.from || '').replace(/^\/+|\/+$/g, '');
  const to = String(req.body.to || '').replace(/^\/+|\/+$/g, '');
  if (!from || !to) return res.status(400).json({ error: 'from e to obrigatórios.' });
  const ncUrl = (req.headers['x-nextcloud-url'] || '').replace(/\/$/, '');
  await makeTalk(req).request({
    method: 'COPY', url: davUrl(from),
    headers: { Destination: `${ncUrl}${davUrl(to)}`, Overwrite: 'F' },
  });
  res.json({ success: true, path: to });
}));

// ─── Lixeira (trashbin DAV) ───────────────────────────────────────────────────────
const trashBase = (user) => `/remote.php/dav/trashbin/${encodeURIComponent(user)}/trash`;
const TRASH_PROPFIND = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns" xmlns:oc="http://owncloud.org/ns">
 <d:prop>
  <nc:trashbin-filename/><nc:trashbin-original-location/><nc:trashbin-deletion-time/>
  <d:getcontentlength/><d:getcontenttype/><d:resourcetype/><oc:size/>
 </d:prop>
</d:propfind>`;

router.get('/drive/trash', handle(async (req, res) => {
  const user = await ncUserId(req);
  try {
    const { data } = await makeTalk(req).request({
      method: 'PROPFIND', url: trashBase(user), data: TRASH_PROPFIND,
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      responseType: 'text', transformResponse: r => r,
    });
    const doc = xml.parse(data);
    const responses = [].concat(doc?.multistatus?.response ?? []);
    const items = [];
    for (const r of responses) {
      const href = r.href || '';
      if (href.replace(/\/+$/, '').endsWith('/trash')) continue; // a própria pasta
      const stats = [].concat(r.propstat ?? []);
      const prop = (stats.find(s => /200/.test(s.status || '')) ?? stats[0])?.prop ?? {};
      const isDir = prop.resourcetype != null && typeof prop.resourcetype === 'object' && 'collection' in prop.resourcetype;
      items.push({
        href: decodeURIComponent(href),
        name: prop['trashbin-filename'] || decodeURIComponent(href.split('/').filter(Boolean).pop() || ''),
        originalLocation: prop['trashbin-original-location'] || '',
        deletedAt: prop['trashbin-deletion-time'] ? Number(prop['trashbin-deletion-time']) : 0,
        isDir,
        size: Number(prop.size ?? prop.getcontentlength ?? 0) || 0,
        mime: isDir ? '' : (prop.getcontenttype || ''),
      });
    }
    items.sort((a, b) => b.deletedAt - a.deletedAt);
    res.json(items);
  } catch (e) {
    if (e.response?.status === 404) return res.json([]);
    throw e;
  }
}));

// Restaura um item (MOVE trash → restore)
router.post('/drive/trash/restore', handle(async (req, res) => {
  const user = await ncUserId(req);
  const href = String(req.body.href || '');
  const id = href.split('/').filter(Boolean).pop();
  if (!id) return res.status(400).json({ error: 'href obrigatório.' });
  const ncUrl = (req.headers['x-nextcloud-url'] || '').replace(/\/$/, '');
  await makeTalk(req).request({
    method: 'MOVE', url: `/remote.php/dav/trashbin/${encodeURIComponent(user)}/trash/${encodeURIComponent(id)}`,
    headers: { Destination: `${ncUrl}/remote.php/dav/trashbin/${encodeURIComponent(user)}/restore/${encodeURIComponent(id)}` },
  });
  res.json({ success: true });
}));

// Exclui um item da lixeira permanentemente
router.delete('/drive/trash/item', handle(async (req, res) => {
  const user = await ncUserId(req);
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id obrigatório.' });
  await makeTalk(req).delete(`/remote.php/dav/trashbin/${encodeURIComponent(user)}/trash/${encodeURIComponent(id)}`);
  res.json({ success: true });
}));

// Esvazia a lixeira
router.delete('/drive/trash', handle(async (req, res) => {
  const user = await ncUserId(req);
  await makeTalk(req).delete(trashBase(user));
  res.json({ success: true });
}));

module.exports = router;
