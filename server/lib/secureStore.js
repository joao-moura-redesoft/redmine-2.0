// Armazenamento em arquivo com criptografia em repouso via Windows DPAPI.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// Pasta gravável: ao lado do .exe quando empacotado (pkg), senão a pasta do server.
// (__dirname aqui é server/lib, então sobe um nível para server/.)
const DATA_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const dataFile = (name) => path.join(DATA_DIR, name);

// Escrita atômica: grava num .tmp e renomeia, pra nunca deixar o arquivo pela metade.
function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// ── Criptografia em repouso via Windows DPAPI (escopo CurrentUser) ─────────
// Liga a criptografia à conta Windows logada: só aquele usuário, naquela
// máquina, descriptografa — sem gerenciar senha. Mesmo nível do localStorage
// do navegador (que é o teto realista aqui). Fora do Windows ou se o DPAPI
// falhar, cai pra texto puro com aviso, pra nunca quebrar o boot.
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

// Lê JSON, descriptografando se estiver no formato { __dpapi }. Aceita texto
// puro também (compat com arquivos antigos / fallback).
function readJsonSecure(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.__dpapi === 'string') {
      if (!IS_WINDOWS) {
        console.warn('[push] arquivo cifrado com DPAPI fora do Windows — ignorando');
        return fallback;
      }
      return JSON.parse(dpapiUnprotect(parsed.__dpapi));
    }
    return parsed;
  } catch {
    return fallback;
  }
}

// Grava JSON cifrado com DPAPI.
//
// opts.requireEncryption=true → NUNCA grava em texto puro. Se o DPAPI falhar,
// lança um erro em vez de degradar silenciosamente a confidencialidade (usado
// para o cofre de segredos e as sessões, que guardam senhas/chaves/sementes).
// Para destravar em ambientes sem DPAPI (ex.: dev fora do Windows), defina
// explicitamente ALLOW_PLAINTEXT_SECRETS=1 — assumindo o risco de forma consciente.
//
// Sem requireEncryption, mantém o comportamento legado: cifra se puder, senão
// cai pra texto puro (dados não-sensíveis, p. ex. cache de notificações).
function writeJsonSecure(file, data, opts = {}) {
  const requireEncryption = !!opts.requireEncryption;
  const plaintext = JSON.stringify(data);

  if (IS_WINDOWS) {
    try {
      writeFileAtomic(file, JSON.stringify({ __dpapi: dpapiProtect(plaintext) }, null, 2));
      return;
    } catch (e) {
      if (requireEncryption && process.env.ALLOW_PLAINTEXT_SECRETS !== '1') {
        throw new Error(
          `DPAPI indisponível e gravação em texto puro recusada para ${path.basename(file)}: ${e.message}`,
        );
      }
      console.warn('[secureStore] DPAPI indisponível, gravando em texto puro:', e.message);
    }
  } else if (requireEncryption && process.env.ALLOW_PLAINTEXT_SECRETS !== '1') {
    // Fora do Windows não há DPAPI: recusa gravar segredos em texto puro.
    throw new Error(
      `Sem DPAPI (não-Windows): gravação de segredos em texto puro recusada para ${path.basename(file)}. ` +
        `Defina ALLOW_PLAINTEXT_SECRETS=1 para permitir explicitamente em dev.`,
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
};
