// Auto-update do executável (pkg ou SEA) no Windows.
//
// DESLIGADO por padrão. Duas origens possíveis (a primeira que estiver
// configurada vence):
//
//   • GitHub Releases → UPDATE_GITHUB_REPO="owner/repo"
//       - repo privado: defina UPDATE_GITHUB_TOKEN (PAT read-only escopado);
//         repo público: sem token.
//       - o asset .exe é detectado automaticamente (ou UPDATE_GITHUB_ASSET).
//   • Manifesto self-hosted → UPDATE_MANIFEST_URL (JSON {version,url,sha256,notes}).
//       - ideal para ambiente restrito/air-gapped, sem saída para api.github.com.
//
// Fluxo em ambos: status() compara versão → download() baixa + confere SHA-256 →
// apply() troca o .exe e relança. O SHA-256 vem do campo `digest` do asset do
// GitHub, de um asset `SHA256SUMS`, ou do campo `sha256` do manifesto.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const axios = require('axios');
const log = require('../lib/logger');
const { isPackaged, DATA_DIR } = require('../lib/runtime');

let CURRENT = '0.0.0';
try {
  CURRENT = require('../../package.json').version || CURRENT;
} catch {
  /* empacotado sem package.json acessível */
}

const GH_REPO = () => (process.env.UPDATE_GITHUB_REPO || '').trim();
const GH_TOKEN = () => (process.env.UPDATE_GITHUB_TOKEN || '').trim();
const GH_ASSET = () => (process.env.UPDATE_GITHUB_ASSET || '').trim();
const MANIFEST_URL = () => (process.env.UPDATE_MANIFEST_URL || '').trim();
const enabled = () => !!(GH_REPO() || MANIFEST_URL());

// ── Helpers puros (testáveis) ───────────────────────────────────────────────

// Compara "1.2.3" vs "1.10.0" numericamente. Ignora sufixos de pré-release.
// Retorna -1 (a<b), 0 (=), 1 (a>b).
function compareVersions(a, b) {
  const parse = (v) =>
    String(v || '')
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// Valida e normaliza o manifesto self-hosted. Lança se inválido.
function parseManifest(data) {
  if (!data || typeof data !== 'object') throw new Error('manifesto inválido');
  const version = String(data.version || '').trim();
  const url = String(data.url || '').trim();
  if (!/^\d+\.\d+/.test(version)) throw new Error('manifesto sem versão válida');
  if (!/^https?:\/\//i.test(url)) throw new Error('manifesto sem url http(s) válida');
  return {
    version,
    url,
    sha256: (data.sha256 || '').toLowerCase().replace(/[^a-f0-9]/g, '') || null,
    notes: typeof data.notes === 'string' ? data.notes.slice(0, 2000) : '',
  };
}

// Extrai o hash de um arquivo dentro de um SHA256SUMS ("<hash>  <arquivo>").
function parseSha256Sums(text, filename) {
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim().split(/[\\/]/).pop() === filename) return m[1].toLowerCase();
  }
  return null;
}

// Interpreta a resposta de /releases/latest do GitHub. `assetName` opcional força
// o nome do .exe; senão pega o primeiro asset .exe. Devolve refs dos assets, sem
// baixar nada (puro).
function parseGithubRelease(release, assetName = '') {
  if (!release || typeof release !== 'object') throw new Error('release inválido');
  const version = String(release.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+/.test(version)) throw new Error('release sem tag de versão válida');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exe = assetName
    ? assets.find((a) => a.name === assetName)
    : assets.find((a) => /\.exe$/i.test(a.name || ''));
  if (!exe) throw new Error('release sem asset .exe');
  const sums = assets.find(
    (a) => /^sha256sums$/i.test(a.name || '') || /\.sha256$/i.test(a.name || ''),
  );
  const pick = (a) => ({
    name: a.name,
    apiUrl: a.url, // api.github.com/.../releases/assets/{id} (aceita token + octet-stream)
    browserUrl: a.browser_download_url, // download anônimo (repo público)
    // GitHub expõe "sha256:<hex>" em `digest` para assets recentes.
    digest: /^sha256:([a-f0-9]{64})$/i.test(a.digest || '')
      ? a.digest.split(':')[1].toLowerCase()
      : null,
  });
  return {
    version,
    notes: String(release.body || '').slice(0, 2000),
    exe: pick(exe),
    sums: sums ? pick(sums) : null,
  };
}

