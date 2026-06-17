// Nextcloud Login Flow v2 + proxy do Nextcloud Talk (mensagens, salas, reações,
// uploads, SSE em tempo real).
const express = require('express');
const axios = require('axios');
const router = express.Router();
const handle = require('../lib/handle');
const { makeTalk } = require('../services/talk');

// =========================================================================
// NEXTCLOUD LOGIN FLOW v2
// =========================================================================

router.post('/talk/login-flow/init', handle(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const base = url.replace(/\/$/, '');
  const { data } = await axios.post(`${base}/index.php/login/v2`);
  res.json({ loginUrl: data.login, pollEndpoint: data.poll.endpoint, pollToken: data.poll.token });
}));

router.post('/talk/login-flow/poll', handle(async (req, res) => {
  const { pollEndpoint, pollToken } = req.body;
  if (!pollEndpoint || !pollToken) return res.status(400).json({ error: 'missing params' });
  try {
    const { data } = await axios.post(
      pollEndpoint,
      `token=${encodeURIComponent(pollToken)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    res.json({ done: true, server: data.server, user: data.loginName, token: data.appPassword });
  } catch (e) {
    // 404 = ainda aguardando o usuário fazer login
    if (e.response?.status === 404) return res.json({ done: false });
    throw e;
  }
}));

// =========================================================================
// NEXTCLOUD TALK PROXY
// =========================================================================

router.get('/talk/avatar/:userId', handle(async (req, res) => {
  const size = parseInt(req.query.size) || 40;
  const response = await makeTalk(req).get(
    `/index.php/avatar/${encodeURIComponent(req.params.userId)}/${size}`,
    { responseType: 'arraybuffer' }
  );
  res.set('Content-Type', response.headers['content-type'] || 'image/png');
  res.set('Cache-Control', 'public, max-age=1800');
  res.send(response.data);
}));

router.get('/talk/me', handle(async (req, res) => {
  const { data } = await makeTalk(req).get('/ocs/v2.php/cloud/user?format=json');
  res.json({ id: data.ocs.data.id, displayName: data.ocs.data.display_name });
}));

router.get('/talk/rooms', handle(async (req, res) => {
  const { data } = await makeTalk(req).get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
  res.json(data.ocs.data);
}));

router.get('/talk/rooms/:token/messages', handle(async (req, res) => {
  const params = { limit: 50, lookIntoFuture: 0 };
  // Sem cursor = busca as 50 mais recentes usando um ID alto como âncora.
  // Sem isso, algumas versões do Talk retornam as mensagens mais ANTIGAS primeiro.
  params.lastKnownMessageId = req.query.lastKnownMessageId || 2147483647;
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}?format=json`,
    { params }
  );
  res.json(data.ocs.data);
}));

router.post('/talk/rooms/:token/messages', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}?format=json`,
    req.body
  );
  res.json(data.ocs.data);
}));

router.post('/talk/rooms/:token/upload',
  express.raw({ type: '*/*', limit: '100mb' }),
  handle(async (req, res) => {
    const user     = req.headers['x-nextcloud-user'];
    const filename = decodeURIComponent(req.headers['x-filename'] || `upload_${Date.now()}`);
    const ct       = req.headers['x-content-type'] || 'application/octet-stream';
    const caption  = req.headers['x-caption'] ? decodeURIComponent(req.headers['x-caption']) : '';
    const { token } = req.params;
    const talk = makeTalk(req);

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!body.length) {
      return res.status(400).json({ error: 'Arquivo vazio — tente novamente.' });
    }

    const OCS_TIMEOUT = 8000;
    const ncUrl = req.headers['x-nextcloud-url'];
    const putOpts = {
      headers: { 'Content-Type': ct, 'Content-Length': body.length },
      maxBodyLength: 100 * 1024 * 1024,
      maxContentLength: 100 * 1024 * 1024,
    };

    // Subpasta única dentro de /Talk: evita conflito de nome (clipboard manda sempre
    // "image.png") e mantém o filename limpo na exibição do chat.
    const subdir = `Talk/talk_${Date.now()}`;
    try { await talk.request({ method: 'MKCOL', url: `/remote.php/webdav/Talk` }); } catch {}
    try { await talk.request({ method: 'MKCOL', url: `/remote.php/webdav/${subdir}` }); } catch {}
    await talk.put(`/remote.php/webdav/${subdir}/${encodeURIComponent(filename)}`, body, putOpts);

    // shareType 10 = Talk room (inline) — sempre a opção preferida.
    // caption vai como talkMetaData (legenda da imagem/arquivo).
    const shareToRoom = async (filePath) => {
      try {
        const shareBody = { shareType: 10, shareWith: token, path: filePath };
        if (caption) shareBody.talkMetaData = JSON.stringify({ caption });
        await talk.post(
          '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
          shareBody,
          { timeout: OCS_TIMEOUT }
        );
        return { method: 'share' };
      } catch { return null; }
    };

    // shareType 3 = link público — só usado se o inline estiver indisponível.
    const sharePublic = async (filePath) => {
      try {
        const { data: pd } = await talk.post(
          '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
          { shareType: 3, path: filePath },
          { timeout: OCS_TIMEOUT }
        );
        const url = pd?.ocs?.data?.url;
        if (url) {
          const msg = caption ? `${caption}\n📎 ${filename}\n${url}` : `📎 ${filename}\n${url}`;
          await talk.post(`/ocs/v2.php/apps/spreed/api/v1/chat/${token}?format=json`,
            { message: msg }, { timeout: OCS_TIMEOUT });
          return { method: 'public-link' };
        }
      } catch {}
      return null;
    };

    // 1. Inline a partir da subpasta /Talk
    const r1 = await shareToRoom(`/${subdir}/${filename}`);
    if (r1) return res.json({ success: true, ...r1 });

    // 2. Inline a partir da raiz (contorna restrições de share na pasta Talk)
    const rootName = `talk_${Date.now()}_${filename}`;
    try {
      await talk.put(`/remote.php/webdav/${encodeURIComponent(rootName)}`, body, putOpts);
      const r2 = await shareToRoom(`/${rootName}`);
      if (r2) return res.json({ success: true, ...r2 });
      // 3. Link público como último recurso (shareType 10 indisponível)
      const r3 = await sharePublic(`/${rootName}`);
      if (r3) return res.json({ success: true, ...r3 });
    } catch {}

    // 4. Compartilhamento não disponível — informa com clareza
    res.status(200).json({
      success: false,
      method: 'none',
      error: `Arquivo enviado (${subdir}/${filename}), mas o compartilhamento está desativado para este usuário. Peça ao admin do Nextcloud para habilitar. Acesse: ${ncUrl}/apps/files`,
      uploadedPath: `${subdir}/${filename}`,
    });
  })
);

router.post('/talk/rooms/:token/read', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/read?format=json`,
    req.body
  );
  res.json(data.ocs.meta);
}));

