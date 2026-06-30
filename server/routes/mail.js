// E-MAIL — Zimbra via API SOAP (HTTPS). Ver server/zimbra.js.
// Credenciais: reaproveita o login usuário/senha do Redmine (mesma senha AD);
// no modo chave de API, usa os headers x-mail-* (config manual no front).
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const zimbra = require('../zimbra');
const { getSession } = require('../lib/sessions');

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

// Enviar e-mail (novo ou resposta).
router.post(
  '/mail/send',
  handle(async (req, res) => {
    const { to, cc, subject, text, html, inReplyTo } = req.body || {};
    if (!to || (Array.isArray(to) && to.length === 0)) {
      return res.status(400).json({ error: 'destinatário (to) obrigatório' });
    }
    res.json(await zimbra.sendMessage(req, { to, cc, subject, text, html, inReplyTo }));
  }),
);

// Compromissos do calendário numa janela [start, end] (epoch ms).
router.get(
  '/mail/calendar',
  handle(async (req, res) => {
    const { start, end } = req.query;
    res.json({ events: await zimbra.listAppointments(req, { start, end }) });
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

// Download de anexo (proxy autenticado via token de sessão).
// Requests de <img> e <a href> não enviam headers customizados — credenciais
// vêm do token ?s=TOKEN criado em getMessage() e válido por 1 hora.
router.get(
  '/mail/messages/:id/attachments/:part',
  handle(async (req, res) => {
    const session = getSession(req.query.s, 'mail');
    if (!session)
      return res
        .status(401)
        .json({ error: 'Sessão de e-mail inválida ou expirada. Reabra a mensagem.' });
    const { data, contentType } = await zimbra.fetchAttachment(
      session,
      req.params.id,
      req.params.part,
    );
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(data);
  }),
);

module.exports = router;
