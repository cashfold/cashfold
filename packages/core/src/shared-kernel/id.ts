declare const idBrand: unique symbol;
/** Lowercase canonical UUID text. */
export type Id = string & { readonly [idBrand]: true };

export type RandomBytes = (length: number) => Uint8Array;

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = '0123456789abcdef';

export function parseId(text: string): { ok: true; value: Id } | { ok: false; error: { code: 'invalid_id'; message: string } } {
  const lower = text.toLowerCase();
  return CANONICAL.test(lower)
    ? { ok: true, value: lower as Id }
    : { ok: false, error: { code: 'invalid_id', message: 'Not a valid identifier' } };
}

export function idFromBytes(bytes: Uint8Array): Id {
  if (bytes.length !== 16) throw new RangeError('an id is exactly 16 bytes');
  let hex = '';
  for (const b of bytes) hex += HEX[b >> 4]! + HEX[b & 15]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Id;
}

export function idToBytes(id: Id): Uint8Array {
  const hex = id.replaceAll('-', '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function stamp(bytes: Uint8Array, version: number): Id {
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4);
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return idFromBytes(bytes);
}

export function newIdV4(random: RandomBytes): Id {
  return stamp(Uint8Array.from(random(16)), 4);
}

/** UUIDv7: 48-bit unix-ms timestamp, then random bits. Sorts by creation time. */
export function newIdV7(unixMs: number, random: RandomBytes): Id {
  const bytes = Uint8Array.from(random(16));
  let rest = unixMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return stamp(bytes, 7);
}

export function timestampOfV7(id: Id): number {
  return idToBytes(id).slice(0, 6).reduce((acc, b) => acc * 256 + b, 0);
}

/** Name-based UUIDv5 (RFC 4122, SHA-1). Used only to derive stable identifiers, never for security. */
export function uuidV5(namespace: Id, name: string): Id {
  return uuidV5Bytes(namespace, new Uint8Array(utf8(name)));
}

/** The same with a name that is raw bytes, for names that are not text (a counter as 4 big-endian bytes). */
export function uuidV5Bytes(namespace: Id, name: Uint8Array): Id {
  const input = new Uint8Array([...idToBytes(namespace), ...name]);
  return stamp(sha1(input).slice(0, 16), 5);
}

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

function sha1(message: Uint8Array): Uint8Array {
  const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
  const bitLength = message.length * 8;
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
  return out;
}
