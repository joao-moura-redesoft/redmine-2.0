import { describe, it, expect } from 'vitest';
import ncnotesRouter from './ncnotes.js';

const { fromQuickNote, applyNcPatch, isHexColor } = ncnotesRouter.__testables;

describe('fromQuickNote (normalização QuickNotes → shape do front)', () => {
  const raw = {
    id: 141,
    title: 'Nova Nota',
    content: '<p>Teste</p>',
    isPinned: true,
    timestamp: 1783965186,
    color: '#F7EB96',
    tags: [
      { id: 4, name: 'alpha' },
      { id: 5, name: 'beta' },
    ],
    attachments: [],
  };

  it('mapeia campos e prefixa o id com nc:', () => {
    const n = fromQuickNote(raw);
    expect(n.id).toBe('nc:141');
    expect(n.ncId).toBe(141);
    expect(n.source).toBe('nextcloud');
    expect(n.body).toBe('<p>Teste</p>'); // HTML cru — o client converte
    expect(n.pinned).toBe(true); // isPinned → pinned
    expect(n.ncColor).toBe('#F7EB96'); // cor real (hex)
    expect(n.color).toBeNull(); // paleta local não se aplica
    expect(n.tags).toEqual(['alpha', 'beta']); // objetos → nomes
    expect(n.updatedAt).toBe(1783965186 * 1000); // segundos → ms
    expect(n.readonly).toBe(false);
  });

  it('tolera campos ausentes/estranhos', () => {
    const n = fromQuickNote({ id: 9 });
    expect(n).toMatchObject({ id: 'nc:9', ncId: 9, title: '', body: '', tags: [], pinned: false });
    expect(n.ncColor).toBeNull();
    expect(n.updatedAt).toBe(0);
  });

  it('aceita tags já em formato de string', () => {
    expect(fromQuickNote({ id: 1, tags: ['x', 'y'] }).tags).toEqual(['x', 'y']);
  });
});

describe('applyNcPatch (merge do que o client envia sobre a nota completa)', () => {
  const base = () => ({
    id: 141,
    title: 'T',
    content: '<p>a</p>',
    isPinned: false,
    color: '#FFFFFF',
    tags: [{ id: 1, name: 'old' }],
    attachments: [{ id: 7 }], // deve ser preservado
    sharedWith: ['u'], // deve ser preservado
  });

  it('aplica content/title/pino e preserva o resto', () => {
    const n = applyNcPatch(base(), { content: '<p>b</p>', title: 'Novo', pinned: true });
    expect(n.content).toBe('<p>b</p>');
    expect(n.title).toBe('Novo');
    expect(n.isPinned).toBe(true);
    expect(n.attachments).toEqual([{ id: 7 }]); // preservado
    expect(n.sharedWith).toEqual(['u']); // preservado
  });

  it('só aceita cor hex válida', () => {
    expect(applyNcPatch(base(), { color: '#AABBCC' }).color).toBe('#AABBCC');
    expect(applyNcPatch(base(), { color: 'red' }).color).toBe('#FFFFFF'); // ignora inválida
    expect(applyNcPatch(base(), { color: 123 }).color).toBe('#FFFFFF');
  });

  it('converte nomes de tag em [{name}] e descarta vazias', () => {
    const n = applyNcPatch(base(), { tags: ['a', '  b  ', '', '   ', 5] });
    expect(n.tags).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('sem campos no corpo, não altera nada', () => {
    const n = applyNcPatch(base(), {});
    expect(n).toMatchObject({ title: 'T', content: '<p>a</p>', isPinned: false, color: '#FFFFFF' });
    expect(n.tags).toEqual([{ id: 1, name: 'old' }]);
  });

  it('corpo nulo/indefinido é tratado como vazio', () => {
    expect(() => applyNcPatch(base(), null)).not.toThrow();
    expect(() => applyNcPatch(base(), undefined)).not.toThrow();
  });
});

describe('isHexColor', () => {
  it('aceita #RGB, #RRGGBB e #RRGGBBAA', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#AABBCC')).toBe(true);
    expect(isHexColor('#AABBCCDD')).toBe(true);
  });
  it('rejeita não-hex', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#GGG')).toBe(false);
    expect(isHexColor('')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});
