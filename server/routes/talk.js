// Nextcloud Login Flow v2 + proxy do Nextcloud Talk (mensagens, salas, reações,
// uploads, SSE em tempo real).
const express = require('express');
const axios = require('axios');
const router = express.Router();
const handle = require('../lib/handle');
const { makeTalk } = require('../services/talk');
const { getMyUserId } = require('../lib/redmine');
const { saveTalkAuth, clearTalkAuth, getTalkAuth } = require('../services/talkStore');
const { safeAgents } = require('../lib/ssrfGuard');

// Valida que uma URL é http(s) e bem-formada antes de o servidor buscá-la.
// Combinado com safeAgents (bloqueio de IPs internos), fecha o vetor de SSRF
// no fluxo de login do Talk, onde a URL/endpoint vêm do corpo da requisição.
function assertPublicHttpUrl(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    throw Object.assign(new Error('URL inválida'), { statusCode: 400, isSafe: true });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('URL deve ser http(s)'), { statusCode: 400, isSafe: true });
  }
  return u;
}

// Resolve a conta do Talk (url, user, token) a partir do uid do Redmine logado.
// Substitui os antigos headers x-nextcloud-* enviados pelo cliente.
async function talkAccount(req) {
  const uid = await getMyUserId(req);
  return getTalkAuth(uid) || {};
}

// =========================================================================
// NEXTCLOUD LOGIN FLOW v2
// =========================================================================

router.post(
  '/talk/login-flow/init',
  handle(async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    assertPublicHttpUrl(url);
    const base = url.replace(/\/$/, '');
    const { data } = await axios.post(`${base}/index.php/login/v2`, null, {
      timeout: 8000,
      maxRedirects: 0,
      ...safeAgents(), // bloqueia SSRF para IPs internos
    });
    res.json({
      loginUrl: data.login,
      pollEndpoint: data.poll.endpoint,
      pollToken: data.poll.token,
    });
  }),
);

