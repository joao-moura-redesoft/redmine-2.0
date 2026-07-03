// Teste determinístico do watchdog de rollback do auto-update, com "exes" dummy
// (.cmd) — não precisa de dois builds reais. Exercita o swap + rollback de
// verdade, rodando o script PowerShell que o updater gera.
//
//   node scripts/dev/test-rollback.cjs
//
// Cenários:
//   1) "nova" quebrada (não grava o marcador de boot) → deve REVERTER p/ a antiga.
//   2) "nova" boa (grava o marcador)                  → deve MANTER a nova e limpar o .bak.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const updater = require(path.resolve(__dirname, '../../server/services/updater.js'));

if (process.platform !== 'win32') {
  console.log('Este teste é Windows-only (o watchdog usa PowerShell). Pulando.');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-rollback-'));
const exe = path.join(dir, 'app.cmd');
const staged = `${exe}.new`;
const bak = `${exe}.bak`;
const marker = path.join(dir, 'marker.txt');

const good = (ver) => `@echo off\r\necho ${ver}>"${marker}"\r\n`; // grava marcador e sai
const bad = `@echo off\r\nexit /b 1\r\n`; // não grava marcador

function run(scenario, stagedContent, newVersion) {
  fs.writeFileSync(exe, good('1.0.0')); // versão ATUAL (boa)
  fs.writeFileSync(staged, stagedContent); // versão NOVA (boa ou quebrada)
  fs.rmSync(marker, { force: true });
  fs.rmSync(bak, { force: true });

  const scriptPath = path.join(dir, 'wd.ps1');
  fs.writeFileSync(
    scriptPath,
    updater.buildWatchdogScript({ exe, staged, bak, marker, newVersion, timeoutSec: 3 }),
  );
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { stdio: 'ignore' },
  );
  // O app relançado grava o marcador de forma assíncrona; espera antes de aferir.
  spawnSync('ping', ['127.0.0.1', '-n', '3'], { stdio: 'ignore' });

  const exeContent = fs.readFileSync(exe, 'utf8');
  const markerContent = fs.existsSync(marker)
    ? fs.readFileSync(marker, 'utf8').trim()
    : '(ausente)';
  console.log(`\n[${scenario}]`);
  console.log('  exe restaurado p/ antiga?', exeContent === good('1.0.0'));
  console.log('  exe é a nova?           ', exeContent === stagedContent);
  console.log('  marcador:               ', markerContent);
  console.log('  .bak limpo?             ', !fs.existsSync(bak));
  return { exeContent, markerContent, bakExists: fs.existsSync(bak) };
}

let pass = true;

const r1 = run('ROLLBACK (nova quebrada)', bad, '2.0.0');
const rolledBack = r1.exeContent === good('1.0.0') && r1.markerContent.includes('1.0.0');
console.log('  => ROLLBACK OK?         ', rolledBack);
pass = pass && rolledBack;

const r2 = run('SUCESSO (nova boa)', good('2.0.0'), '2.0.0');
const upgraded =
  r2.exeContent === good('2.0.0') && r2.markerContent.includes('2.0.0') && !r2.bakExists;
console.log('  => UPGRADE OK?          ', upgraded);
pass = pass && upgraded;

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== RESULTADO: ${pass ? 'PASSOU ✅' : 'FALHOU ❌'} ===`);
process.exit(pass ? 0 : 1);
