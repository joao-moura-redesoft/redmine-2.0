import { describe, it, expect } from 'vitest';
import driveRouter from './drive.js';

const { davUrl, xmlEscape } = driveRouter.__testables;

describe('davUrl (path traversal)', () => {
  it('descarta segmentos .. e . e codifica o resto', () => {
    expect(davUrl('../../etc/passwd')).toBe('/remote.php/webdav/etc/passwd');
    expect(davUrl('a/./b/../c')).toBe('/remote.php/webdav/a/b/c');
    expect(davUrl('/leading/slash/')).toBe('/remote.php/webdav/leading/slash');
  });

  it('codifica caracteres especiais no nome', () => {
    expect(davUrl('pasta/arquivo com espaço.txt')).toBe(
      '/remote.php/webdav/pasta/arquivo%20com%20espa%C3%A7o.txt',
    );
  });

  it('caminho vazio vira a raiz do webdav', () => {
    expect(davUrl('')).toBe('/remote.php/webdav/');
    expect(davUrl(null)).toBe('/remote.php/webdav/');
  });
});

describe('xmlEscape (injeção XML na busca WebDAV)', () => {
  it('escapa os cinco caracteres perigosos', () => {
    expect(xmlEscape(`<a>&"'`)).toBe('&lt;a&gt;&amp;&quot;&apos;');
  });

  it('trata null/undefined como string vazia', () => {
    expect(xmlEscape(null)).toBe('');
    expect(xmlEscape(undefined)).toBe('');
  });
});
