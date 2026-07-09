// Guarda latin1 para texto enviado ao Redmine.
//
// O banco desta instancia do Redmine e latin1 e devolve 500 (Internal Server
// Error) ao receber qualquer caractere acima de U+00FF -- em-dash, setas, aspas
// curvas, emojis etc. O cliente ja sanitiza ao converter Markdown->Textile
// (client/src/utils/markdownToTextile.ts), mas nem todo caminho de escrita passa
// por la (notas de decisao de revisao, edicao de comentario). Esta guarda no
// servidor fecha todos os caminhos: mapeia os simbolos comuns para equivalentes
// ASCII e remove o restante fora do intervalo latin1. Mantenha os mapeamentos
// em sincronia com markdownToTextile.

// Mapeamentos por code point (evita depender de bytes de origem do arquivo).
const CP = (n) => String.fromCodePoint(n);
const REPLACEMENTS = [
  [CP(0x2014), '-'], // em dash
  [CP(0x2013), '-'], // en dash
  [CP(0x2194), '<->'], // left-right arrow
  [CP(0x2192), '->'], // right arrow
  [CP(0x201c), '"'], // left double quote
  [CP(0x201d), '"'], // right double quote
  [CP(0x2018), "'"], // left single quote
  [CP(0x2019), "'"], // right single quote
  [CP(0x2026), '...'], // ellipsis
  [CP(0x2705), '[OK]'], // check mark button
  [CP(0x274c), '[X]'], // cross mark
];
// Aviso: base U+26A0 com seletor de variacao opcional U+FE0F.
const WARN_RE = new RegExp(CP(0x26a0) + CP(0xfe0f) + '?', 'g');
// Rede de seguranca: qualquer caractere fora do latin1 (> U+00FF). Preserva
// controle (\n, \t) e acentos do portugues (todos <= U+00FF).
const NON_LATIN1_RE = /[Ā-\u{10FFFF}]/gu;

function toLatin1Safe(str) {
  if (typeof str !== 'string' || !str) return str;
  let s = str.replace(WARN_RE, '(!)');
  for (const [from, to] of REPLACEMENTS) s = s.split(from).join(to);
  s = s.replace(NON_LATIN1_RE, '');
  return s;
}

// Sanitiza in-place os campos de texto de um corpo { issue: { ... } } do Redmine.
function sanitizeIssueBody(body) {
  const issue = body && body.issue;
  if (!issue || typeof issue !== 'object') return body;
  for (const field of ['notes', 'description', 'subject']) {
    if (typeof issue[field] === 'string') issue[field] = toLatin1Safe(issue[field]);
  }
  return body;
}

module.exports = { toLatin1Safe, sanitizeIssueBody };
