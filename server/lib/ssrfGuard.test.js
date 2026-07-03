import { describe, it, expect } from 'vitest';
import ssrf from './ssrfGuard.js';

const { isPrivateIp } = ssrf;

describe('isPrivateIp', () => {
  it('bloqueia faixas IPv4 internas/reservadas', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '0.0.0.0',
      '172.16.0.5',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // metadata de nuvem
      '100.64.0.1', // CGNAT
      '224.0.0.1', // multicast
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('permite IPs públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('bloqueia IPv6 interno e IPv4 mapeado', () => {
    for (const ip of [
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12::1',
      'ff02::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('trata entrada inválida/vazia como insegura', () => {
    expect(isPrivateIp('')).toBe(true);
    expect(isPrivateIp(null)).toBe(true);
    expect(isPrivateIp('999.1.1.1')).toBe(true);
  });
});
