// Efeito LOCAL: toca um aviso sonoro nos alto-falantes da máquina que roda o
// Bluemine. No modelo exe-local, o servidor É a máquina do usuário — então tocar
// aqui = tocar para o usuário. Mesma categoria de efeito local do keyboardNotify
// (K86): fire-and-forget, nunca bloqueia nem derruba o tick de automações.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SOUNDS_DIR = path.join(__dirname, '..', 'assets', 'sounds');
const KNOWN = new Set(['alert', 'success', 'error']);

// Desligável em teste/CI (sem placa de som) via SOUND_ENABLED=0.
const ENABLED = process.env.SOUND_ENABLED !== '0';

function soundPath(name) {
  const safe = KNOWN.has(name) ? name : 'alert';
  return path.join(SOUNDS_DIR, `${safe}.wav`);
}

// Dispara um player desacoplado do Node (unref) para não segurar o processo nem
// bloquear o tick. Erros do processo viram só um aviso.
function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => console.warn('[sound] processo falhou:', e.message));
  child.unref();
}

function play(name = 'alert') {
  if (!ENABLED) return;
  const file = soundPath(name);
  if (!fs.existsSync(file)) {
    console.warn('[sound] arquivo não encontrado:', file);
    return;
  }
  try {
    if (process.platform === 'win32') {
      // SoundPlayer.PlaySync dentro do PowerShell (o Node segue sem esperar).
      const ps = `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync();`;
      spawnDetached('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else if (process.platform === 'darwin') {
      spawnDetached('afplay', [file]);
    } else {
      // Linux: tenta PulseAudio (paplay) e cai para ALSA (aplay).
      spawnDetached('sh', ['-c', `paplay '${file}' 2>/dev/null || aplay '${file}' 2>/dev/null`]);
    }
  } catch (e) {
    console.warn('[sound] falha ao tocar:', e.message);
  }
}

module.exports = { play };
