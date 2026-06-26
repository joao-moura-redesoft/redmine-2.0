// Geração de códigos TOTP (RFC 6238) no servidor — a semente nunca volta ao cliente.
const crypto = require('crypto');

function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32.toUpperCase().replace(/[=\s]/g, '')) {
    const val = alphabet.indexOf(char);
    if (val !== -1) bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret, timeStep = 30, digits = 6) {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / timeStep);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(time >>> 0, 4);
  const sig = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = sig[sig.length - 1] & 0x0f;
  const code = (
    ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) | (sig[offset + 2] << 8) | sig[offset + 3]
  ) % (10 ** digits);
  return String(code).padStart(digits, '0');
}

function totpRemaining(timeStep = 30) {
  return timeStep - (Math.floor(Date.now() / 1000) % timeStep);
}

module.exports = { generateTOTP, totpRemaining };
