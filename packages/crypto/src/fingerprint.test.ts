import { describe, expect, it } from 'vitest';
import { fingerprint, fingerprintFromQr, fingerprintMatches, fingerprintQr, formatFingerprint } from './fingerprint';

const bytes = (from: number, n = 32) => Uint8Array.from({ length: n }, (_, i) => from + i);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// Frozen: computed with an independent reference (Python hashlib) from SHA-256("cashfold.fp.v1" || enc.pk || sig.pk).
const VECTORS = [
  { enc: bytes(0), sig: bytes(32), hex: '67e278de2bce39aa0e6fcae757f0add8df687690', groups: ['25511', '81163', '44698', '59055', '31093', '20365', '88310', '54640'] },
  { enc: new Uint8Array(32).fill(7), sig: new Uint8Array(32).fill(9), hex: '79e619fb80991a24313fad7507da098f8758771c', groups: ['99297', '54208', '27106', '74751', '10480', '14569', '87893', '54780'] },
];

describe('fingerprint (FR-084)', () => {
  it.each(VECTORS)('matches the frozen vector %#', ({ enc, sig, hex: expected, groups }) => {
    const fp = fingerprint(enc, sig);
    expect(fp).toHaveLength(20);
    expect(hex(fp)).toBe(expected);
    expect(formatFingerprint(fp)).toEqual(groups);
  });

  it('shows eight groups of five digits', () => {
    const groups = formatFingerprint(fingerprint(bytes(1), bytes(50)));
    expect(groups).toHaveLength(8);
    for (const g of groups) expect(g).toMatch(/^\d{5}$/);
  });

  it('depends on both keys and on their order', () => {
    const a = bytes(0);
    const b = bytes(40);
    expect(fingerprint(a, b)).not.toEqual(fingerprint(b, a));
    expect(fingerprint(a, b)).not.toEqual(fingerprint(a, bytes(41)));
    expect(fingerprint(a, b)).not.toEqual(fingerprint(bytes(1), b));
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => fingerprint(new Uint8Array(31), bytes(0))).toThrow();
    expect(() => fingerprint(bytes(0), new Uint8Array(33))).toThrow();
  });

  it('round-trips through the QR text with all 160 bits, and rejects anything else', () => {
    const fp = fingerprint(bytes(3), bytes(9));
    const text = fingerprintQr(fp);
    expect(text).toBe(`cf-fp1:${hex(fp)}`);
    expect(fingerprintFromQr(text)).toEqual(fp);
    for (const bad of ['', 'cf-fp1:', `cf-fp2:${hex(fp)}`, `cf-fp1:${hex(fp).slice(2)}`, `cf-fp1:${hex(fp)}00`, `cf-fp1:${'zz'.repeat(20)}`]) {
      expect(fingerprintFromQr(bad)).toBeUndefined();
    }
  });

  it('compares fingerprints exactly', () => {
    const fp = fingerprint(bytes(3), bytes(9));
    expect(fingerprintMatches(fp, Uint8Array.from(fp))).toBe(true);
    const off = Uint8Array.from(fp);
    off[19] = off[19]! ^ 1;
    expect(fingerprintMatches(fp, off)).toBe(false);
    expect(fingerprintMatches(fp, fp.slice(0, 19))).toBe(false);
  });
});
