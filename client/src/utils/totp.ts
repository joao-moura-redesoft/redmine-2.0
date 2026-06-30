function base32Decode(base32: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32.toUpperCase().replace(/[=\s]/g, '')) {
    const val = alphabet.indexOf(char);
    if (val !== -1) bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  // Backing explícito por ArrayBuffer (não ArrayBufferLike) para satisfazer
  // o tipo BufferSource exigido pela Web Crypto API.
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return new Uint8Array(buf);
}

export async function generateTOTP(secret: string, timeStep = 30, digits = 6): Promise<string> {
  const keyBytes = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / timeStep);
  const counter = new ArrayBuffer(8);
  new DataView(counter).setUint32(4, time >>> 0, false);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counter));
  const offset = sig[sig.length - 1] & 0x0f;
  const code =
    (((sig[offset] & 0x7f) << 24) |
      (sig[offset + 1] << 16) |
      (sig[offset + 2] << 8) |
      sig[offset + 3]) %
    10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function totpRemaining(timeStep = 30): number {
  return timeStep - (Math.floor(Date.now() / 1000) % timeStep);
}
