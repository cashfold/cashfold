import { sha256 } from '@noble/hashes/sha2.js';

// The fingerprint of a person's public keys (ARCH 7.4, FR-084). Two people compare it out of band, or by QR, before a
// Fold is shared, so a service that swaps in its own key is noticed:
//   fp = SHA-256("cashfold.fp.v1" || enc.pk || sig.pk) truncated to 20 bytes.
// It is shown as eight groups of five digits: each group is a 20-bit slice of the 160 bits, reduced modulo 100,000. That
// keeps the text short enough to read aloud at about 132 bits of strength. The QR form carries all 160 bits.

const LABEL = new TextEncoder().encode('cashfold.fp.v1');
const QR_PREFIX = 'cf-fp1:';
export const FINGERPRINT_BYTES = 20;

export function fingerprint(encPk: Uint8Array, sigPk: Uint8Array): Uint8Array {
  if (encPk.length !== 32 || sigPk.length !== 32) throw new RangeError('public keys are 32 bytes');
  const input = new Uint8Array(LABEL.length + 64);
  input.set(LABEL);
  input.set(encPk, LABEL.length);
  input.set(sigPk, LABEL.length + 32);
  return sha256(input).slice(0, FINGERPRINT_BYTES);
}

/** Eight groups of five digits, for reading aloud or side by side. */
export function formatFingerprint(fp: Uint8Array): string[] {
  if (fp.length !== FINGERPRINT_BYTES) throw new RangeError('a fingerprint is 20 bytes');
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    // 20 bits start at bit 20*i: two and a half bytes.
    const bit = 20 * i;
    const byte = bit >> 3;
    const window = (fp[byte]! << 16) | (fp[byte + 1]! << 8) | (fp[byte + 2] ?? 0);
    const slice = (window >> (4 - (bit & 7))) & 0xfffff;
    groups.push(String(slice % 100_000).padStart(5, '0'));
  }
  return groups;
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The text a QR code carries: the whole fingerprint, with a version prefix. */
export const fingerprintQr = (fp: Uint8Array): string => `${QR_PREFIX}${toHex(fp)}`;

export function fingerprintFromQr(text: string): Uint8Array | undefined {
  if (!text.startsWith(QR_PREFIX)) return undefined;
  const body = text.slice(QR_PREFIX.length);
  if (!/^[0-9a-f]{40}$/.test(body)) return undefined;
  return Uint8Array.from(body.match(/../g)!, (h) => parseInt(h, 16));
}

/** Exact comparison that does not stop at the first difference. */
export function fingerprintMatches(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