router.post(
  '/talk/login-flow/poll',
  handle(async (req, res) => {
    const { pollEndpoint, pollToken } = req.body;
    if (!pollEndpoint || !pollToken) return res.status(400).json({ error: 'missing params' });
    assertPublicHttpUrl(pollEndpoint);
    try {
      const { data } = await axios.post(pollEndpoint, `token=${encodeURIComponent(pollToken)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000,
        maxRedirects: 0,
        ...safeAgents(), // bloqueia SSRF para IPs internos
      });

      const uid = await getMyUserId(req);
      if (!uid) throw Object.assign(new Error('Redmine não autenticado'), { statusCode: 401 });

      saveTalkAuth(uid, { url: data.server, user: data.loginName, token: data.appPassword });

      res.json({ done: true, server: data.server, user: data.loginName });
    } catch (e) {
      // 404 = ainda aguardando o usuário fazer login
      if (e.response?.status === 404) return res.json({ done: false });
      throw e;
    }
  }),
);

// Vincula manualmente uma conta do Talk (URL + usuário + senha de app/token).
// Valida as credenciais antes de persistir no store cifrado, chaveado pelo uid do Redmine.
router.post(
  '/talk/auth',
  handle(async (req, res) => {
    const { url, user, token } = req.body || {};
    if (!url || !user || !token) {
      return res.status(400).json({ error: 'url, user e token são obrigatórios' });
    }
    const uid = await getMyUserId(req);
    if (!uid) return res.status(401).json({ error: 'Redmine não autenticado' });

    try {
      const client = axios.create({
        baseURL: url.replace(/\/$/, ''),
        auth: { username: user, password: token },
        headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
      });
      await client.get('/ocs/v2.php/cloud/user?format=json');
    } catch {
      return res.status(401).json({ error: 'Credenciais do Talk inválidas' });
    }

    saveTalkAuth(uid, { url: url.replace(/\/$/, ''), user, token });
    res.json({ success: true });
  }),
);

router.delete(
  '/talk/auth',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    if (uid) clearTalkAuth(uid);
    res.json({ success: true });
  }),
);

// =========================================================================
// NEXTCLOUD TALK PROXY
// =========================================================================

router.get(
  '/talk/avatar/:userId',
  handle(async (req, res) => {
    const size = parseInt(req.query.size) || 40;
    const response = await (
      await makeTalk(req)
    ).get(`/index.php/avatar/${encodeURIComponent(req.params.userId)}/${size}`, {
      responseType: 'arraybuffer',
    });
    res.set('Content-Type', response.headers['content-type'] || 'image/png');
    res.set('Cache-Control', 'public, max-age=1800');
    res.send(response.data);
  }),
);

router.get(
  '/talk/me',
  handle(async (req, res) => {
    const { data } = await (await makeTalk(req)).get('/ocs/v2.php/cloud/user?format=json');
    res.json({ id: data.ocs.data.id, displayName: data.ocs.data.display_name });
  }),
);

// Perfil de um usuário Nextcloud (para o pop-up de perfil no chat).
// Em servidores onde a conta não é admin, /cloud/users/{id} pode dar 403/997;
// nesse caso devolvemos o mínimo (id + displayName via autocomplete) p/ o pop-up
// ainda ser útil (avatar + botão de DM).
router.get(
  '/talk/users/:userId',
  handle(async (req, res) => {
    const userId = req.params.userId;
    const talk = await makeTalk(req);
    const out = { id: userId, displayName: '', email: '', organisation: '', role: '', phone: '' };

    // 1. Metadados completos (requer admin ou mesmo grupo, conforme config do NC)
    try {
      const { data } = await talk.get(
        `/ocs/v2.php/cloud/users/${encodeURIComponent(userId)}?format=json`,
      );
      const d = data?.ocs?.data ?? {};
      out.displayName = d.displayname || d['display-name'] || '';
      out.email = d.email || '';
      out.organisation = d.organisation || '';
      out.role = d.role || '';
      out.phone = d.phone || '';
    } catch {
      /* 403/997: cai no fallback abaixo */
    }

    // 2. Fallback de nome via autocomplete (sempre acessível ao usuário logado)
    if (!out.displayName) {
      try {
        const { data } = await talk.get(`/ocs/v2.php/core/autocomplete/get?format=json`, {
          params: {
            search: userId,
            itemType: 'call',
            itemId: 'new',
            'shareTypes[]': '0',
            limit: 20,
          },
        });
        const match = (data?.ocs?.data || []).find((u) => u.id === userId);
        if (match) out.displayName = match.label || userId;
      } catch {
        /* ignora */
      }
    }
    if (!out.displayName) out.displayName = userId;

    res.json(out);
  }),
);

router.get(
  '/talk/rooms',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
    res.json(data.ocs.data);
  }),
);

router.get(
  '/talk/rooms/:token/messages',
  handle(async (req, res) => {
    const params = { limit: 50, lookIntoFuture: 0 };
    // Sem cursor = busca as 50 mais recentes usando um ID alto como âncora.
    // Sem isso, algumas versões do Talk retornam as mensagens mais ANTIGAS primeiro.
    params.lastKnownMessageId = req.query.lastKnownMessageId || 2147483647;
    const { data } = await (
      await makeTalk(req)
    ).get(`/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}?format=json`, { params });
    res.json(data.ocs.data);
  }),
);

router.post(
  '/talk/rooms/:token/messages',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).post(`/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}?format=json`, req.body);
    res.json(data.ocs.data);
  }),
);

router.post(
  '/talk/rooms/:token/upload',
  express.raw({ type: '*/*', limit: '100mb' }),
  handle(async (req, res) => {
    const filename = decodeURIComponent(req.headers['x-filename'] || `upload_${Date.now()}`);
    const ct = req.headers['x-content-type'] || 'application/octet-stream';
    const caption = req.headers['x-caption'] ? decodeURIComponent(req.headers['x-caption']) : '';
    const isVoice = req.headers['x-voice-message'] === '1';
    const { token } = req.params;
    const talk = await makeTalk(req);

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!body.length) {
      return res.status(400).json({ error: 'Arquivo vazio — tente novamente.' });
    }

    const OCS_TIMEOUT = 8000;
    const ncUrl = (await talkAccount(req)).url || '';
    const putOpts = {
      headers: { 'Content-Type': ct, 'Content-Length': body.length },
      maxBodyLength: 100 * 1024 * 1024,
      maxContentLength: 100 * 1024 * 1024,
    };

    // Subpasta única dentro de /Talk: evita conflito de nome (clipboard manda sempre
    // "image.png") e mantém o filename limpo na exibição do chat.
    const subdir = `Talk/talk_${Date.now()}`;
    try {
      await talk.request({ method: 'MKCOL', url: `/remote.php/webdav/Talk` });
    } catch {}
    try {
      await talk.request({ method: 'MKCOL', url: `/remote.php/webdav/${subdir}` });
    } catch {}
    await talk.put(`/remote.php/webdav/${subdir}/${encodeURIComponent(filename)}`, body, putOpts);

    // shareType 10 = Talk room (inline) — sempre a opção preferida.
    // caption vai como talkMetaData (legenda da imagem/arquivo).
    const shareToRoom = async (filePath) => {
      try {
        const shareBody = { shareType: 10, shareWith: token, path: filePath };
        // Mensagem de voz: metadado próprio do Talk (player nativo); senão, legenda.
        if (isVoice) shareBody.talkMetaData = JSON.stringify({ messageType: 'voice-message' });
        else if (caption) shareBody.talkMetaData = JSON.stringify({ caption });
        await talk.post('/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', shareBody, {
          timeout: OCS_TIMEOUT,
        });
        return { method: 'share' };
      } catch {
        return null;
      }
    };

    // shareType 3 = link público — só usado se o inline estiver indisponível.
    const sharePublic = async (filePath) => {
      try {
        const { data: pd } = await talk.post(
          '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
          { shareType: 3, path: filePath },
          { timeout: OCS_TIMEOUT },
        );
        const url = pd?.ocs?.data?.url;
        if (url) {
          const msg = caption ? `${caption}\n📎 ${filename}\n${url}` : `📎 ${filename}\n${url}`;
          await talk.post(
            `/ocs/v2.php/apps/spreed/api/v1/chat/${token}?format=json`,
            { message: msg },
            { timeout: OCS_TIMEOUT },
          );
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
  }),
);

router.post(
  '/talk/rooms/:token/read',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).post(`/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/read?format=json`, req.body);
    res.json(data.ocs.meta);
  }),
);

router.get(
  '/talk/rooms/:token/participants',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).get(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/participants?format=json`);
    res.json(data.ocs.data);
  }),
);

