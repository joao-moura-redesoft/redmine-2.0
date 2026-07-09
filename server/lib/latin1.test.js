import { describe, it, expect } from 'vitest';
import { toLatin1Safe, sanitizeIssueBody } from './latin1.js';

describe('toLatin1Safe', () => {
  it('mapeia simbolos comuns para ASCII', () => {
    expect(toLatin1Safe('a — b')).toBe('a - b'); // em dash
    expect(toLatin1Safe('a → b')).toBe('a -> b'); // right arrow
    expect(toLatin1Safe('⚠️ aviso')).toBe('(!) aviso'); // warning + VS16
    expect(toLatin1Safe('feito ✅')).toBe('feito [OK]'); // check
    expect(toLatin1Safe('“x” e ‘y’')).toBe('"x" e \'y\''); // curly quotes
    expect(toLatin1Safe('espere…')).toBe('espere...'); // ellipsis
  });

  it('preserva acentos do portugues, quebras de linha e tabs', () => {
    const s = 'ação é útil\nlinha2\ttab';
    expect(toLatin1Safe(s)).toBe(s);
  });

  it('remove qualquer caractere fora do latin1 (BMP e astral)', () => {
    expect(toLatin1Safe('x\u{1D4E4}y')).toBe('xy'); // astral (surrogate pair)
    expect(toLatin1Safe('xあy')).toBe('xy'); // hiragana (BMP > U+00FF)
    const out = toLatin1Safe('—→✅\u{1F600}texto');
    expect([...out].every((c) => c.codePointAt(0) <= 0xff)).toBe(true);
  });

  it('nao altera entrada nao-string', () => {
    expect(toLatin1Safe(undefined)).toBe(undefined);
    expect(toLatin1Safe('')).toBe('');
  });
});

describe('sanitizeIssueBody', () => {
  it('sanitiza notes/description/subject in-place e ignora outros campos', () => {
    const body = { issue: { notes: 'a — b', description: 'x ✅', subject: 'p→q', status_id: 5 } };
    sanitizeIssueBody(body);
    expect(body.issue).toEqual({
      notes: 'a - b',
      description: 'x [OK]',
      subject: 'p->q',
      status_id: 5,
    });
  });

  it('tolera corpo sem issue', () => {
    expect(sanitizeIssueBody({})).toEqual({});
    expect(sanitizeIssueBody(undefined)).toBe(undefined);
  });
});