// ── Resolução da última versão (por provider) ───────────────────────────────

function ghHeaders(accept) {
  const h = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Bluemine-Updater',
  };
  const t = GH_TOKEN();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

// Devolve { version, notes, download:{url,headers,sha256} } da origem configurada.
// `withSha=false` evita baixar o SHA256SUMS quando só queremos comparar versões.
async function resolveLatest(withSha) {
  if (GH_REPO()) {
    const { data } = await axios.get(`https://api.github.com/repos/${GH_REPO()}/releases/latest`, {
      timeout: 8000,
      maxContentLength: 512 * 1024,
      headers: ghHeaders('application/vnd.github+json'),
    });
    const rel = parseGithubRelease(data, GH_ASSET());
    const useToken = !!GH_TOKEN();
    const download = {
      url: useToken ? rel.exe.apiUrl : rel.exe.browserUrl,
      headers: useToken
        ? ghHeaders('application/octet-stream')
        : { 'User-Agent': 'Bluemine-Updater' },
      filename: rel.exe.name,
      sha256: rel.exe.digest,
    };
    if (withSha && !download.sha256 && rel.sums) {
      const sres = await axios.get(useToken ? rel.sums.apiUrl : rel.sums.browserUrl, {
        timeout: 8000,
        maxContentLength: 64 * 1024,
        responseType: 'text',
        headers: useToken
          ? ghHeaders('application/octet-stream')
          : { 'User-Agent': 'Bluemine-Updater' },
      });
      download.sha256 = parseSha256Sums(sres.data, rel.exe.name);
    }
    return { version: rel.version, notes: rel.notes, download };
  }

  // Manifesto self-hosted.
  const { data } = await axios.get(MANIFEST_URL(), {
    timeout: 8000,
    maxContentLength: 64 * 1024,
    responseType: 'json',
  });
  const m = parseManifest(data);
  return {
    version: m.version,
    notes: m.notes,
    download: { url: m.url, headers: {}, sha256: m.sha256 },
  };
}

// ── Operações ───────────────────────────────────────────────────────────────

const stagedPath = () => `${process.execPath}.new`;
const backupPath = () => `${process.execPath}.bak`;

// Marcador de boot bem-sucedido: o app o (re)grava com a versão atual assim que
// o servidor sobe (ver index.js). O watchdog de rollback usa isso para saber se
// a versão nova realmente iniciou.
const bootMarkerPath = () => path.join(DATA_DIR, '.bluemine-boot-ok');

function writeBootMarker() {
  try {
    fs.writeFileSync(bootMarkerPath(), `${CURRENT}\n${new Date().toISOString()}`);
  } catch {
    /* marcador é best-effort */
  }
}

async function status() {
  if (!enabled()) return { enabled: false, current: CURRENT };
  const latest = await resolveLatest(false);
  return {
    enabled: true,
    current: CURRENT,
    latest: latest.version,
    updateAvailable: compareVersions(latest.version, CURRENT) > 0,
    notes: latest.notes,
    staged: fs.existsSync(stagedPath()),
  };
}

const MAX_EXE_BYTES = 300 * 1024 * 1024;