router.get(
  '/talk/file-preview',
  handle(async (req, res) => {
    const { fileId, path: filePath, actorId } = req.query;
    const user = (await talkAccount(req)).user;
    const talk = await makeTalk(req);
    const ext = (filePath || '').split('.').pop()?.toLowerCase() || 'jpg';
    const fallbackCt = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    const tryDownload = async (url, useAuth = true) => {
      try {
        const client = useAuth ? talk : axios;
        const r = await client.get(url, { responseType: 'arraybuffer', maxRedirects: 5 });
        const ct = String(r.headers['content-type'] || '');
        if (
          r.data?.byteLength > 100 &&
          !ct.includes('text/html') &&
          !ct.includes('application/json')
        ) {
          return { data: r.data, ct: ct || fallbackCt };
        }
      } catch {}
      return null;
    };

    // 1. OCS Direct Download — URL temporária sem auth, funciona para qualquer
    //    arquivo acessível ao usuário (inclusive compartilhamentos do Talk)
    try {
      const { data: ocsData } = await talk.post(`/ocs/v2.php/apps/dav/api/v1/direct?format=json`, {
        fileId: parseInt(fileId),
      });
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
      (filePath && (await tryDownload(`/remote.php/webdav/${filePath}`))) ||
      // 3. WebDAV explícito do usuário logado
      (filePath &&
        (await tryDownload(`/remote.php/dav/files/${encodeURIComponent(user)}/${filePath}`))) ||
      // 4. WebDAV do remetente (se houver permissão de share)
      (actorId &&
        actorId !== user &&
        filePath &&
        (await tryDownload(`/remote.php/dav/files/${encodeURIComponent(actorId)}/${filePath}`))) ||
      // 5. Preview thumbnail como último recurso
      (fileId &&
        (await tryDownload(`/index.php/core/preview?fileId=${fileId}&x=800&y=800&a=true`)));

    if (!result) return res.status(404).json({ error: 'not accessible' });
    res.set('Content-Type', result.ct);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(result.data);
  }),
);

// Download de arquivo compartilhado (qualquer tipo). Diferente do file-preview,
// não cai para thumbnail — busca os bytes reais e força attachment.
router.get(
  '/talk/file-download',
  handle(async (req, res) => {
    const { fileId, path: filePath, actorId } = req.query;
    const user = (await talkAccount(req)).user;
    const talk = await makeTalk(req);
    const filename = req.query.name
      ? decodeURIComponent(req.query.name)
      : (filePath || '').split('/').pop() || `arquivo_${fileId}`;

    const tryDownload = async (url, useAuth = true) => {
      try {
        const client = useAuth ? talk : axios;
        const r = await client.get(url, { responseType: 'arraybuffer', maxRedirects: 5 });
        const ct = String(r.headers['content-type'] || '');
        if (r.data?.byteLength > 0 && !ct.includes('text/html')) {
          return { data: r.data, ct: ct || 'application/octet-stream' };
        }
      } catch {}
      return null;
    };

    let result = null;
    // 1. OCS Direct Download (URL temporária, funciona p/ qualquer arquivo acessível)
    try {
      const { data: ocsData } = await talk.post(`/ocs/v2.php/apps/dav/api/v1/direct?format=json`, {
        fileId: parseInt(fileId),
      });
      const directUrl = ocsData?.ocs?.data?.url;
      if (directUrl) result = await tryDownload(directUrl, false);
    } catch {}

    // 2/3/4. WebDAV (usuário logado / remetente)
    if (!result && filePath) {
      result =
        (await tryDownload(`/remote.php/webdav/${filePath}`)) ||
        (await tryDownload(`/remote.php/dav/files/${encodeURIComponent(user)}/${filePath}`)) ||
        (actorId && actorId !== user
          ? await tryDownload(`/remote.php/dav/files/${encodeURIComponent(actorId)}/${filePath}`)
          : null);
    }

    if (!result) return res.status(404).json({ error: 'not accessible' });
    res.set('Content-Type', result.ct);
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(result.data));
  }),
);

