/* eslint-disable no-console */
// =============================================================================
// SONDA da telinha do Attack Shark K86 (teste isolado, fora do Bluemine).
//
// Objetivo: confirmar que o K86 (USB 3151:4015) fala o MESMO protocolo HID que o
// X85 Pro (projeto EricOFreitas/attackshark-x85pro-linux), cujo encoder foi
// derivado justamente do K86 (projeto AttackManatee). Protocolo portado 1:1 do
// Python (xshark/protocol.py + device.py).
//
// Canal: interface HID vendor (usage page 0xFFFF), Feature reports de 64 bytes,
// report id 0.
//
// USO (com o teclado plugado por CABO USB):
//   npm i node-hid                      # instala o binding (prebuilt no Windows)
//   node scripts/dev/keyboard-probe.cjs --list        # só lista as interfaces
//   node scripts/dev/keyboard-probe.cjs               # manda SET-TIME (seguro)
//   node scripts/dev/keyboard-probe.cjs --color=ff0000  # frame vermelho sólido
//   node scripts/dev/keyboard-probe.cjs --clear       # limpa a tela (0xAC)
//   node scripts/dev/keyboard-probe.cjs --pid=5002    # força outro PID (X85 Pro)
//
// TESTE DECISIVO: rode sem argumentos. Se o RELÓGIO da telinha mudar para a hora
// atual, os opcodes batem e a integração com o Bluemine é viável. Depois o
// --color confirma a geometria (resolução) da tela.
// =============================================================================

// --- Protocolo (portado de xshark/protocol.py) ------------------------------
const REPORT_SIZE = 64;
// Opcodes reais (do app oficial: getTFTLCDDataRGBImg/setTFTLCDDataRGBImg etc.).
const FEA_PREPARE = 0xf7; // 247 — "preparar" antes do init
const FEA_INIT = 0xa5; // 165 — getTFTLCDDataRGBImg (dimensões + tamanho)
const FEA_CHUNK = 0x25; // 37  — setTFTLCDDataRGBImg (pixels)
const FEA_SET_TIME = 0x28; // 40  — setOLEDClock
const FEA_ERASE = 0xac; // 172 — setFlashChipErase (limpa a flash)

// Geometria da tela (da config do app: K86 = 240x135 RGB565, direção "col").
let SCREEN_WIDTH = 240;
let SCREEN_HEIGHT = 135;
const CHUNK_DATA_LEN = 56; // 56 bytes de pixel por chunk (0x38)
function frameBytes() {
  return SCREEN_WIDTH * SCREEN_HEIGHT * 2;
}

// Checksum do device: (0xFF - soma(bytes 0..6)) & 0xFF, gravado no byte 7.
// Presente no xshark (X85 Pro) e EXIGIDO pelo K86 (sem ele, não renderiza).
function setChecksum(o) {
  let s = 0;
  for (let k = 0; k < 7; k++) s = (s + o[k]) & 0xff;
  o[7] = (0xff - s) & 0xff;
}

// Pacote "preparar" (0xF7), 64 bytes zerados exceto o opcode.
function buildPrepare() {
  const o = Buffer.alloc(64);
  o[0] = FEA_PREPARE;
  return o;
}

// setOLEDClock (0x28): ano big-endian em [8..9], depois mês/dia/hora/min/seg.
function buildSetTime(when = new Date()) {
  const o = Buffer.alloc(64);
  o[0] = FEA_SET_TIME;
  o[8] = (when.getFullYear() >> 8) & 0xff;
  o[9] = when.getFullYear() & 0xff;
  o[10] = when.getMonth() + 1;
  o[11] = when.getDate();
  o[12] = when.getHours();
  o[13] = when.getMinutes();
  o[14] = when.getSeconds();
  return o;
}

// setFlashChipErase (0xAC): apaga a flash (todas as imagens). ~lento no device.
function buildErase() {
  const o = Buffer.alloc(64);
  o[0] = FEA_ERASE;
  return o;
}

