// =========================================================================
// Integração com Zimbra via API SOAP (HTTPS/443) — NÃO usa IMAP/SMTP.
// O Zimbra da Redesoft só expõe a 443 publicamente; IMAP/SMTP ficam na
// rede interna. A API SOAP (a mesma que o webmail usa) dá conta de tudo:
// auth, pastas, listar, ler, enviar e anexos.
//
// Reaproveitamento de credenciais: quando o usuário loga no Redmine com
// usuário+senha (AD), a MESMA senha autentica no Zimbra. O login é o
// usuário "pelado" (ex.: joao.moura), sem @dominio.
// =========================================================================
const axios = require('axios');
const { createSession, MAIL_TTL_MS } = require('./lib/sessions');
const { getMyUserId } = require('./lib/redmine');
const { getAd } = require('./services/secretsStore');

const DEFAULT_HOST = process.env.ZIMBRA_HOST || 'email.redesoft.org';

// Cache de token por "host:user" — o token do Zimbra vale ~24h.
// Guardamos com uma margem de segurança para reautenticar antes de expirar.
const tokenCache = new Map(); // key -> { token, exp }

function soapUrl(host) {
  return `https://${host}/service/soap`;
}

// Envolve uma chamada SOAP do Zimbra. `token` opcional (auth não tem).
async function zimbraSoap(host, token, namespace, requestName, payload) {
  const context = { _jsns: 'urn:zimbra' };
  if (token) context.authToken = { _content: token };
  const body = {
    Header: { context },
    Body: { [requestName]: { _jsns: namespace, ...payload } },
  };
  // Extrai um Fault do Zimbra (Reason/Code) num Error legível com .zimbraCode.
  const faultToError = (fault) => {
    const reason = fault.Reason?.Text || 'Erro Zimbra';
    const code = fault.Detail?.Error?.Code || '';
    const err = new Error(`${reason}${code ? ` (${code})` : ''}`);
    err.zimbraCode = code;
    return err;
  };

  let data;
  try {
    ({ data } = await axios.post(soapUrl(host), body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    }));
  } catch (e) {
    // O Zimbra devolve o Fault com HTTP 500 — o axios rejeita antes de chegarmos
    // ao parse abaixo. Se o corpo da resposta tiver um Fault, extrai a razão/código.
    const fault = e.response?.data?.Body?.Fault;
    if (fault) throw faultToError(fault);
    throw e;
  }
  if (data.Body?.Fault) throw faultToError(data.Body.Fault);
  return data.Body[`${requestName.replace(/Request$/, '')}Response`];
}

// Autentica no Zimbra e devolve o token (com cache). Lança erro se as
// credenciais forem inválidas.
async function authenticate(host, user, password) {
  const key = `${host}:${user}`;
  const cached = tokenCache.get(key);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  let resp;
  try {
    resp = await zimbraSoap(host, null, 'urn:zimbraAccount', 'AuthRequest', {
      account: { by: 'name', _content: user },
      password: { _content: password },
    });
  } catch (err) {
    // Credenciais inválidas / conta inexistente -> 401 para o front tratar.
    if (/AUTH_FAILED|NO_SUCH_ACCOUNT|PASSWORD/i.test(err.zimbraCode || err.message)) {
      err.statusCode = 401;
      err.message = 'Usuário ou senha do e-mail inválidos no Zimbra.';
      err.isSafe = true; // mensagem intencional: o errorMiddleware deve preservá-la
    }
    throw err;
  }
  const token = resp.authToken?.[0]?._content || resp.authToken?._content || resp.authToken;
  const lifetime = Number(resp.lifetime) || 24 * 60 * 60 * 1000;
  if (!token) throw new Error('Zimbra não retornou token de autenticação');
  tokenCache.set(key, { token, exp: Date.now() + lifetime });
  return token;
}

// Resolve as credenciais de e-mail a partir do request.
//   Modo usuário/senha do Redmine  -> reaproveita x-redmine-user / x-redmine-pass.
//   Modo chave de API (sem senha)  -> usa headers x-mail-* (config manual).
// Headers x-mail-* sempre têm prioridade quando presentes.
async function resolveMailCreds(req) {
  const host = req.headers['x-mail-host'] || DEFAULT_HOST;
  let user = req.headers['x-redmine-user'] || '';
  let password = req.headers['x-redmine-pass'] || '';
  if (!user || !password) {
    try {
      const uid = await getMyUserId(req);
      const ad = uid ? getAd(uid) : null;
      if (ad) {
        user = ad.user;
        password = ad.pass;
      }
    } catch {
      /* sem credenciais no cofre */
    }
  }
  return { host, user, password };
}