async function download() {
  if (!enabled()) throw Object.assign(new Error('auto-update desabilitado'), { statusCode: 400 });
  if (!isPackaged)
    throw Object.assign(new Error('auto-update só se aplica ao executável empacotado'), {
      statusCode: 400,
    });

  const latest = await resolveLatest(true);
  if (compareVersions(latest.version, CURRENT) <= 0)
    return { updated: false, message: 'Já está na versão mais recente.' };

  const resp = await axios.get(latest.download.url, {
    timeout: 120000,
    responseType: 'arraybuffer',
    maxContentLength: MAX_EXE_BYTES,
    maxBodyLength: MAX_EXE_BYTES,
    headers: latest.download.headers,
  });
  const buf = Buffer.from(resp.data);

  if (latest.download.sha256) {
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== latest.download.sha256) {
      log.error('update_sha_mismatch', { expected: latest.download.sha256, got });
      throw Object.assign(new Error('SHA-256 do download não confere — atualização abortada.'), {
        statusCode: 502,
      });
    }
  } else {
    log.warn('update_no_sha', { version: latest.version }); // sem hash: confia só no TLS
  }

  const tmp = `${stagedPath()}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, stagedPath());
  log.info('update_staged', { version: latest.version, bytes: buf.length });
  return {
    updated: true,
    version: latest.version,
    staged: true,
    verified: !!latest.download.sha256,
  };
}

// Aplica a atualização estacionada: troca o .exe, relança e faz ROLLBACK
// automático se a versão nova não subir. Windows-only.
//
// Um watchdog PowerShell destacado: (1) espera este processo sair, (2) faz backup
// do exe atual (.bak), (3) instala o novo, (4) o relança, (5) espera N segundos e
// confere o marcador de boot. Se a nova versão gravou o marcador com a versão
// esperada → sucesso (descarta o backup). Senão → mata a nova, restaura o backup
// e relança a versão anterior. Assim uma atualização quebrada não deixa o usuário
// sem app.
const ROLLBACK_TIMEOUT = () => Math.max(10, Number(process.env.UPDATE_ROLLBACK_TIMEOUT) || 30);

// Gera o script do watchdog (isolado para teste unitário).
function buildWatchdogScript({ exe, staged, bak, marker, newVersion, timeoutSec }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`; // aspas simples PS
  return `$ErrorActionPreference = 'SilentlyContinue'
$exe = ${q(exe)}; $staged = ${q(staged)}; $bak = ${q(bak)}
$marker = ${q(marker)}; $newVer = ${q(newVersion)}
Start-Sleep -Seconds 2
Copy-Item -Force -LiteralPath $exe -Destination $bak
Move-Item -Force -LiteralPath $staged -Destination $exe
Remove-Item -Force -LiteralPath $marker
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds ${timeoutSec}
$ok = $false
if (Test-Path -LiteralPath $marker) {
  if ((Get-Content -LiteralPath $marker -Raw) -like "*$newVer*") { $ok = $true }
}
if ($ok) {
  Remove-Item -Force -LiteralPath $bak
} else {
  if ($proc) { Stop-Process -Id $proc.Id -Force }
  Start-Sleep -Seconds 2
  Move-Item -Force -LiteralPath $bak -Destination $exe
  Start-Process -FilePath $exe
}`;
}

async function latestVersionForApply() {
  try {
    return (await resolveLatest(false)).version;
  } catch {
    return CURRENT; // se a rede falhar, ainda aplicamos; o marcador exige o valor certo
  }
}

async function apply() {
  if (!isPackaged) throw Object.assign(new Error('não empacotado'), { statusCode: 400 });
  const staged = stagedPath();
  if (!fs.existsSync(staged))
    throw Object.assign(new Error('nenhuma atualização baixada'), { statusCode: 400 });

  const script = buildWatchdogScript({
    exe: process.execPath,
    staged,
    bak: backupPath(),
    marker: bootMarkerPath(),
    newVersion: await latestVersionForApply(),
    timeoutSec: ROLLBACK_TIMEOUT(),
  });
  const scriptPath = path.join(DATA_DIR, 'bluemine-update.ps1');
  fs.writeFileSync(scriptPath, script);

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  log.info('update_apply_scheduled', { rollbackTimeoutSec: ROLLBACK_TIMEOUT() });
  setTimeout(() => process.exit(0), 300);
  return { applying: true };
}

module.exports = {
  enabled,
  status,
  download,
  apply,
  writeBootMarker,
  bootMarkerPath,
  buildWatchdogScript,
  compareVersions,
  parseManifest,
  parseGithubRelease,
  parseSha256Sums,
  CURRENT,
};