// getTFTLCDDataRGBImg (0xA5): tamanho (32-bit) + bounding box left/top/right/bottom.
// left=0,top=0,right=W,bottom=H para imagem cheia. layer = slot da tela (0..4).
function buildImageInit(len, left, top, right, bottom, layer = 0, frameNum = 1, frameDelay = 0) {
  const o = Buffer.alloc(64);
  o[0] = FEA_INIT;
  o[1] = layer & 0xff; // currentFrame
  o[2] = frameNum & 0xff;
  o[3] = frameDelay & 0xff;
  o[4] = len & 0xff;
  o[5] = (len & 0xffff) >> 8;
  o[6] = 0;
  o[8] = left & 0xff;
  o[9] = top & 0xff;
  o[10] = right & 0xff;
  o[11] = bottom & 0xff;
  o[12] = (left >> 8) & 0xff;
  o[13] = (top >> 8) & 0xff;
  o[14] = (right >> 8) & 0xff;
  o[15] = (bottom >> 8) & 0xff;
  o[16] = (len & 0xffffff) >> 16;
  o[17] = (len >>> 24) & 0xff;
  o[18] = 0;
  setChecksum(o);
  return o;
}

// setTFTLCDDataRGBImg (0x25): header de 8 bytes + 56 bytes de pixel. SEM checksum.
function buildImageChunk(chunkIdx, data, layer = 0, frameNum = 1, frameDelay = 0) {
  const o = Buffer.alloc(64);
  o[0] = FEA_CHUNK;
  o[1] = layer & 0xff;
  o[2] = frameNum & 0xff;
  o[3] = frameDelay & 0xff;
  o[4] = chunkIdx & 0xff;
  o[5] = (chunkIdx >> 8) & 0xff;
  o[6] = data.length & 0xff;
  setChecksum(o);
  data.copy(o, 8, 0, Math.min(data.length, CHUNK_DATA_LEN));
  return o;
}

// Envia um frame completo: init (0xA5) → N chunks (0x25).
// NB: o app manda um 0xF7 (prepare) antes E LÊ a resposta do init; aqui é
// fire-and-forget (só write), que já provou renderizar. Ver buildPrepare se
// precisar do handshake completo.
function sendFrame(dev, frameData, { left = 0, top = 0, right = SCREEN_WIDTH, bottom = SCREEN_HEIGHT, layer = 0 } = {}) {
  sendFeature(dev, buildImageInit(frameData.length, left, top, right, bottom, layer));
  let n = 0;
  for (let base = 0, idx = 0; base < frameData.length; base += CHUNK_DATA_LEN, idx++) {
    sendFeature(dev, buildImageChunk(idx, frameData.subarray(base, base + CHUNK_DATA_LEN), layer));
    n++;
  }
  return n;
}

// Codifica 1 pixel RGB565 big-endian em 2 bytes.
function px565(r, g, b) {
  const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
  return [(v >> 8) & 0xff, v & 0xff];
}

// Frame de 4 quadrantes, em COLUMN-major (x externo, y interno) — a ordem que o
// K86 espera (confirmado: o app usa "col"; em row-major a imagem transpõe).
// Esperado na tela:
//   topo-esq VERMELHO | topo-dir VERDE | baixo-esq AZUL | baixo-dir BRANCO
function quadFrameColumnMajor() {
  const W = SCREEN_WIDTH;
  const H = SCREEN_HEIGHT;
  const buf = Buffer.alloc(W * H * 2);
  let i = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const left = x < W / 2;
      const top = y < H / 2;
      let c;
      if (top && left) c = [255, 0, 0]; // vermelho
      else if (top && !left) c = [0, 255, 0]; // verde
      else if (!top && left) c = [0, 0, 255]; // azul
      else c = [255, 255, 255]; // branco
      const [hi, lo] = px565(c[0], c[1], c[2]);
      buf[i++] = hi;
      buf[i++] = lo;
    }
  }
  return buf;
}

// RGB565 big-endian. Buffer de cor sólida com `bytes` bytes.
function solidBuf(r, g, b, bytes) {
  const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
  const hi = (v >> 8) & 0xff;
  const lo = v & 0xff;
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < buf.length; i += 2) {
    buf[i] = hi;
    buf[i + 1] = lo;
  }
  return buf;
}

// --- Transporte (portado de xshark/device.py) -------------------------------
function loadHid() {
  try {
    return require('node-hid');
  } catch {
    console.error(
      'node-hid não instalado. Rode: npm i node-hid  (traz binário prebuilt no Windows x64).',
    );
    process.exit(2);
  }
}