router.get('/talk/rooms/:token/participants', handle(async (req, res) => {
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/participants?format=json`
  );
  res.json(data.ocs.data);
}));

router.get('/talk/file-preview', handle(async (req, res) => {
  const { fileId, path: filePath, actorId } = req.query;
  const user = req.headers['x-nextcloud-user'];
  const talk = makeTalk(req);
  const ext = (filePath || '').split('.').pop()?.toLowerCase() || 'jpg';
  const fallbackCt = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const tryDownload = async (url, useAuth = true) => {
    try {
      const client = useAuth ? talk : axios;
      const r = await client.get(url, { responseType: 'arraybuffer', maxRedirects: 5 });
      const ct = String(r.headers['content-type'] || '');
      if (r.data?.byteLength > 100 && !ct.includes('text/html') && !ct.includes('application/json')) {
        return { data: r.data, ct: ct || fallbackCt };
      }
    } catch {}
    return null;
  };

  // 1. OCS Direct Download — URL temporária sem auth, funciona para qualquer
  //    arquivo acessível ao usuário (inclusive compartilhamentos do Talk)
  try {
    const { data: ocsData } = await talk.post(
      `/ocs/v2.php/apps/dav/api/v1/direct?format=json`,
      { fileId: parseInt(fileId) }
    );
    const directUrl = ocsData?.ocs?.data?.url;
    if (directUrl) {
      const result = await tryDownload(directUrl, false);
      if (result) {
        res.set('Content-Type', result.ct);
        res.set('Cache-Control', 'private, max-age=300');
        return res.send(result.data);
      }
    }
  } catch {}

  const result =
    // 2. webdav relativo (sem precisar do principal name) — funciona para o usuário logado
    (filePath && await tryDownload(`/remote.php/webdav/${filePath}`)) ||
    // 3. WebDAV explícito do usuário logado
    (filePath && await tryDownload(`/remote.php/dav/files/${encodeURIComponent(user)}/${filePath}`)) ||
    // 4. WebDAV do remetente (se houver permissão de share)
    (actorId && actorId !== user && filePath && await tryDownload(`/remote.php/dav/files/${encodeURIComponent(actorId)}/${filePath}`)) ||
    // 5. Preview thumbnail como último recurso
    (fileId && await tryDownload(`/index.php/core/preview?fileId=${fileId}&x=800&y=800&a=true`));

  if (!result) return res.status(404).json({ error: 'not accessible' });
  res.set('Content-Type', result.ct);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(result.data);
}));

// ─── Endpoints Talk extras ────────────────────────────────────────────────────

// Indicador de digitação
router.post('/talk/rooms/:token/typing', handle(async (req, res) => {
  try {
    const { data } = await makeTalk(req).post(
      `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/typing?format=json`,
      req.body
    );
    res.json(data?.ocs?.meta ?? { status: 'ok' });
  } catch { res.json({ status: 'ok' }); }
}));

// Reações — GET, POST, DELETE
router.get('/talk/rooms/:token/messages/:messageId/reactions', handle(async (req, res) => {
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`
  );
  res.json(data.ocs.data ?? {});
}));

