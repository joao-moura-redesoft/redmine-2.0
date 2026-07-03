import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateTOTP, totpRemaining } from './totp.js';

// Vetor da RFC 6238 (SHA1): semente ASCII "12345678901234567890" em base32.
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

afterEach(() => vi.useRealTimers());

describe('generateTOTP', () => {
  it('reproduz o vetor de teste da RFC 6238 em T=59s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000); // 59s → contador 1 → código 287082
    expect(generateTOTP(SEED)).toBe('287082');
  });

  it('sempre retorna 6 dígitos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_111_111_109_000);
    expect(generateTOTP(SEED)).toMatch(/^\d{6}$/);
  });
});

describe('totpRemaining', () => {
  it('conta os segundos até o fim da janela de 30s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000); // 59 % 30 = 29 → faltam 1s
    expect(totpRemaining()).toBe(1);
  });
});