// Garante um token válido para o request atual. Lança 412 se faltarem credenciais.
async function tokenFor(req) {
  const { host, user, password } = await resolveMailCreds(req);
  if (!user || !password) {
    const err = new Error(
      'Sem credenciais de e-mail. Faça login com usuário e senha, ou configure o e-mail nas Configurações.',
    );
    err.statusCode = 412; // Precondition Failed
    err.isSafe = true; // mensagem intencional: o errorMiddleware deve preservá-la
    throw err;
  }
  return { host, user, password, token: await authenticate(host, user, password) };
}

// Faults do Zimbra que indicam token expirado/inválido — devem disparar
// reautenticação automática (o token vive ~24h, mas pode cair antes).
const REAUTH_RE = /AUTH_EXPIRED|AUTH_REQUIRED|NO_VALID_AUTH_TOKEN|SESSION_EXPIRED/i;

// Chama uma operação SOAP autenticada, reautenticando UMA vez se o token
// tiver expirado/sido invalidado no servidor.
async function mailSoap(req, namespace, requestName, payload) {
  const { host, user, token } = await tokenFor(req);
  try {
    return await zimbraSoap(host, token, namespace, requestName, payload);
  } catch (err) {
    if (!REAUTH_RE.test(err.zimbraCode || err.message)) throw err;
    tokenCache.delete(`${host}:${user}`); // força novo login
    const fresh = await tokenFor(req);
    return zimbraSoap(host, fresh.token, namespace, requestName, payload);
  }
}

// --- Normalização das respostas do Zimbra para o formato do nosso front ---

// Extrai endereços de um array `e` do Zimbra (t: f=from, t=to, c=cc, b=bcc).
function pickAddr(emails, type) {
  return (emails || [])
    .filter((e) => e.t === type)
    .map((e) => ({ address: e.a, name: e.p || e.d || e.a }));
}

// Mensagem "slim" para a listagem.
function slimMessage(m) {
  const from = pickAddr(m.e, 'f')[0] || {};
  return {
    id: m.id,
    conversationId: m.cid,
    subject: m.su || '(sem assunto)',
    snippet: m.fr || '',
    date: Number(m.d),
    unread: typeof m.f === 'string' ? m.f.includes('u') : false,
    flagged: typeof m.f === 'string' ? m.f.includes('f') : false,
    hasAttachment: typeof m.f === 'string' ? m.f.includes('a') : false,
    from,
    size: m.s,
  };
}

// Decodifica as entidades HTML que o Zimbra insere nos valores de atributo
// (decimais `&#64;`, hexa `&#x40;` e as nomeadas básicas). Usado para casar o
// `cid:` do HTML com o Content-ID real da parte MIME.
function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Percorre a árvore de mime-parts coletando corpo (html preferido), anexos e
// imagens inline (referenciadas no HTML por cid:).
function walkParts(part, acc) {
  if (!part) return;
  const parts = Array.isArray(part) ? part : [part];
  for (const p of parts) {
    const ct = (p.ct || '').toLowerCase();
    const isInlineImage = p.ci && ct.startsWith('image/');
    const isAttachment =
      !isInlineImage && (p.cd === 'attachment' || (p.filename && p.cd !== 'inline'));
    if (isInlineImage) {
      acc.inline.push({ ci: String(p.ci).replace(/[<>]/g, ''), part: p.part });
    } else if (isAttachment && p.filename) {
      acc.attachments.push({
        part: p.part,
        filename: p.filename,
        contentType: p.ct,
        size: p.s || 0,
      });
    } else if (ct === 'text/html' && p.content != null) {
      acc.html = p.content;
    } else if (ct === 'text/plain' && p.content != null) {
      acc.text = p.content;
    }
    if (p.mp) walkParts(p.mp, acc);
  }
}

