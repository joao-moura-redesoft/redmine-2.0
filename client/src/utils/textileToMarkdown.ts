/**
 * Converte Textile (formato que o Redmine desta instância retorna: h1. h2.,
 * *negrito*, _itálico_, @código@, "texto":url, listas com * e #, <pre>) para
 * Markdown, para ser renderizado pelo componente <Markdown>. Cobre os casos
 * comuns; é o inverso aproximado de markdownToTextile.
 *
 * Imagens (!arquivo.png!) NÃO são tocadas aqui — o preprocess do componente
 * Markdown já resolve a sintaxe Textile de imagem contra os anexos.
 */
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

  // 3) Transformações por linha (cabeçalhos, citações, listas)
  s = s.split('\n').map(line => {
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
  }).join('\n');

  // 4) Links "texto":url -> [texto](url)
  s = s.replace(/"([^"]+)":(\S+)/g, '[$1]($2)');

  // 5) Negrito *x* -> **x** (negrito do Textile). Evita casar marcador de lista
  //    (já convertido para "- ") e ** de markdown.
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1**$2**');

  // 6) Itálico _x_ permanece igual em Markdown (nada a fazer).

  // 7) Restaura código inline @x@ -> `x`
  s = s.replace(/ I(\d+) /g, (_, i: string) => `\`${inlines[+i]}\``);
  // 8) Restaura blocos <pre> -> cercado por ```
  s = s.replace(/ B(\d+) /g, (_, i: string) => `\n\`\`\`\n${blocks[+i]}\n\`\`\`\n`);

  return s;
}
