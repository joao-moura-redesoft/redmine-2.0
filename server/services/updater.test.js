import { describe, it, expect } from 'vitest';
import updater from './updater.js';

const { compareVersions, parseManifest, parseGithubRelease, parseSha256Sums } = updater;

describe('compareVersions', () => {
  it('ordena numericamente (não lexicograficamente)', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });
  it('trata versões iguais e comprimentos diferentes', () => {
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });
  it('ignora sufixo de pré-release', () => {
    expect(compareVersions('1.2.0-beta', '1.2.0')).toBe(0);
  });
});

describe('parseManifest', () => {
  it('aceita um manifesto válido e normaliza o sha', () => {
    const m = parseManifest({
      version: '1.2.0',
      url: 'https://ti.local/bluemine.exe',
      sha256: 'AB12CD',
      notes: 'x',
    });
    expect(m.version).toBe('1.2.0');
    expect(m.sha256).toBe('ab12cd');
    expect(m.notes).toBe('x');
  });
  it('rejeita versão inválida', () => {
    expect(() => parseManifest({ version: 'x', url: 'https://a/b' })).toThrow();
  });
  it('rejeita url não-http', () => {
    expect(() => parseManifest({ version: '1.0.0', url: 'file:///etc/passwd' })).toThrow();
  });
  it('rejeita entrada não-objeto', () => {
    expect(() => parseManifest(null)).toThrow();
  });
});

describe('parseGithubRelease', () => {
  const release = {
    tag_name: 'v1.3.0',
    body: 'Notas do release',
    assets: [
      {
        name: 'bluemine.exe',
        url: 'https://api.github.com/repos/o/r/releases/assets/1',
        browser_download_url: 'https://github.com/o/r/releases/download/v1.3.0/bluemine.exe',
        digest: 'sha256:AAAA000000000000000000000000000000000000000000000000000000000000',
      },
      {
        name: 'SHA256SUMS',
        url: 'https://api.github.com/repos/o/r/releases/assets/2',
        browser_download_url: 'https://github.com/o/r/releases/download/v1.3.0/SHA256SUMS',
      },
    ],
  };

  it('extrai versão (sem o v), notas, asset .exe e SHA256SUMS', () => {
    const r = parseGithubRelease(release);
    expect(r.version).toBe('1.3.0');
    expect(r.notes).toBe('Notas do release');
    expect(r.exe.name).toBe('bluemine.exe');
    expect(r.exe.digest).toBe('aaaa000000000000000000000000000000000000000000000000000000000000');
    expect(r.sums.name).toBe('SHA256SUMS');
  });

  it('lança se não houver asset .exe', () => {
    expect(() => parseGithubRelease({ tag_name: 'v1.0.0', assets: [] })).toThrow();
  });

  it('lança em tag sem versão válida', () => {
    expect(() => parseGithubRelease({ tag_name: 'latest', assets: [] })).toThrow();
  });
});

describe('buildWatchdogScript', () => {
  const script = updater.buildWatchdogScript({
    exe: 'C:\\app\\bluemine.exe',
    staged: 'C:\\app\\bluemine.exe.new',
    bak: 'C:\\app\\bluemine.exe.bak',
    marker: 'C:\\app\\.bluemine-boot-ok',
    newVersion: '1.4.0',
    timeoutSec: 25,
  });
  it('faz backup, instala a nova e relança', () => {
    expect(script).toContain('Copy-Item -Force -LiteralPath $exe -Destination $bak');
    expect(script).toContain('Move-Item -Force -LiteralPath $staged -Destination $exe');
    expect(script).toContain('Start-Process -FilePath $exe');
  });
  it('inclui a verificação do marcador e o ramo de rollback', () => {
    expect(script).toContain('1.4.0');
    expect(script).toContain('Start-Sleep -Seconds 25');
    expect(script).toContain('Move-Item -Force -LiteralPath $bak -Destination $exe'); // rollback
    expect(script).toContain('Stop-Process -Id $proc.Id -Force');
  });
});

describe('parseSha256Sums', () => {
  const text = `deadbeef${'0'.repeat(56)}  outro.exe\nabc123${'0'.repeat(58)} *bluemine.exe\n`;
  it('acha o hash pelo nome do arquivo (com ou sem *)', () => {
    expect(parseSha256Sums(text, 'bluemine.exe')).toBe(`abc123${'0'.repeat(58)}`);
  });
  it('devolve null se o arquivo não estiver listado', () => {
    expect(parseSha256Sums(text, 'inexistente.exe')).toBeNull();
  });
});