function fullMessage(m, sessionToken) {
  const acc = { html: '', text: '', attachments: [], inline: [] };
  walkParts(m.mp, acc);

  // Troca as referências cid: por URLs do proxy autenticado via token de sessão.
  // O token é emitido em getMessage() e vale 1h — tempo suficiente para carregar imagens.
  //
  // ⚠️ O Zimbra entrega o HTML com caracteres do cid codificados como entidades
  // (ex.: `@` vira `&#64;`), então `cid:image001.png&#64;host` precisa casar com o
  // Content-ID `image001.png@host`. Por isso decodificamos as entidades de CADA
  // referência cid: antes de procurar a parte. Match case-insensitive porque os
  // clientes variam a caixa do Content-ID. Cobre src/dfsrc e background:url(cid:).
  const byCid = new Map(acc.inline.map((img) => [img.ci.toLowerCase(), img.part]));
  let html = acc.html;
  const qs = sessionToken ? `?s=${sessionToken}` : '';
  if (html && byCid.size) {
    html = html.replace(/cid:([^\s"'<>)]+)/gi, (full, rawCid) => {
      const ci = decodeHtmlEntities(rawCid).replace(/[<>]/g, '').trim().toLowerCase();
      const part = byCid.get(ci);
      return part ? `/api/mail/messages/${m.id}/attachments/${part}${qs}` : full;
    });
  }

  return {
    id: m.id,
    conversationId: m.cid,
    subject: m.su || '(sem assunto)',
    date: Number(m.d),
    from: pickAddr(m.e, 'f')[0] || {},
    to: pickAddr(m.e, 't'),
    cc: pickAddr(m.e, 'c'),
    html,
    text: acc.text,
    attachments: acc.attachments,
    sessionToken: sessionToken || null,
  };
}

// Pastas de mail (recursivo, achatado), só as que contêm mensagens.
function flattenFolders(folder, out = []) {
  if (!folder) return out;
  const list = Array.isArray(folder) ? folder : [folder];
  for (const f of list) {
    if (f.name && f.name !== 'Chats' && (f.view === 'message' || f.view == null)) {
      out.push({
        id: f.id,
        name: f.name,
        path: f.absFolderPath || `/${f.name}`,
        unread: Number(f.u) || 0,
        total: Number(f.n) || 0,
        view: f.view || 'message',
      });
    }
    if (f.folder) flattenFolders(f.folder, out);
  }
  return out;
}

// === Operações de alto nível usadas pelos endpoints =====================

async function listFolders(req) {
  const resp = await mailSoap(req, 'urn:zimbraMail', 'GetFolderRequest', {});
  const root = resp.folder?.[0] || resp.folder;
  return flattenFolders(root?.folder || root);
}

async function listMessages(req, { folder = 'inbox', limit = 25, offset = 0 } = {}) {
  // `query` aceita sintaxe de busca do Zimbra; "in:<pasta>" filtra por pasta.
  const query = folder.startsWith('in:') ? folder : `in:"${folder}"`;
  const resp = await mailSoap(req, 'urn:zimbraMail', 'SearchRequest', {
    types: 'message',
    query,
    limit: Number(limit),
    offset: Number(offset),
    sortBy: 'dateDesc',
    fetch: '0',
  });
  return {
    messages: (resp.m || []).map(slimMessage),
    more: !!resp.more,
    offset: Number(offset),
    total: Number(resp.total) || undefined,
  };
}

async function getMessage(req, id, { markRead = true } = {}) {
  const { host, user, password } = await resolveMailCreds(req);
  const resp = await mailSoap(req, 'urn:zimbraMail', 'GetMsgRequest', {
    m: { id: String(id), html: 1, read: markRead ? 1 : 0, needExp: 1 },
  });
  const m = resp.m?.[0] || resp.m;
  // Cria sessão de curta duração (1h) para autorizar downloads de anexos desta mensagem.
  const sessionToken =
    user && password ? createSession({ kind: 'mail', host, user, password }, MAIL_TTL_MS) : null;
  return fullMessage(m, sessionToken);
}

async function searchMessages(req, q, { limit = 25, offset = 0 } = {}) {
  const resp = await mailSoap(req, 'urn:zimbraMail', 'SearchRequest', {
    types: 'message',
    query: q,
    limit: Number(limit),
    offset: Number(offset),
    sortBy: 'dateDesc',
    fetch: '0',
  });
  return { messages: (resp.m || []).map(slimMessage), more: !!resp.more, offset: Number(offset) };
}

// Marca/desmarca lido, sinaliza, move para lixeira/pasta etc.
// `op: 'move'` exige `target` (id da pasta destino: Inbox=2, Trash=3…).
async function actOnMessage(req, id, op, target) {
  const action = { id: String(id), op };
  if (target != null && target !== '') action.l = String(target);
  await mailSoap(req, 'urn:zimbraMail', 'MsgActionRequest', { action });
  return { success: true };
}

// Normaliza um campo de destinatários (string única ou array) para lista limpa.
function addrList(v) {
  return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
}

// Monta o objeto <m> do Zimbra compartilhado por SendMsg e SaveDraft.
//   - Corpo em multipart/alternative (texto + HTML) quando há `html`; senão,
//     um único text/plain. Isso garante fallback para clientes texto-plano.
//   - `attachments`: aids vindos de /service/upload (upload prévio).
//   - `forwardParts`: partes de outra mensagem reanexadas por (mid, part),
//     sem re-upload (usado no Encaminhar).
function buildMessagePart({
  to,
  cc,
  bcc,
  subject,
  text,
  html,
  inReplyTo,
  attachments,
  forwardParts,
}) {
  const e = [];
  for (const addr of addrList(to)) e.push({ t: 't', a: addr });
  for (const addr of addrList(cc)) e.push({ t: 'c', a: addr });
  for (const addr of addrList(bcc)) e.push({ t: 'b', a: addr });

  const body = html
    ? {
        ct: 'multipart/alternative',
        mp: [
          { ct: 'text/plain', content: { _content: text || '' } },
          { ct: 'text/html', content: { _content: html } },
        ],
      }
    : { ct: 'text/plain', content: { _content: text || '' } };

  const m = { e, su: { _content: subject || '' }, mp: [body] };
  if (inReplyTo) m.irt = { _content: inReplyTo };

  const attach = {};
  const aids = (attachments || []).map((a) => a.aid).filter(Boolean);
  if (aids.length) attach.aid = aids.join(',');
  const parts = (forwardParts || []).filter((p) => p && p.mid && p.part);
  if (parts.length) attach.mp = parts.map((p) => ({ mid: String(p.mid), part: String(p.part) }));
  if (attach.aid || attach.mp) m.attach = attach;

  return m;
}

async function sendMessage(req, payload) {
  const m = buildMessagePart(payload);
  await mailSoap(req, 'urn:zimbraMail', 'SendMsgRequest', { m });
  return { success: true };
}

// Salva a mensagem como rascunho (pasta Rascunhos do Zimbra) sem enviar.
async function saveDraft(req, payload) {
  const m = buildMessagePart(payload);
  const resp = await mailSoap(req, 'urn:zimbraMail', 'SaveDraftRequest', { m });
  const draft = resp.m?.[0] || resp.m;
  return { success: true, id: draft?.id != null ? String(draft.id) : null };
}

// Faz upload de um anexo para o Zimbra e devolve o `aid` (attachment id) que
// depois é referenciado no SendMsg/SaveDraft. É REST (não SOAP), como o
// download em fetchAttachment. A resposta do servlet tem a forma:
//   200,'null',[{"aid":"...","filename":"...","ct":"...","s":123}]
async function uploadAttachment(req, { filename, contentType, buffer }) {
  const { host, user, password } = await tokenFor(req);
  const safeName = String(filename || 'anexo').replace(/["\r\n]/g, '');
  const url = `https://${host}/service/upload?fmt=extended&requestId=0`;

  const post = (tok) =>
    axios.post(url, buffer, {
      responseType: 'text',
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: {
        Cookie: `ZM_AUTH_TOKEN=${tok}`,
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}"`,
      },
    });

  let token = await authenticate(host, user, password);
  let resp;
  try {
    resp = await post(token);
  } catch (e) {
    // 401/440 = token caiu: reautentica com as mesmas credenciais (padrão de fetchAttachment).
    if (e.response?.status !== 401 && e.response?.status !== 440) throw e;
    tokenCache.delete(`${host}:${user}`);
    token = await authenticate(host, user, password);
    resp = await post(token);
  }

  const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
  // Extrai o array JSON após o segundo separador ",'null',".
  const jsonStart = raw.indexOf('[');
  const jsonEnd = raw.lastIndexOf(']');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Resposta de upload do Zimbra inesperada: ${raw.slice(0, 120)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch {
    throw new Error('Falha ao interpretar a resposta de upload do Zimbra.');
  }
  const item = Array.isArray(parsed) ? parsed[0] : null;
  if (!item?.aid) throw new Error('Upload do Zimbra não retornou aid.');
  return {
    aid: item.aid,
    filename: item.filename || safeName,
    size: Number(item.s) || buffer.length,
    contentType: item.ct || contentType || 'application/octet-stream',
  };
}

// === Calendário (appointments) =========================================
// O Zimbra expõe a agenda pela mesma API SOAP. Buscamos compromissos numa
// janela de tempo via SearchRequest(types=appointment), com calExpandInst*
// expandindo recorrências no servidor (não precisamos calcular RRULE aqui).
//
// ⚠️ Os nomes de campo abaixo (name, loc, dur, inst.s, ptst, or…) foram
// inferidos da API do Zimbra e devem ser CONFERIDOS contra o servidor real
// via GET /api/mail/calendar?raw=1 (engenharia reversa, como no mail).

// Normaliza um <appt> da busca em uma ou mais ocorrências (uma por instância).
//
// O Zimbra já devolve a série agrupada: UM <appt> com N <inst>. Achatamos em N
// eventos para o grid, mas carregamos em cada um o que identifica a série
// (uid, recurring, occurrencesInWindow) e a ocorrência (ridZ) — sem isso o
// cliente não consegue distinguir "22 ocorrências de uma daily" de "22 eventos".
function slimAppointment(appt) {
  const baseDur = Number(appt.dur) || 0;
  const insts = Array.isArray(appt.inst) ? appt.inst : appt.inst ? [appt.inst] : [{}];
  // `recur` só vem (como true) em séries; em evento único a chave nem existe.
  const recurring = !!appt.recur;
  return insts.map((inst) => {
    const start = Number(inst.s ?? appt.s);
    const dur = Number(inst.dur ?? baseDur) || 0;
    const hasStart = Number.isFinite(start);
    return {
      id: appt.id, // id do item de calendário
      invId: appt.invId ?? null, // id do convite (para responder)
      uid: appt.uid ?? null,
      compNum: Number(appt.compNum) || 0,
      recurring,
      // Recurrence-id desta ocorrência (ex.: 20260710T143000Z). Necessário para
      // responder/excluir UMA ocorrência (exceptId) em vez da série inteira.
      ridZ: inst.ridZ ?? null,
      isException: !!inst.ex, // ocorrência destacada da série (remarcada)
      // Ocorrências desta série DENTRO da janela consultada — não o tamanho real
      // da série (a RRULE pode ser infinita). Serve para medir densidade no grid.
      occurrencesInWindow: insts.length,
      subject: appt.name || appt.su || '(sem título)',
      start: hasStart ? start : null, // epoch ms
      end: hasStart ? start + dur : null,
      durationMs: dur,
      allDay: !!appt.allDay,
      location: appt.loc || '',
      status: appt.status || '', // TENT | CONF | CANC
      ptst: appt.ptst || '', // participação: NE|AC|TE|DE|...
      organizer: appt.or ? { address: appt.or.a, name: appt.or.d || appt.or.a } : null,
      isOrganizer: appt.isOrg === 1 || appt.isOrg === true,
      snippet: appt.fr || '',
    };
  });
}

// Lista compromissos numa janela [start, end] (epoch ms). `raw` devolve o JSON
// cru do Zimbra para conferência de campos.
async function listAppointments(req, { start, end, raw = false } = {}) {
  const now = Date.now();
  const s = Number(start) || now;
  const e = Number(end) || now + 7 * 86400000;
  const resp = await mailSoap(req, 'urn:zimbraMail', 'SearchRequest', {
    types: 'appointment',
    calExpandInstStart: s,
    calExpandInstEnd: e,
    query: 'inid:10', // calendário padrão (system folder id 10)
    sortBy: 'none',
    limit: 1000,
    offset: 0,
  });
  if (raw) return resp;
  const appts = resp.appt ? (Array.isArray(resp.appt) ? resp.appt : [resp.appt]) : [];
  return appts
    .flatMap(slimAppointment)
    .filter((ev) => ev.start != null && ev.start >= s && ev.start <= e)
    .sort((a, b) => a.start - b.start);
}

// Responde a um convite (aceitar/recusar/talvez). verb ∈ ACCEPT|DECLINE|TENTATIVE.
// `id` é o id do item; updateOrganizer notifica o organizador da resposta.
async function replyToInvite(req, { id, verb, compNum = 0 }) {
  const VERBS = { ACCEPT: 'ACCEPT', DECLINE: 'DECLINE', TENTATIVE: 'TENTATIVE' };
  const v = VERBS[String(verb).toUpperCase()];
  if (!v) {
    const err = new Error('verb inválido (ACCEPT|DECLINE|TENTATIVE)');
    err.statusCode = 400;
    err.isSafe = true;
    throw err;
  }
  await mailSoap(req, 'urn:zimbraMail', 'SendInviteReplyRequest', {
    id: String(id),
    compNum: Number(compNum) || 0,
    verb: v,
    updateOrganizer: 'TRUE',
  });
  return { success: true, verb: v };
}

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  err.isSafe = true; // mensagem intencional para o front
  return err;
}

// Formata um instante (epoch ms) no formato de data/hora UTC do iCalendar/Zimbra:
// 20260710T170000Z. Sem ambiguidade de fuso — o Zimbra converte para o fuso de
// cada convidado ao exibir.
function fmtZimbraUtc(ms) {
  return new Date(Number(ms))
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// Data local (YYYYMMDD) para eventos de dia inteiro. Como o app roda como exe
// local (1 instância por usuário), o fuso do servidor == fuso do usuário.
function fmtZimbraDate(ms) {
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// Cria um compromisso no calendário do usuário via CreateAppointmentRequest.
// Se houver convidados, o Zimbra dispara os convites por e-mail automaticamente
// (o organizador é o próprio usuário autenticado). `attendees` é uma lista de
// { address, name?, role? } — role REQ (padrão) ou OPT. `start`/`end` em epoch ms.
async function createAppointment(
  req,
  { subject, start, end, location = '', description = '', attendees = [], allDay = false } = {},
) {
  if (!subject || !String(subject).trim()) throw badRequest('Assunto obrigatório.');
  if (start == null || end == null) throw badRequest('Início e fim são obrigatórios.');
  if (Number(end) <= Number(start)) throw badRequest('O fim deve ser depois do início.');

  const at = (attendees || [])
    .filter((a) => a && a.address)
    .map((a) => ({
      a: String(a.address),
      d: a.name || String(a.address),
      role: a.role === 'OPT' ? 'OPT' : 'REQ',
      ptst: 'NE', // ninguém respondeu ainda
      rsvp: '1', // pedir confirmação
    }));
  // Destinatários do e-mail de convite (mesmas pessoas dos <at>).
  const e = at.map((a) => ({ a: a.a, p: a.d, t: 't' }));

  const s = allDay ? { d: fmtZimbraDate(start) } : { d: fmtZimbraUtc(start) };
  const eTime = allDay ? { d: fmtZimbraDate(end) } : { d: fmtZimbraUtc(end) };

  const comp = {
    name: String(subject),
    loc: String(location || ''),
    fb: 'B', // free/busy: ocupado
    transp: 'O', // opaco (bloqueia agenda)
    status: 'CONF',
    class: 'PUB',
    allDay: allDay ? '1' : '0',
    s,
    e: eTime,
  };
  // Só inclui <at> quando há convidados (evita elemento vazio no invite).
  if (at.length) comp.at = at;

  const m = {
    su: { _content: String(subject) },
    inv: { comp },
    mp: [{ ct: 'text/plain', content: { _content: String(description || '') } }],
  };
  // <e> = destinatários do e-mail de convite; omitido em compromisso pessoal.
  if (e.length) m.e = e;

  const resp = await mailSoap(req, 'urn:zimbraMail', 'CreateAppointmentRequest', { m });
  return {
    success: true,
    calItemId: resp?.calItemId ?? null,
    invId: resp?.invId ?? null,
    invitesSent: at.length,
  };
}

// Normaliza um convidado (<at>) do convite. ptst = participação de CADA pessoa
// (a busca de agenda só traz a SUA; os demais só vêm no convite completo).
//   role: REQ=obrigatório OPT=opcional NON=informativo CHA=presidente
//   ptst: NE=sem resposta AC=aceitou DE=recusou TE=talvez DG=delegou
// Casa o endereço do convidado com o usuário logado. O login no Zimbra costuma
// ser "pelado" (joao.moura) e o convidado é o e-mail (joao.moura@redesoft.org);
// comparamos a parte local, e também o e-mail inteiro caso o login já seja um.
function attendeeIsMe(address, me) {
  if (!address || !me) return false;
  const a = String(address).toLowerCase();
  const m = String(me).toLowerCase();
  return a === m || a.split('@')[0] === m.split('@')[0];
}

function slimAttendee(at, me) {
  return {
    address: at.a || '',
    name: at.d || at.cn || at.a || '',
    role: at.role || 'REQ',
    ptst: at.ptst || 'NE',
    rsvp: at.rsvp === 1 || at.rsvp === '1' || at.rsvp === true,
    isMe: attendeeIsMe(at.a, me),
  };
}

// Lista os participantes de um compromisso e a resposta de cada um. A agenda
// (SearchRequest) não traz isso; é preciso buscar o convite via
// GetAppointmentRequest, cujo <inv><comp> contém os <at> (attendees) e o <or>.
// `id` é o id do item de calendário (CalendarEvent.id). `raw` devolve o JSON cru.
async function getAppointmentAttendees(req, id, { raw = false } = {}) {
  const { user: me } = await resolveMailCreds(req);
  const resp = await mailSoap(req, 'urn:zimbraMail', 'GetAppointmentRequest', {
    id: String(id),
    includeContent: 0, // só metadados; não precisamos do corpo do convite
  });
  if (raw) return resp;
  const appt = Array.isArray(resp.appt) ? resp.appt[0] : resp.appt;
  if (!appt) return { organizer: null, attendees: [] };
  // Recorrências geram vários <inv>; pegamos o 1º componente que tenha convidados.
  const invs = Array.isArray(appt.inv) ? appt.inv : appt.inv ? [appt.inv] : [];
  let comp = null;
  for (const inv of invs) {
    const comps = Array.isArray(inv.comp) ? inv.comp : inv.comp ? [inv.comp] : [];
    const withAt = comps.find((c) => c.at) || comps[0];
    if (withAt) {
      comp = withAt;
      if (withAt.at) break;
    }
  }
  if (!comp) return { organizer: null, attendees: [] };
  const ats = Array.isArray(comp.at) ? comp.at : comp.at ? [comp.at] : [];
  const or = comp.or;
  return {
    organizer: or ? { address: or.a, name: or.d || or.a } : null,
    attendees: ats.map((at) => slimAttendee(at, me)),
  };
}

// Conta de não-lidos da Inbox — para o sino de notificações.
async function unreadCount(req) {
  const folders = await listFolders(req);
  const inbox = folders.find((f) => f.name === 'Inbox' || f.path === '/Inbox');
  return { unread: inbox?.unread || 0, inboxTotal: inbox?.total || 0 };
}

// Baixa o conteúdo bruto de um anexo (proxy autenticado) via REST do Zimbra.
// Recebe as credenciais explicitamente (vindas da sessão), sem estado global.
async function fetchAttachment({ host, user, password }, msgId, part) {
  const attUrl = (tok) =>
    `https://${host}/service/home/~/?auth=qp&zauthtoken=${encodeURIComponent(tok)}&id=${encodeURIComponent(msgId)}&part=${encodeURIComponent(part)}`;
  let token = await authenticate(host, user, password);
  let resp;
  try {
    resp = await axios.get(attUrl(token), { responseType: 'arraybuffer', timeout: 30000 });
  } catch (e) {
    // 401/440 do Zimbra = token caiu: reautentica com as mesmas credenciais.
    if (e.response?.status !== 401 && e.response?.status !== 440) throw e;
    tokenCache.delete(`${host}:${user}`);
    token = await authenticate(host, user, password);
    resp = await axios.get(attUrl(token), { responseType: 'arraybuffer', timeout: 30000 });
  }
  return {
    data: Buffer.from(resp.data),
    contentType: resp.headers['content-type'] || 'application/octet-stream',
  };
}

module.exports = {
  DEFAULT_HOST,
  resolveMailCreds,
  authenticate,
  tokenFor,
  listFolders,
  listMessages,
  getMessage,
  searchMessages,
  actOnMessage,
  sendMessage,
  saveDraft,
  uploadAttachment,
  unreadCount,
  fetchAttachment,
  listAppointments,
  getAppointmentAttendees,
  replyToInvite,
  createAppointment,
};
