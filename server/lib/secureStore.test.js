import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A chave do cofre precisa existir ANTES do módulo carregar (ela é lida no boot).
// Com a env key, a camada AES é exercida sem depender do DPAPI/Windows.
const KEY = Buffer.alloc(32, 7).toString('base64');
process.env.BLUEMINE_VAULT_KEY = KEY;

let store;
let dir;
const tmp = (name) => path.join(dir, name);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'securestore-'));
  store = await import('./secureStore.js');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('AES-256-GCM (camada de cifra)', () => {
  it('faz roundtrip de um texto', () => {
    const key = Buffer.alloc(32, 3);
    const blob = store._gcmEncrypt(key, 'olá, mundo');
    expect(store._gcmDecrypt(key, blob.__gcm)).toBe('olá, mundo');
  });

  it('falha a decifrar com chave errada (autenticação GCM)', () => {
    const blob = store._gcmEncrypt(Buffer.alloc(32, 3), 'segredo');
    expect(() => store._gcmDecrypt(Buffer.alloc(32, 9), blob.__gcm)).toThrow();
  });

  it('usa IV aleatório: dois ciphertexts do mesmo texto diferem', () => {
    const key = Buffer.alloc(32, 3);
    const a = store._gcmEncrypt(key, 'x');
    const b = store._gcmEncrypt(key, 'x');
    expect(a.__gcm.ct + a.__gcm.iv).not.toBe(b.__gcm.ct + b.__gcm.iv);
  });
});

describe('readJsonSecure / writeJsonSecure', () => {
  it('roundtrip de um objeto, gravando no formato __gcm cifrado', () => {
    const file = tmp('a.json');
    const data = { user: 'jotaven', nums: [1, 2, 3], nested: { ok: true } };
    store.writeJsonSecure(file, data, { requireEncryption: true });

    // Em disco está cifrado — o conteúdo não aparece em texto puro.
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toContain('__gcm');
    expect(raw).not.toContain('jotaven');

    expect(store.readJsonSecure(file, null)).toEqual(data);
  });

  it('lê texto puro legado (arquivo não cifrado)', () => {
    const file = tmp('plain.json');
    fs.writeFileSync(file, JSON.stringify({ legacy: true }));
    expect(store.readJsonSecure(file, null)).toEqual({ legacy: true });
  });

  it('devolve o fallback quando o arquivo não existe', () => {
    expect(store.readJsonSecure(tmp('nao-existe.json'), { d: 1 })).toEqual({ d: 1 });
  });

  it('devolve o fallback quando o __gcm está corrompido (tag inválida)', () => {
    const file = tmp('corrupt.json');
    store.writeJsonSecure(file, { x: 1 }, { requireEncryption: true });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.__gcm.tag = Buffer.alloc(16, 0).toString('base64'); // tag errada
    fs.writeFileSync(file, JSON.stringify(parsed));
    expect(store.readJsonSecure(file, 'FALLBACK')).toBe('FALLBACK');
  });
});