router.post('/talk/rooms/:token/messages/:messageId/reactions', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
    req.body
  );
  res.json(data.ocs.data ?? {});
}));

router.delete('/talk/rooms/:token/messages/:messageId/reactions', handle(async (req, res) => {
  const { data } = await makeTalk(req).delete(
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
    { params: { reaction: req.query.reaction } }
  );
  res.json(data.ocs.data ?? {});
}));

// Editar mensagem
router.put('/talk/rooms/:token/messages/:messageId', handle(async (req, res) => {
  const { data } = await makeTalk(req).put(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/${req.params.messageId}?format=json`,
    req.body
  );
  res.json(data.ocs.data ?? {});
}));

// Excluir mensagem
router.delete('/talk/rooms/:token/messages/:messageId', handle(async (req, res) => {
  await makeTalk(req).delete(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/${req.params.messageId}?format=json`
  );
  res.json({ success: true });
}));

// Avatar de sala (grupos)
router.get('/talk/rooms/:token/avatar', handle(async (req, res) => {
  try {
    const isDark = req.query.dark === '1';
    const response = await makeTalk(req).get(
      `/ocs/v2.php/apps/spreed/api/v1/room/${req.params.token}/avatar${isDark ? '/dark' : ''}`,
      { responseType: 'arraybuffer' }
    );
    res.set('Content-Type', response.headers['content-type'] || 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=1800');
    res.send(response.data);
  } catch { res.status(404).end(); }
}));

// Criar sala (DM roomType=1 ou grupo roomType=2)
router.post('/talk/rooms', handle(async (req, res) => {
  const { data } = await makeTalk(req).post(
    `/ocs/v2.php/apps/spreed/api/v4/room?format=json`,
    req.body
  );
  res.json(data.ocs.data);
}));

// Buscar usuários Nextcloud para iniciar conversa
router.get('/talk/search/users', handle(async (req, res) => {
  const { data } = await makeTalk(req).get(
    `/ocs/v2.php/core/autocomplete/get?format=json`,
    { params: { search: req.query.search || '', itemType: 'call', itemId: 'new', 'shareTypes[]': '0', limit: 20 } }
  );
  res.json(data.ocs.data || []);
}));

// SSE — proxy do long-poll do Talk para updates em tempo real.
// Auth via query string porque EventSource não suporta headers customizados.
router.get('/talk/rooms/:token/sse', (req, res) => {
  const ncUrl   = req.query.ncUrl   || '';
  const ncUser  = req.query.ncUser  || '';
  const ncToken = req.query.ncToken || '';
  if (!ncUrl || !ncUser || !ncToken) return res.status(401).json({ error: 'credenciais obrigatórias' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const talk = axios.create({
    baseURL: ncUrl,
    auth: { username: ncUser, password: ncToken },
    headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
  });

  let lastId = parseInt(req.query.lastKnownMessageId) || 0;
  let active = true;

  (async () => {
    while (active) {
      try {
        const { data } = await talk.get(
          `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}`,
          { params: { format: 'json', lookIntoFuture: 1, timeout: 30, lastKnownMessageId: lastId, limit: 50, includeLastKnown: 0 }, timeout: 35_000 }
        );
        const messages = data?.ocs?.data ?? [];
        if (messages.length > 0) {
          const newLastId = Math.max(...messages.map(m => m.id));
          if (newLastId > lastId) lastId = newLastId;
          const comments = messages.filter(m => m.messageType === 'comment');
          const typing = messages
            .filter(m => m.messageType === 'system' && m.systemMessage === 'typing')
            .map(m => ({ actorId: m.actorId, actorDisplayName: m.actorDisplayName }));
          if (comments.length > 0) res.write(`data: ${JSON.stringify({ type: 'messages', data: comments })}\n\n`);
          if (typing.length > 0) res.write(`data: ${JSON.stringify({ type: 'typing', data: typing })}\n\n`);
        } else {
          res.write(': ping\n\n');
        }
      } catch (err) {
        if (!active) break;
        if (err.code === 'ECONNABORTED' || err.response?.status === 304) continue;
        console.warn('[sse] erro no poll Talk:', err.response?.status || err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  })();

  req.on('close', () => { active = false; });
});

module.exports = router;
