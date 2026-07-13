// E-MAIL — Zimbra via API SOAP (HTTPS). Ver server/zimbra.js.
// Credenciais: reaproveita o login usuário/senha do Redmine (mesma senha AD);
// no modo chave de API, usa os headers x-mail-* (config manual no front).
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const zimbra = require('../zimbra');

// Testa a conexão/autenticação no Zimbra com as credenciais resolvidas.
router.get(
  '/mail/ping',
  handle(async (req, res) => {
    const { host, user } = await zimbra.resolveMailCreds(req);
    await zimbra.tokenFor(req); // lança 401/412 se não autenticar
    res.json({ ok: true, host, user });
  }),
);

// Lista de pastas com contadores (Inbox, Sent, Junk, Trash…).
router.get(
  '/mail/folders',
  handle(async (req, res) => {
    res.json({ folders: await zimbra.listFolders(req) });
  }),
);

// Lista mensagens de uma pasta (paginado).
router.get(
  '/mail/messages',
  handle(async (req, res) => {
    const { folder = 'inbox', limit = 25, offset = 0 } = req.query;
    res.json(await zimbra.listMessages(req, { folder, limit, offset }));
  }),
);

// Busca por texto livre (sintaxe de busca do Zimbra).
router.get(
  '/mail/search',
  handle(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ messages: [], more: false });
    res.json(await zimbra.searchMessages(req, q, { limit: req.query.limit || 25 }));
  }),
);

// Contador de não-lidos da Inbox (para o sino).
router.get(
  '/mail/unread',
  handle(async (req, res) => {
    res.json(await zimbra.unreadCount(req));
  }),
);

// Mensagem completa (corpo HTML/texto + anexos). Marca como lida por padrão.
router.get(
  '/mail/messages/:id',
  handle(async (req, res) => {
    const markRead = req.query.markRead !== '0';
    res.json(await zimbra.getMessage(req, req.params.id, { markRead }));
  }),
);

// Ações: marcar lido/não-lido, sinalizar, lixeira, mover, excluir…
// op ∈ read|!read|flag|!flag|trash|spam|move|delete (move exige l=pasta destino)
router.post(
  '/mail/messages/:id/action',
  handle(async (req, res) => {
    const op = String(req.body?.op || '').trim();
    if (!op) return res.status(400).json({ error: 'op obrigatório' });
    res.json(await zimbra.actOnMessage(req, req.params.id, op, req.body?.l));
  }),
);

// Enviar e-mail (novo, resposta ou encaminhamento).
router.post(
  '/mail/send',
  handle(async (req, res) => {
    const { to, cc, bcc, subject, text, html, inReplyTo, attachments, forwardParts } =
      req.body || {};
    if (!to || (Array.isArray(to) && to.length === 0)) {
      return res.status(400).json({ error: 'destinatário (to) obrigatório' });
    }
    res.json(
      await zimbra.sendMessage(req, {
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        inReplyTo,
        attachments,
        forwardParts,
      }),
    );
  }),
);

// Salvar como rascunho (não envia). Mesmo payload do /mail/send.
router.post(
  '/mail/draft',
  handle(async (req, res) => {
    const { to, cc, bcc, subject, text, html, inReplyTo, attachments, forwardParts } =
      req.body || {};
    res.json(
      await zimbra.saveDraft(req, {
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        inReplyTo,
        attachments,
        forwardParts,
      }),
    );
  }),
);

// Upload de anexo para o Zimbra (retorna um `aid` a incluir no /mail/send).
// Recebe os bytes crus no corpo (molde de drive.js). Teto de 25 MB.
const MAIL_ATTACH_MAX_BYTES = 25 * 1024 * 1024;
router.post(
  '/mail/upload',
  express.raw({ type: '*/*', limit: '25mb' }),
  handle(async (req, res) => {
    // Headers podem chegar como array se repetidos — coage a string (type confusion).
    const header = (h) => String((Array.isArray(h) ? h[0] : h) ?? '');
    const filename = decodeURIComponent(header(req.headers['x-filename']) || `anexo_${Date.now()}`);
    const contentType = header(req.headers['x-content-type']) || 'application/octet-stream';
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (!buffer.length) return res.status(400).json({ error: 'Arquivo vazio.' });
    if (buffer.length > MAIL_ATTACH_MAX_BYTES) {
      return res.status(413).json({ error: 'Anexo excede o limite de 25 MB.' });
    }
    res.json(await zimbra.uploadAttachment(req, { filename, contentType, buffer }));
  }),
);

// Compromissos do calendário numa janela [start, end] (epoch ms).
// `raw=1` devolve o JSON cru do Zimbra, para conferir nomes de campo (os do
// slimAppointment foram inferidos, não documentados).
router.get(
  '/mail/calendar',
  handle(async (req, res) => {
    const { start, end, raw } = req.query;
    const isRaw = raw === '1' || raw === 'true';
    const result = await zimbra.listAppointments(req, { start, end, raw: isRaw });
    res.json(isRaw ? { raw: result } : { events: result });
  }),
);

// Criar compromisso/reunião no calendário. Dispara convites por e-mail aos
// participantes (se houver). Body: { subject, start, end, location?, description?,
// attendees?: [{ address, name?, role? }], allDay? }.
router.post(
  '/mail/calendar',
  handle(async (req, res) => {
    const { subject, start, end, location, description, attendees, allDay } = req.body || {};
    res.json(
      await zimbra.createAppointment(req, {
        subject,
        start,
        end,
        location,
        description,
        attendees,
        allDay,
      }),
    );
  }),
);

// Participantes de um compromisso e a resposta de cada um (aceitou/recusou/…).
// Exige uma chamada extra ao Zimbra; o front busca sob demanda ao abrir o evento.
router.get(
  '/mail/calendar/:id/attendees',
  handle(async (req, res) => {
    res.json(await zimbra.getAppointmentAttendees(req, req.params.id));
  }),
);

// Responder convite: aceitar / recusar / talvez.
router.post(
  '/mail/calendar/:id/reply',
  handle(async (req, res) => {
    const { verb, compNum } = req.body || {};
    res.json(await zimbra.replyToInvite(req, { id: req.params.id, verb, compNum }));
  }),
);

// Download de anexo de e-mail: rota PÚBLICA (token ?s=), montada antes do
// authMiddleware em app.js. Ver server/routes/mailAttachment.js.

module.exports = router;