// ─── Endpoints Talk extras ────────────────────────────────────────────────────

// Indicador de digitação
router.post(
  '/talk/rooms/:token/typing',
  handle(async (req, res) => {
    try {
      const { data } = await (
        await makeTalk(req)
      ).post(
        `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/typing?format=json`,
        req.body,
      );
      res.json(data?.ocs?.meta ?? { status: 'ok' });
    } catch {
      res.json({ status: 'ok' });
    }
  }),
);

// Reações — GET, POST, DELETE
router.get(
  '/talk/rooms/:token/messages/:messageId/reactions',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).get(
      `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
    );
    res.json(data.ocs.data ?? {});
  }),
);

router.post(
  '/talk/rooms/:token/messages/:messageId/reactions',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).post(
      `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
      req.body,
    );
    res.json(data.ocs.data ?? {});
  }),
);

router.delete(
  '/talk/rooms/:token/messages/:messageId/reactions',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).delete(
      `/ocs/v2.php/apps/spreed/api/v1/reaction/${req.params.token}/${req.params.messageId}?format=json`,
      { params: { reaction: req.query.reaction } },
    );
    res.json(data.ocs.data ?? {});
  }),
);

// Editar mensagem
router.put(
  '/talk/rooms/:token/messages/:messageId',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).put(
      `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/${req.params.messageId}?format=json`,
      req.body,
    );
    res.json(data.ocs.data ?? {});
  }),
);

