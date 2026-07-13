import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from './ncNoteHtml';

describe('htmlToMarkdown', () => {
  it('parágrafo simples', () => {
    expect(htmlToMarkdown('<p>Teste</p>')).toBe('Teste');
  });

  it('negrito, itálico, tachado e código inline', () => {
    expect(htmlToMarkdown('<p><strong>a</strong> <em>b</em></p>')).toBe('**a** *b*');
    expect(htmlToMarkdown('<p><s>x</s> <code>y</code></p>')).toBe('~~x~~ `y`');
  });

  it('títulos', () => {
    expect(htmlToMarkdown('<h1>A</h1>')).toBe('# A');
    expect(htmlToMarkdown('<h2>B</h2>')).toBe('## B');
    expect(htmlToMarkdown('<h3>C</h3>')).toBe('### C');
  });

  it('links e imagens', () => {
    expect(htmlToMarkdown('<p><a href="http://x">t</a></p>')).toBe('[t](http://x)');
    expect(htmlToMarkdown('<img src="u.png" alt="alt">')).toBe('![alt](u.png)');
  });

  it('listas simples e ordenadas', () => {
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
    expect(htmlToMarkdown('<ol><li>x</li><li>y</li></ol>')).toBe('1. x\n2. y');
  });

  it('lista aninhada indenta a sublista', () => {
    expect(htmlToMarkdown('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe('- a\n  - b');
  });

  it('citação', () => {
    expect(htmlToMarkdown('<blockquote><p>q</p></blockquote>')).toBe('> q');
  });

  it('regra horizontal entre parágrafos', () => {
    expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb');
  });

  it('tabela vira GFM', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    expect(htmlToMarkdown(html)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('limitação conhecida: cor inline é descartada, texto preservado', () => {
    expect(htmlToMarkdown('<p>a <span style="color:red">b</span> c</p>')).toBe('a b c');
  });

  it('string vazia', () => {
    expect(htmlToMarkdown('')).toBe('');
  });
});

describe('markdownToHtml', () => {
  it('gera HTML e sanitiza', () => {
    expect(markdownToHtml('**a**')).toContain('<strong>a</strong>');
    expect(markdownToHtml('# T')).toContain('<h1>T</h1>');
  });

  it('remove script (sanitização)', () => {
    expect(markdownToHtml('<script>alert(1)</script>ok')).not.toContain('<script>');
  });
});

describe('round-trip markdown → HTML → markdown', () => {
  const cases = [
    '**negrito**',
    '*itálico*',
    '## Título',
    '- a\n- b',
    '1. x\n2. y',
    '[link](http://x)',
    '> citação',
    'a\n\n---\n\nb',
    '- a\n  - b',
  ];
  it.each(cases)('estável para: %s', (md) => {
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
  });
});
