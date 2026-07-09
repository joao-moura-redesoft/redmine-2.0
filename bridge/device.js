// Transporte da telinha do Attack Shark K86. Protocolo decifrado do app oficial
// (ver memória k86-screen-protocol / scripts/dev/keyboard-probe.cjs).
// Tela 240x135 RGB565 big-endian COLUMN-MAJOR; canal vendor (usagePage 0xFFFF),
// feature report id 0, 64 bytes; checksum OBRIGATÓRIO no byte 7; PACING por chunk.
const VID = 0x3151;
const PIDS = [0x4015 /* K86 */, 0x5002 /* X85 Pro */];
const WIDTH = 240;
const HEIGHT = 135;
const REPORT_SIZE = 64;
const CHUNK_DATA_LEN = 56;

function loadHid() {
  return require('node-hid');
}

// true se um teclado com tela estiver plugado (canal vendor presente).
function isPresent() {
  try {
    const HID = loadHid();
    return PIDS.some((pid) => HID.devices(VID, pid).some((d) => (d.usagePage || 0) >= 0xff00));
  } catch {
    return false;
  }
}

function findVendorPath(HID, pid) {
  const all = HID.devices(VID, pid);
  if (!all.length) return null;
  const vendor = all.filter((d) => (d.usagePage || 0) >= 0xff00);
  const pick = (list) => list.reduce((a, c) => ((c.interface || 0) >= (a.interface || 0) ? c : a));
  return pick(vendor.length ? vendor : all).path;
}

function open() {
  const HID = loadHid();
  for (const pid of PIDS) {
    const path = findVendorPath(HID, pid);
    if (path) return new HID.HID(path);
  }
  return null;
}

function setChecksum(o) {
  let s = 0;
  for (let k = 0; k < 7; k++) s = (s + o[k]) & 0xff;
  o[7] = (0xff - s) & 0xff;
}

function sendFeature(dev, o) {
  return dev.sendFeatureReport([0x00, ...o]);
}

// Busy-wait em microssegundos (o timer do Windows tem resolução ~15ms, grosso
// demais pro pacing fino que o firmware exige — sem pacing ele trava em X%).
function spinUs(us) {
  if (us <= 0) return;
  const ns = BigInt(Math.round(us * 1000));
  const start = process.hrtime.bigint();
  while (process.hrtime.bigint() - start < ns) {
    /* spin */
  }
}

function buildInit(len) {
  const o = Buffer.alloc(REPORT_SIZE);
  o[0] = 0xa5;
  o[1] = 0; // layer
  o[2] = 1; // frameNum
  o[4] = len & 0xff;
  o[5] = (len & 0xffff) >> 8;
  o[10] = WIDTH & 0xff; // right
  o[11] = HEIGHT & 0xff; // bottom
  o[16] = (len & 0xffffff) >> 16;
  o[17] = (len >>> 24) & 0xff;
  setChecksum(o);
  return o;
}

function buildChunk(idx, data) {
  const o = Buffer.alloc(REPORT_SIZE);
  o[0] = 0x25;
  o[2] = 1;
  o[4] = idx & 0xff;
  o[5] = (idx >> 8) & 0xff;
  o[6] = data.length & 0xff;
  setChecksum(o);
  data.copy(o, 8, 0, Math.min(data.length, CHUNK_DATA_LEN));
  return o;
}

// RGBA row-major (Canvas) → RGB565 BE column-major.
function rgbaToFrame(rgba) {
  const out = Buffer.alloc(WIDTH * HEIGHT * 2);
  let i = 0;
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const p = (y * WIDTH + x) * 4;
      const v = ((rgba[p] & 0xf8) << 8) | ((rgba[p + 1] & 0xfc) << 3) | (rgba[p + 2] >> 3);
      out[i++] = (v >> 8) & 0xff;
      out[i++] = v & 0xff;
    }
  }
  return out;
}

function sendFrameTo(dev, frame, chunkDelayUs) {
  sendFeature(dev, buildInit(frame.length));
  spinUs(2000);
  for (let base = 0, idx = 0; base < frame.length; base += CHUNK_DATA_LEN, idx++) {
    sendFeature(dev, buildChunk(idx, frame.subarray(base, base + CHUNK_DATA_LEN)));
    spinUs(chunkDelayUs);
  }
}

// Relógio nativo (opcode 0x28 setOLEDClock): reverte a tela pro modo relógio.
function buildClock(when = new Date()) {
  const o = Buffer.alloc(REPORT_SIZE);
  o[0] = 0x28;
  o[8] = (when.getFullYear() >> 8) & 0xff;
  o[9] = when.getFullYear() & 0xff;
  o[10] = when.getMonth() + 1;
  o[11] = when.getDate();
  o[12] = when.getHours();
  o[13] = when.getMinutes();
  o[14] = when.getSeconds();
  return o;
}

// --- API de alto nível (abre/fecha por operação; robusto a replug) ----------
function sendCanvas(canvas, { chunkDelayUs = 700 } = {}) {
  const dev = open();
  if (!dev) return false;
  try {
    const rgba = canvas.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
    sendFrameTo(dev, rgbaToFrame(rgba), chunkDelayUs);
    return true;
  } finally {
    try {
      dev.close();
    } catch {
      /* ignora */
    }
  }
}

function showClock() {
  const dev = open();
  if (!dev) return false;
  try {
    sendFeature(dev, buildClock());
    return true;
  } finally {
    try {
      dev.close();
    } catch {
      /* ignora */
    }
  }
}

module.exports = { WIDTH, HEIGHT, isPresent, sendCanvas, showClock, rgbaToFrame };
