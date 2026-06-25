// Encoda PCM (Float32 mono) para MP3 (audio/mpeg) — formato nativo de mensagem de
// voz do Talk, que toca em qualquer cliente (Safari/iOS e app oficial do Nextcloud).
// O lamejs é carregado sob demanda para não pesar no bundle principal.

function floatToInt16(samples: Float32Array): Int16Array {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

export async function pcmToMp3(samples: Float32Array, sampleRate: number): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const int16 = floatToInt16(samples);
  const enc = new Mp3Encoder(1, sampleRate, 64);
  const out: Uint8Array[] = [];
  const block = 1152;
  for (let i = 0; i < int16.length; i += block) {
    const buf = enc.encodeBuffer(int16.subarray(i, i + block));
    if (buf.length) out.push(buf);
  }
  const end = enc.flush();
  if (end.length) out.push(end);
  return new Blob(out as BlobPart[], { type: 'audio/mpeg' });
}

// Fallback universal: WAV PCM 16-bit (audio/wav). Maior, mas toca em todo lugar.
export function pcmToWav(samples: Float32Array, sampleRate: number): Blob {
  const int16 = floatToInt16(samples);
  const dataLen = int16.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits
  wstr(36, 'data');
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < int16.length; i++, off += 2) view.setInt16(off, int16[i], true);
  return new Blob([view], { type: 'audio/wav' });
}
