// Abre o app numa janela dedicada ao iniciar o .exe, para que o usuário não
// precise abrir o navegador na mão. No Windows usa o Edge em "app mode"
// (--app=URL): uma janela sem barra de endereço/abas, com ícone próprio na
// barra de tarefas, parecendo um programa nativo. Sem Edge (ou em outros SOs),
// cai no navegador padrão do sistema.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Locais usuais do Edge no Windows (x64 e x86).
const EDGE_PATHS = [
  path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft\\Edge\\Application\\msedge.exe',
  ),
  path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'Microsoft\\Edge\\Application\\msedge.exe',
  ),
];

function findEdge() {
  for (const p of EDGE_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignora caminho inacessível */
    }
  }
  return null;
}

// Abre a URL no navegador padrão do SO (fallback quando não há Edge).
function openDefault(url) {
  try {
    if (process.platform === 'win32') {
      // 'start' é builtin do cmd; o primeiro "" é o título (obrigatório quando
      // a URL vem entre aspas).
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* sem navegador disponível: usuário abre na mão */
  }
}

// Abre a janela dedicada do app. Respeita:
//  - BLUEMINE_NO_WINDOW=1  → não abre nada (deixa o usuário abrir na mão);
//  - HOST não-loopback     → modo "servidor central", ninguém está na máquina.
function openAppWindow(url, { host } = {}) {
  if (process.env.BLUEMINE_NO_WINDOW === '1') return;
  const isLoopback = !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) return;

  if (process.platform !== 'win32') return openDefault(url);

  const edge = findEdge();
  if (!edge) return openDefault(url);

  // Perfil isolado (fora do Edge pessoal do usuário): mantém a sessão do app
  // persistente entre reinícios e evita interferir na navegação normal.
  const profileDir = path.join(os.tmpdir(), 'bluemine-edge-profile');
  try {
    const child = spawn(
      edge,
      [
        `--app=${url}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.on('error', () => openDefault(url));
    child.unref();
  } catch {
    openDefault(url);
  }
}

module.exports = { openAppWindow };