// Excluir mensagem
router.delete(
  '/talk/rooms/:token/messages/:messageId',
  handle(async (req, res) => {
    await (
      await makeTalk(req)
    ).delete(
      `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/${req.params.messageId}?format=json`,
    );
    res.json({ success: true });
  }),
);

// Avatar de sala (grupos)
router.get(
  '/talk/rooms/:token/avatar',
  handle(async (req, res) => {
    try {
      const isDark = req.query.dark === '1';
      const response = await (
        await makeTalk(req)
      ).get(
        `/ocs/v2.php/apps/spreed/api/v1/room/${req.params.token}/avatar${isDark ? '/dark' : ''}`,
        { responseType: 'arraybuffer' },
      );
      res.set('Content-Type', response.headers['content-type'] || 'image/svg+xml');
      res.set('Cache-Control', 'public, max-age=1800');
      res.send(response.data);
    } catch {
      res.status(404).end();
    }
  }),
);

// Criar sala (DM roomType=1 ou grupo roomType=2)
router.post(
  '/talk/rooms',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).post(`/ocs/v2.php/apps/spreed/api/v4/room?format=json`, req.body);
    res.json(data.ocs.data);
  }),
);

// Visão geral dos compartilhamentos da conversa (arquivos/mídia de todo o histórico).
// Retorna objeto agrupado por tipo: { media, file, voice, audio, location, deckcard, other }.
router.get(
  '/talk/rooms/:token/shares',
  handle(async (req, res) => {
    try {
      const { data } = await (
        await makeTalk(req)
      ).get(`/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/share/overview?format=json`, {
        params: { limit: 7 },
      });
      res.json(data?.ocs?.data ?? {});
    } catch (e) {
      if (e.response?.status === 404) return res.json({});
      throw e;
    }
  }),
);

// Compartilhamentos de um tipo específico (paginação por lastKnownMessageId).
// objectType: media | file | voice | audio | location | deckcard | other
router.get(
  '/talk/rooms/:token/shares/:objectType',
  handle(async (req, res) => {
    try {
      const params = { objectType: req.params.objectType, limit: 50 };
      if (req.query.lastKnownMessageId) params.lastKnownMessageId = req.query.lastKnownMessageId;
      const { data } = await (
        await makeTalk(req)
      ).get(`/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}/share?format=json`, {
        params,
      });
      res.json(data?.ocs?.data ?? []);
    } catch (e) {
      if (e.response?.status === 404) return res.json([]);
      throw e;
    }
  }),
);

// Busca no histórico de mensagens (provider talk-message da busca unificada).
// Escopa à conversa atual via `from=/call/{token}`. Retorna mensagens com id +
// timestamp para o cliente "pular" até o ponto no chat.
router.get(
  '/talk/rooms/:token/search',
  handle(async (req, res) => {
    const term = (req.query.term || '').toString().trim();
    if (term.length < 2) return res.json([]);
    try {
      const { data } = await (
        await makeTalk(req)
      ).get(`/ocs/v2.php/search/providers/talk-message/search?format=json`, {
        params: { term, from: `/call/${req.params.token}`, limit: 20 },
      });
      const entries = data?.ocs?.data?.entries || [];
      const results = entries
        .map((e) => {
          const a = e.attributes || {};
          const id = parseInt(a.messageId || a.id || '0', 10);
          // só mantém resultados desta conversa
          if (a.conversation && a.conversation !== req.params.token) return null;
          return id
            ? {
                id,
                actorDisplayName: e.title || a.actorDisplayName || '',
                message: e.subline || '',
                timestamp: parseInt(a.timestamp || '0', 10) || 0,
              }
            : null;
        })
        .filter(Boolean);
      res.json(results);
    } catch (e) {
      // provider pode estar desativado em servidores antigos — devolve vazio
      if (e.response?.status === 404) return res.json([]);
      throw e;
    }
  }),
);

