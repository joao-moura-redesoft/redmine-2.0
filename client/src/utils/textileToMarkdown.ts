/**
 * Converte Textile (formato que o Redmine desta instância retorna: h1. h2.,
 * *negrito*, _itálico_, @código@, "texto":url, listas com * e #, <pre>) para
 * Markdown, para ser renderizado pelo componente <Markdown>. Cobre os casos
 * comuns; é o inverso aproximado de markdownToTextile.
 *
 * Imagens (!arquivo.png!) NÃO são tocadas aqui — o preprocess do componente
 * Markdown já resolve a sintaxe Textile de imagem contra os anexos.
 */
// Uma linha de tabela Textile: começa e termina com `|` (ex.: `|_. H |_. H |`).
const TEXTILE_ROW_RE = /^\s*\|.*\|\s*$/;

// Quebra uma linha de tabela em células, removendo os `|` das bordas.
function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

// Remove o modificador de célula Textile do início (`_.` cabeçalho, `<. >. =.`
// alinhamento, `^. ~.` valign), deixando só o conteúdo.
function stripCellMod(cell: string): string {
  return cell.replace(/^\s*[\^<>=~_]*\.\s*/, '').trim();
}

// Converte tabelas Textile em tabelas Markdown GFM: a 1ª linha vira cabeçalho,
// insere a linha separadora `| --- | --- |` (sem ela o marked não reconhece a
// tabela) e limpa os modificadores de célula de todas as linhas.
function convertTextileTables(s: string): string {
  const lines = s.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TEXTILE_ROW_RE.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && TEXTILE_ROW_RE.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    i--; // o for() volta a incrementar
    const rows = block.map(splitCells);
    const ncol = Math.max(...rows.map((r) => r.length));
    const pad = (cells: string[]) => {
      const c = cells.map(stripCellMod);
      while (c.length < ncol) c.push('');
      return '| ' + c.join(' | ') + ' |';
    };
    out.push(pad(rows[0]));
    out.push('| ' + Array(ncol).fill('---').join(' | ') + ' |');
    for (const r of rows.slice(1)) out.push(pad(r));
  }
  return out.join('\n');
}

export function textileToMarkdown(tx: string): string {
  if (!tx) return '';
  let s = tx.replace(/\r\n/g, '\n');

  // 1) Protege blocos <pre>...</pre> (Redmine usa para código/literal)
  const blocks: string[] = [];
  s = s.replace(/<pre>\n?([\s\S]*?)\n?<\/pre>/gi, (_, code: string) => {
    blocks.push(code.replace(/\n+$/, ''));
    return ` B${blocks.length - 1} `;
  });

  // 2) Protege código inline @x@
  const inlines: string[] = [];
  s = s.replace(/@([^@\n]+)@/g, (_, c: string) => {
    inlines.push(c);
    return ` I${inlines.length - 1} `;
  });

  // 2.5) Tabelas Textile -> Markdown GFM (precisa da linha separadora p/ o marked).
  s = convertTextileTables(s);

  // 3) Transformações por linha (cabeçalhos, citações, listas)
  s = s
    .split('\n')
    .map((line) => {
      const h = line.match(/^h([1-6])\.\s+(.*)$/);
      if (h) return `${'#'.repeat(+h[1])} ${h[2]}`;
      if (/^bq\.\s?/.test(line)) return line.replace(/^bq\.\s?/, '> ');
      // Lista não ordenada: * / ** / *** → -, com indentação por nível
      const ul = line.match(/^(\*+)\s+(.*)$/);
      if (ul) return `${'  '.repeat(ul[1].length - 1)}- ${ul[2]}`;
      // Lista ordenada: # / ## → 1. (marked renumera sequencialmente)
      const ol = line.match(/^(#+)\s+(.*)$/);
      if (ol) return `${'  '.repeat(ol[1].length - 1)}1. ${ol[2]}`;
      return line;
    })
    .join('\n');

  // 4) Links "texto":url -> [texto](url)
  s = s.replace(/"([^"]+)":(\S+)/g, '[$1]($2)');

  // 5) Negrito *x* -> **x** (negrito do Textile). Evita casar marcador de lista
  //    (já convertido para "- ") e ** de markdown. Move espaços internos para fora
  //    dos delimitadores — em Markdown "**TIPO **" com espaço colado não vira negrito.
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, (m, pre: string, content: string) => {
    const lead = content.match(/^\s*/)![0];
    const trail = content.match(/\s*$/)![0];
    const core = content.slice(lead.length, content.length - trail.length);
    return core ? `${pre}${lead}**${core}**${trail}` : m;
  });

  // 6) Itálico _x_ permanece igual em Markdown (nada a fazer).

  // 7) Restaura código inline @x@ -> `x`
  s = s.replace(/ I(\d+) /g, (_, i: string) => `\`${inlines[+i]}\``);
  // 8) Restaura blocos <pre> -> cercado por ```
  s = s.replace(/ B(\d+) /g, (_, i: string) => `\n\`\`\`\n${blocks[+i]}\n\`\`\`\n`);

  return s;
}
