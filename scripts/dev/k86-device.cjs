/* eslint-disable no-console */
// Transporte da telinha do Attack Shark K86 (reusável). Protocolo decifrado do
// app oficial — ver scripts/dev/keyboard-probe.cjs e a memória k86-screen-protocol.
//
// Tela 240x135, RGB565 big-endian, COLUMN-MAJOR. Canal: interface vendor
// (usagePage 0xFFFF), feature report id 0, 64 bytes. Checksum no byte 7 é
// OBRIGATÓRIO (init 0xA5 e chunk 0x25).
const VID = 0x3151;
const DEFAULT_PIDS = [0x4015 /* K86 */, 0x5002 /* X85 Pro */];
const WIDTH = 240;
const HEIGHT = 135;
const REPORT_SIZE = 64;
const CHUNK_DATA_LEN = 56;

const FEA_INIT = 0xa5;
const FEA_CHUNK = 0x25;

function loadHid() {
  try {
    return require('node-hid');
  } catch {
    throw new Error('node-hid não instalado. Rode: npm i node-hid');
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
  for (const pid of DEFAULT_PIDS) {
    const path = findVendorPath(HID, pid);
    if (path) return new HID.HID(path);
  }
  throw new Error('Teclado Attack Shark (3151:4015/5002) não encontrado. Plugado por cabo USB?');
}

function setChecksum(o) {
  let s = 0;
  for (let k = 0; k < 7; k++) s = (s + o[k]) & 0xff;
  o[7] = (0xff - s) & 0xff;
}

function sendFeature(dev, o) {
  return dev.sendFeatureReport([0x00, ...o]);
}

function buildInit(len, left, top, right, bottom, layer = 0) {
  const o = Buffer.alloc(REPORT_SIZE);
  o[0] = FEA_INIT;
  o[1] = layer & 0xff;
  o[2] = 1; // frameNum
  o[3] = 0; // frameDelay
  o[4] = len & 0xff;
  o[5] = (len & 0xffff) >> 8;
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
  setChecksum(o);
  return o;
}

function buildChunk(idx, data, layer = 0) {
  const o = Buffer.alloc(REPORT_SIZE);
  o[0] = FEA_CHUNK;
  o[1] = layer & 0xff;
  o[2] = 1;
  o[3] = 0;
  o[4] = idx & 0xff;
  o[5] = (idx >> 8) & 0xff;
  o[6] = data.length & 0xff;
  setChecksum(o);
  data.copy(o, 8, 0, Math.min(data.length, CHUNK_DATA_LEN));
  return o;
}

// Converte RGBA row-major (Canvas getImageData) → RGB565 BE column-major.
function rgbaToFrame(rgba, w = WIDTH, h = HEIGHT) {
  const out = Buffer.alloc(w * h * 2);
  let i = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4;
      const v = ((rgba[p] & 0xf8) << 8) | ((rgba[p + 1] & 0xfc) << 3) | (rgba[p + 2] >> 3);
      out[i++] = (v >> 8) & 0xff;
      out[i++] = v & 0xff;
    }
  }
  return out;
}

// Espera BLOQUEANTE de microssegundos por busy-wait (spin). Necessário porque o
// firmware do K86 descarta chunks se mandar rápido demais (trava em X% na tela),
// e o timer do Windows tem resolução ~15ms — cedo demais pra pacing fino. O spin
// dá precisão sub-ms sem depender do timer.
function spinUs(us) {
  if (us <= 0) return;
  const ns = BigInt(Math.round(us * 1000));
  const start = process.hrtime.bigint();
  while (process.hrtime.bigint() - start < ns) {
    /* busy-wait curto */
  }
}

// Envia um frame já em RGB565 (init 0xA5 → N chunks 0x25), com pacing por chunk.
function sendFrame(dev, frame, { layer = 0, chunkDelayUs = 700 } = {}) {
  sendFeature(dev, buildInit(frame.length, 0, 0, WIDTH, HEIGHT, layer));
  spinUs(2000); // folga após o init
  for (let base = 0, idx = 0; base < frame.length; base += CHUNK_DATA_LEN, idx++) {
    sendFeature(dev, buildChunk(idx, frame.subarray(base, base + CHUNK_DATA_LEN), layer));
    spinUs(chunkDelayUs);
  }
}

// Atalho: recebe um Canvas (@napi-rs/canvas) e envia.
function sendCanvas(dev, canvas, opts) {
  const rgba = canvas.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
  sendFrame(dev, rgbaToFrame(rgba), opts);
}

module.exports = { open, sendFrame, sendCanvas, rgbaToFrame, WIDTH, HEIGHT };
