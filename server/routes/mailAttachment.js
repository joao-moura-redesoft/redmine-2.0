// Download de anexo de e-mail (proxy autenticado) — rota PÚBLICA de propósito.
//
// Esta rota é montada ANTES do authMiddleware (ver app.js): requisições de <img>
// e <a href> disparadas pelo corpo do e-mail renderizado num iframe sandbox NÃO
// carregam o cookie de sessão (origem opaca do iframe + SameSite=Lax). Por isso a
// autenticação aqui vem do token ?s=TOKEN, emitido em getMessage() (que está atrás
// do authMiddleware) e válido por 1h, vinculado às credenciais de e-mail.
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const zimbra = require('../zimbra');
const { getSession } = require('../lib/sessions');

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
    // O corpo do e-mail é renderizado num iframe sandbox SEM allow-same-origin, ou
    // seja, com origem opaca (null). O Helmet marca as respostas como CORP
    // 'same-origin' por padrão, o que faz o navegador BLOQUEAR a imagem (origem
    // null != mesma origem). Liberamos cross-origin só aqui — a rota já exige o
    // token ?s=, então não amplia a superfície de ataque.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  }),
);

module.exports = router;
