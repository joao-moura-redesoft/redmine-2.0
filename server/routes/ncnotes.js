// NOTAS DO NEXTCLOUD (app QuickNotes) — ponte de leitura/edição exibida junto das
// notas locais na mesma interface. Reaproveita a autenticação do Talk/Drive
// (makeTalk → credenciais do cofre por usuário).
//
// Este ambiente usa o app **QuickNotes** (não o app oficial "Notes"). Diferenças que
// moldam a integração:
//   • endpoint: /index.php/apps/quicknotes/notes
//   • `content` é **HTML** (o app Notes usa markdown) → a conversão HTML↔markdown
//     acontece no client (api/ncnotes.ts), que já tem marked+dompurify.
//   • `title` é um campo separado do conteúdo (o app Notes deriva da 1ª linha).
//   • cor é hex (#RRGGBB); pino é `isPinned`; sem etag (concorrência = last-write-wins).
//   • o PUT exige o **objeto completo** da nota — por isso o update busca a nota
//     atual, mescla os campos alterados e reenvia tudo (preserva tags/anexos/shares).
//
// Modelo assimétrico com as notas locais: QuickNotes não tem vínculo com tarefa nem a
// paleta de cores local. O bridge (import/push) é unidirecional. Ver routes/notes.js.
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const { makeTalk } = require('../services/talk');

const QN = '/index.php/apps/quicknotes/notes';
const MAX_CONTENT = 1_000_000; // teto de corpo por nota (1 MB)
const DEFAULT_COLOR = '#F7EB96'; // amarelo padrão do QuickNotes (notas criadas pelo bridge)

// Normaliza uma nota do QuickNotes para o shape usado no front. `body` sai como HTML
// cru — o client converte para markdown (o editor trabalha com markdown).
function fromQuickNote(n) {
  const ms = (Number(n.timestamp) || 0) * 1000;
  return {
    id: `nc:${n.id}`,
    ncId: Number(n.id),
    title: typeof n.title === 'string' ? n.title : '',
    body: typeof n.content === 'string' ? n.content : '', // HTML — convertido no client
    contentFormat: 'html',
    tags: Array.isArray(n.tags)
      ? n.tags.map((t) => (t && typeof t === 'object' ? t.name : t)).filter(Boolean)
      : [],
    pinned: !!n.isPinned,
    color: null, // paleta local não se aplica
    ncColor: typeof n.color === 'string' ? n.color : null, // cor real (hex) do QuickNotes
    linkedIssueId: null,
    linkedProjectId: null,
    category: '',
    etag: '',
    readonly: false,
    source: 'nextcloud',
    createdAt: ms,
    updatedAt: ms,
  };
}

async function fetchAll(talk) {
  const { data } = await talk.get(QN);
  return Array.isArray(data) ? data : [];
}

// ─── Listar ────────────────────────────────────────────────────────────────────
router.get(
  '/ncnotes',
  handle(async (req, res) => {
    const talk = await makeTalk(req);
    try {
      const notes = (await fetchAll(talk)).map(fromQuickNote);
      notes.sort((a, b) => b.updatedAt - a.updatedAt);
      res.json(notes);
    } catch (e) {
      // App QuickNotes ausente (404) → simplesmente não há notas do Nextcloud a mostrar.
      if (e.response?.status === 404) return res.json([]);
      throw e;
    }
  }),
);

// ─── Atualizar (title, content, pino, cor e/ou tags) ────────────────────────────
// O QuickNotes exige o objeto inteiro no PUT; buscamos a nota atual, mesclamos só os
// campos enviados e reenviamos — preservando o resto (anexos/compartilhamentos).
router.put(
  '/ncnotes/:id',
  handle(async (req, res) => {
    const ncId = String(req.params.id || '');
    if (!/^\d+$/.test(ncId)) return res.status(400).json({ error: 'id inválido.' });
    const b = req.body || {};
    if (typeof b.content === 'string' && b.content.length > MAX_CONTENT)
      return res.status(413).json({ error: 'Nota maior que 1 MB.' });

    const talk = await makeTalk(req);
    const note = (await fetchAll(talk)).find((n) => String(n.id) === ncId);
    if (!note) return res.status(404).json({ error: 'nota não encontrada' });

    if (typeof b.content === 'string') note.content = b.content; // HTML vindo do client
    if (typeof b.title === 'string') note.title = b.title;
    if (typeof b.pinned === 'boolean') note.isPinned = b.pinned;
    if (typeof b.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(b.color)) note.color = b.color;
    // Tags: o client envia nomes (string[]); o QuickNotes cria/associa por nome ao
    // receber [{name}] no objeto completo (ids são resolvidos pelo servidor).
    if (Array.isArray(b.tags))
      note.tags = b.tags
        .filter((t) => typeof t === 'string' && t.trim())
        .map((name) => ({ name: name.trim() }));

    const { data } = await talk.put(`${QN}/${encodeURIComponent(ncId)}`, note);
    res.json(fromQuickNote(data));
  }),
);

// ─── Excluir ─────────────────────────────────────────────────────────────────────
router.delete(
  '/ncnotes/:id',
  handle(async (req, res) => {
    const ncId = String(req.params.id || '');
    if (!/^\d+$/.test(ncId)) return res.status(400).json({ error: 'id inválido.' });
    await (await makeTalk(req)).delete(`${QN}/${encodeURIComponent(ncId)}`);
    res.json({ ok: true });
  }),
);

// ─── Bridge: criar uma nota no Nextcloud a partir de uma nota local (push) ───────
// `content` já chega como HTML (convertido de markdown no client).
router.post(
  '/ncnotes/from-local',
  handle(async (req, res) => {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body.content === 'string' ? req.body.content : '';
    if (!title && !content.trim()) return res.status(400).json({ error: 'Nota vazia.' });
    if (content.length > MAX_CONTENT)
      return res.status(413).json({ error: 'Nota maior que 1 MB.' });
    const { data } = await (
      await makeTalk(req)
    ).post(QN, { title: title || 'Nova nota', content, color: DEFAULT_COLOR });
    res.json(fromQuickNote(data));
  }),
);

module.exports = router;