// ─── Presença / User Status ───────────────────────────────────────────────────

// Lista de status (presença) — só retorna quem tem status ativo/recente.
router.get(
  '/talk/user-statuses',
  handle(async (req, res) => {
    try {
      const { data } = await (
        await makeTalk(req)
      ).get(`/ocs/v2.php/apps/user_status/api/v1/statuses?format=json`, { params: { limit: 200 } });
      res.json(data?.ocs?.data ?? []);
    } catch (e) {
      if (e.response?.status === 404) return res.json([]); // app desativado
      throw e;
    }
  }),
);

// Meu status
router.get(
  '/talk/my-status',
  handle(async (req, res) => {
    try {
      const { data } = await (
        await makeTalk(req)
      ).get(`/ocs/v2.php/apps/user_status/api/v1/user_status?format=json`);
      res.json(data?.ocs?.data ?? null);
    } catch (e) {
      if (e.response?.status === 404) return res.json(null);
      throw e;
    }
  }),
);

// Definir tipo de status: online | away | dnd | invisible
router.put(
  '/talk/my-status',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).put(`/ocs/v2.php/apps/user_status/api/v1/user_status/status?format=json`, {
      statusType: req.body.statusType,
    });
    if (data?.ocs?.meta?.status === 'failure')
      throw new Error(data.ocs.meta.message || 'Erro ao definir status');
    res.json(data?.ocs?.data ?? {});
  }),
);

// Definir mensagem de status personalizada
router.put(
  '/talk/my-status/message',
  handle(async (req, res) => {
    const body = { message: req.body.message ?? '', statusIcon: req.body.statusIcon ?? null };
    if (req.body.clearAt) body.clearAt = req.body.clearAt;
    const { data } = await (
      await makeTalk(req)
    ).put(`/ocs/v2.php/apps/user_status/api/v1/user_status/message/custom?format=json`, body);
    if (data?.ocs?.meta?.status === 'failure')
      throw new Error(data.ocs.meta.message || 'Erro ao definir mensagem de status');
    res.json(data?.ocs?.data ?? {});
  }),
);

// Limpar mensagem de status
router.delete(
  '/talk/my-status/message',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).delete(`/ocs/v2.php/apps/user_status/api/v1/user_status/message?format=json`);
    res.json(data?.ocs?.data ?? {});
  }),
);

// ─── Gestão de grupos (self-service) ──────────────────────────────────────────

// Renomear sala
router.put(
  '/talk/rooms/:token',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).put(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}?format=json`, {
      roomName: req.body.roomName,
    });
    res.json(data.ocs.data ?? {});
  }),
);

// Definir descrição/tópico
router.put(
  '/talk/rooms/:token/description',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).put(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/description?format=json`, {
      description: req.body.description,
    });
    res.json(data.ocs.data ?? {});
  }),
);

// Adicionar participante (source: 'users' por padrão)
router.post(
  '/talk/rooms/:token/participants',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).post(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/participants?format=json`, {
      newParticipant: req.body.newParticipant,
      source: req.body.source || 'users',
    });
    res.json(data.ocs.data ?? {});
  }),
);

// Remover participante (por attendeeId)
router.delete(
  '/talk/rooms/:token/attendees',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).delete(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/attendees?format=json`, {
      params: { attendeeId: req.query.attendeeId },
    });
    res.json(data.ocs.data ?? {});
  }),
);

