// Armazenamento em arquivo com criptografia em repouso.
//
// Estratégia: uma CHAVE simétrica é derivada UMA vez no boot (protegida por
// Windows DPAPI, escopo CurrentUser) e mantida em memória; toda leitura/escrita
// usa AES-256-GCM nativo do Node. Antes, cada gravação spawnava um processo
// PowerShell para o DPAPI — o que congelava o event loop (~50-200ms) a cada
// save de sessão/segredo/estado. Agora o PowerShell roda no máximo uma vez por
// boot (para desembrulhar a chave).
//
// Compatibilidade: arquivos antigos no formato { __dpapi } continuam legíveis
// (desembrulhados via PowerShell sob demanda) e são reconvertidos para o novo
// formato { __gcm } na próxima gravação. Texto puro também é aceito (legado).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { DATA_DIR } = require('./runtime');

const dataFile = (name) => path.join(DATA_DIR, name);

// Escrita atômica: grava num .tmp e renomeia, pra nunca deixar o arquivo pela metade.
function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const IS_WINDOWS = process.platform === 'win32';

function runPowerShell(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `powershell saiu com código ${r.status}`);
  return (r.stdout || '').trim();
}

// ── DPAPI (usado só para embrulhar/desembrulhar a CHAVE do cofre, e ler blobs
//    legados) — não é mais chamado por gravação de dado. ────────────────────
function dpapiProtect(plaintext) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$inB64 = [Console]::In.ReadToEnd()',
    '$bytes = [Convert]::FromBase64String($inB64)',
    '$prot = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($prot)',
  ].join('; ');
  return runPowerShell(script, Buffer.from(plaintext, 'utf8').toString('base64'));
}

function dpapiUnprotect(b64blob) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$inB64 = [Console]::In.ReadToEnd()',
    '$bytes = [Convert]::FromBase64String($inB64)',
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($plain)',
  ].join('; ');
  return Buffer.from(runPowerShell(script, b64blob), 'base64').toString('utf8');
}

// ── AES-256-GCM nativo ──────────────────────────────────────────────────────
function gcmEncrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    __gcm: {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    },
  };
}

function gcmDecrypt(key, blob) {
  const iv = Buffer.from(blob.iv, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

// ── Chave do cofre: carregada UMA vez no boot ───────────────────────────────
// - BLUEMINE_VAULT_KEY (base64 de 32 bytes) tem prioridade: para dev/CI e testes
//   fora do Windows, sem depender de DPAPI.
// - No Windows, a chave fica em vault-key.json (protegida por DPAPI). Se o arquivo
//   existir mas não abrir, NÃO geramos outra (isso orfanaria os dados já cifrados)
//   — retornamos null para permitir recuperação manual da chave.
const KEY_FILE = dataFile('vault-key.json');

function loadVaultKey() {
  const envKey = process.env.BLUEMINE_VAULT_KEY;
  if (envKey) {
    const k = Buffer.from(envKey, 'base64');
    if (k.length === 32) return k;
    console.warn(
      '[secureStore] BLUEMINE_VAULT_KEY inválida (esperado 32 bytes base64) — ignorando',
    );
  }
  if (!IS_WINDOWS) return null; // sem DPAPI e sem env key → sem cofre

  if (fs.existsSync(KEY_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      const k = Buffer.from(dpapiUnprotect(parsed.__dpapi), 'base64');
      if (k.length === 32) return k;
      throw new Error('tamanho de chave inesperado');
    } catch (e) {
      // Existe mas falhou: preservar (não sobrescrever) para não orfanar dados.
      console.error(
        `[secureStore] chave do cofre (${KEY_FILE}) ilegível: ${e.message}. ` +
          'Dados cifrados ficam inacessíveis até restaurá-la; nenhuma chave nova foi gerada.',
      );
      return null;
    }
  }

  // Primeira vez: gera e persiste (uma chamada de PowerShell, no boot).
  try {
    const k = crypto.randomBytes(32);
    writeFileAtomic(
      KEY_FILE,
      JSON.stringify({ __dpapi: dpapiProtect(k.toString('base64')) }, null, 2),
    );
    return k;
  } catch (e) {
    console.warn('[secureStore] DPAPI indisponível para gerar a chave do cofre:', e.message);
    return null;
  }
}

const vaultKey = loadVaultKey();

// ── API pública (interface inalterada) ──────────────────────────────────────

// Lê JSON. Formatos aceitos, em ordem: { __gcm } (novo), { __dpapi } (legado,
// desembrulhado sob demanda), ou texto puro.
function readJsonSecure(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (parsed && parsed.__gcm) {
      if (!vaultKey) {
        console.warn(
          `[secureStore] sem chave do cofre — não foi possível ler ${path.basename(file)}`,
        );
        return fallback;
      }
      return JSON.parse(gcmDecrypt(vaultKey, parsed.__gcm));
    }

    if (parsed && typeof parsed.__dpapi === 'string') {
      if (!IS_WINDOWS) {
        console.warn('[secureStore] arquivo DPAPI legado fora do Windows — ignorando');
        return fallback;
      }
      return JSON.parse(dpapiUnprotect(parsed.__dpapi)); // convertido a __gcm na próxima gravação
    }

    return parsed; // texto puro (legado / dados não sensíveis)
  } catch {
    return fallback;
  }
}

// Grava JSON. Com a chave do cofre disponível, cifra com AES-256-GCM (sem
// PowerShell). Sem a chave: requireEncryption recusa (a menos de
// ALLOW_PLAINTEXT_SECRETS=1); caso contrário grava texto puro (comportamento
// legado para dados não sensíveis, como cache de notificações).
function writeJsonSecure(file, data, opts = {}) {
  const requireEncryption = !!opts.requireEncryption;

  if (vaultKey) {
    writeFileAtomic(file, JSON.stringify(gcmEncrypt(vaultKey, JSON.stringify(data)), null, 2));
    return;
  }

  if (requireEncryption && process.env.ALLOW_PLAINTEXT_SECRETS !== '1') {
    throw new Error(
      `Sem chave do cofre: gravação de segredos em texto puro recusada para ${path.basename(file)}. ` +
        'No Windows isso indica falha do DPAPI; defina ALLOW_PLAINTEXT_SECRETS=1 para permitir em dev.',
    );
  }

  try {
    writeFileAtomic(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[secureStore] falha ao gravar', file, e.message);
  }
}

module.exports = {
  DATA_DIR,
  dataFile,
  writeFileAtomic,
  runPowerShell,
  readJsonSecure,
  writeJsonSecure,
  IS_WINDOWS,
  // exportados para teste da camada de cifra (independente da fonte da chave)
  _gcmEncrypt: gcmEncrypt,
  _gcmDecrypt: gcmDecrypt,
};