// Acha o `path` da interface vendor (usage page >= 0xFF00, maior interfaceNumber).
function findVendorPath(HID, vid, pid) {
  const all = HID.devices(vid, pid);
  if (!all.length) return null;
  const vendor = all.filter((d) => (d.usagePage || 0) >= 0xff00);
  const pick = (list) =>
    list.reduce((a, c) => ((c.interface || 0) >= (a.interface || 0) ? c : a));
  return pick(vendor.length ? vendor : all).path;
}

function sendFeature(dev, payload) {
  const data = Buffer.alloc(REPORT_SIZE);
  payload.copy(data, 0, 0, Math.min(payload.length, REPORT_SIZE));
  // Primeiro byte = report id (0).
  return dev.sendFeatureReport([0x00, ...data]);
}

// --- Main -------------------------------------------------------------------
function parseArgs() {
  const args = { pid: null, list: false, clear: false, color: null, quad: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--list') args.list = true;
    else if (a === '--clear') args.clear = true;
    else if (a === '--quad') args.quad = true;
    else if (a.startsWith('--color=')) args.color = a.slice('--color='.length);
    else if (a.startsWith('--pid=')) args.pid = parseInt(a.slice('--pid='.length), 16);
    else if (a.startsWith('--w=')) SCREEN_WIDTH = parseInt(a.slice('--w='.length), 10);
    else if (a.startsWith('--h=')) SCREEN_HEIGHT = parseInt(a.slice('--h='.length), 10);
  }
  return args;
}

function main() {
  const HID = loadHid();
  const args = parseArgs();
  const VID = 0x3151;
  const pids = args.pid ? [args.pid] : [0x4015 /* K86 */, 0x5002 /* X85 Pro */];

  // Diagnóstico: lista TODAS as interfaces do teclado.
  console.log('== Interfaces do teclado (VID 0x3151) ==');
  let found = null;
  for (const pid of pids) {
    const list = HID.devices(VID, pid);
    for (const d of list) {
      console.log(
        `  pid=0x${pid.toString(16)} iface=${d.interface} usagePage=0x${(d.usagePage || 0)
          .toString(16)} usage=0x${(d.usage || 0).toString(16)} product=${d.product || '?'}`,
      );
    }
    if (list.length && !found) found = { pid, path: findVendorPath(HID, VID, pid) };
  }

  if (!found || !found.path) {
    console.error(
      '\nTeclado Attack Shark não encontrado (3151:4015/5002). Está plugado por CABO USB? ' +
        'No modo sem-fio o canal da tela pode não aparecer.',
    );
    process.exit(1);
  }
  console.log(`\nUsando pid=0x${found.pid.toString(16)} path=${found.path}`);

  if (args.list) return;

  const dev = new HID.HID(found.path);
  try {
    if (args.clear) {
      console.log('Enviando ERASE (0xAC) — apaga a flash da tela (pode demorar)...');
      sendFeature(dev, buildErase());
      console.log('OK — a tela deve limpar.');
      return;
    }

    if (args.color) {
      const m = /^([0-9a-f]{6})$/i.exec(args.color);
      if (!m) throw new Error('--color deve ser RRGGBB hex, ex.: --color=ff0000');
      const r = parseInt(args.color.slice(0, 2), 16);
      const g = parseInt(args.color.slice(2, 4), 16);
      const b = parseInt(args.color.slice(4, 6), 16);
      console.log(`Enviando #${args.color} — ${SCREEN_WIDTH}x${SCREEN_HEIGHT} (${frameBytes()} B)...`);
      const n = sendFrame(dev, solidBuf(r, g, b, frameBytes()));
      console.log(`OK — ${n} chunks. A tela deve ficar TODA #${args.color}, limpa.`);
      return;
    }

    if (args.quad) {
      console.log(`Enviando QUADRANTES (column-major) — ${SCREEN_WIDTH}x${SCREEN_HEIGHT}...`);
      const n = sendFrame(dev, quadFrameColumnMajor());
      console.log(`OK — ${n} chunks. Esperado:`);
      console.log('   topo-esq VERMELHO | topo-dir VERDE | baixo-esq AZUL | baixo-dir BRANCO');
      return;
    }

    // Padrão: SET-TIME.
    const now = new Date();
    console.log(`Enviando SET-TIME (0x28) = ${now.toLocaleString()}...`);
    sendFeature(dev, buildSetTime(now));
    console.log('OK — se a tela estiver no modo relógio, deve mostrar a hora atual.');
  } finally {
    dev.close();
  }
}

main();