// Promover / rebaixar moderador (por attendeeId)
router.post(
  '/talk/rooms/:token/moderators',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).post(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/moderators?format=json`, {
      attendeeId: req.body.attendeeId,
    });
    res.json(data.ocs.data ?? {});
  }),
);

router.delete(
  '/talk/rooms/:token/moderators',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).delete(`/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/moderators?format=json`, {
      params: { attendeeId: req.query.attendeeId },
    });
    res.json(data.ocs.data ?? {});
  }),
);

// Sair do grupo
router.delete(
  '/talk/rooms/:token/participants/self',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).delete(
      `/ocs/v2.php/apps/spreed/api/v4/room/${req.params.token}/participants/self?format=json`,
    );
    res.json(data.ocs.data ?? { success: true });
  }),
);

// Upload de avatar do grupo (multipart)
router.post(
  '/talk/rooms/:token/avatar',
  express.raw({ type: '*/*', limit: '10mb' }),
  handle(async (req, res) => {
    const ct = req.headers['x-content-type'] || 'image/png';
    const filename = decodeURIComponent(req.headers['x-filename'] || 'avatar.png');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!body.length) return res.status(400).json({ error: 'Arquivo vazio' });

    // OCS espera multipart/form-data com campo "file"
    const boundary = `----talkavatar${Date.now()}`;
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${ct}\r\n\r\n`,
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipart = Buffer.concat([pre, body, post]);

    const { data } = await (
      await makeTalk(req)
    ).post(
      `/ocs/v2.php/apps/spreed/api/v1/room/${req.params.token}/avatar?format=json`,
      multipart,
      { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } },
    );
    res.json(data.ocs.data ?? { success: true });
  }),
);

// Buscar usuários Nextcloud para iniciar conversa
router.get(
  '/talk/search/users',
  handle(async (req, res) => {
    const { data } = await (
      await makeTalk(req)
    ).get(`/ocs/v2.php/core/autocomplete/get?format=json`, {
      params: {
        search: req.query.search || '',
        itemType: 'call',
        itemId: 'new',
        'shareTypes[]': '0',
        limit: 20,
      },
    });
    res.json(data.ocs.data || []);
  }),
);

// SSE — proxy do long-poll do Talk para updates em tempo real.
// Como o EventSource trafega o cookie session_id (withCredentials: true),
// a authMiddleware do Redmine injeta os headers, permitindo usar makeTalk.
router.get(
  '/talk/rooms/:token/sse',
  handle(async (req, res) => {
    let talk;
    try {
      talk = await makeTalk(req);
    } catch (e) {
      return res.status(401).json({ error: 'Talk não autenticado' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let lastId = parseInt(req.query.lastKnownMessageId) || 0;
    let active = true;

    (async () => {
      while (active) {
        try {
          const { data } = await talk.get(
            `/ocs/v2.php/apps/spreed/api/v1/chat/${req.params.token}`,
            {
              params: {
                format: 'json',
                lookIntoFuture: 1,
                timeout: 30,
                lastKnownMessageId: lastId,
                limit: 50,
                includeLastKnown: 0,
              },
              timeout: 35_000,
            },
          );
          const messages = data?.ocs?.data ?? [];
          if (messages.length > 0) {
            const newLastId = Math.max(...messages.map((m) => m.id));
            if (newLastId > lastId) lastId = newLastId;
            const comments = messages.filter((m) => m.messageType === 'comment');
            const typing = messages
              .filter((m) => m.messageType === 'system' && m.systemMessage === 'typing')
              .map((m) => ({ actorId: m.actorId, actorDisplayName: m.actorDisplayName }));
            if (comments.length > 0)
              res.write(`data: ${JSON.stringify({ type: 'messages', data: comments })}\n\n`);
            if (typing.length > 0)
              res.write(`data: ${JSON.stringify({ type: 'typing', data: typing })}\n\n`);
          } else {
            res.write(': ping\n\n');
          }
        } catch (err) {
          if (!active) break;
          if (err.code === 'ECONNABORTED' || err.response?.status === 304) continue;
          console.warn('[sse] erro no poll Talk:', err.response?.status || err.message);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();

    req.on('close', () => {
      active = false;
    });
  }),
);

module.exports = router;
