import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rng } from '../ports/index';
import { generateSecretKey, parseSecretKey, SECRET_ALPHABET, SecretKeyError } from './secret-key';

const fixed = (bytes: number[]): Rng => ({ bytes: (n) => Uint8Array.from(bytes.slice(0, n)) });
const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
// 4 bytes for the account id, then 17 bytes (136 bits) of which 130 are used for the secret.
const stream = (id: number[], secret: number[]) => fixed([...id, ...secret]);
const SHAPE = /^C1-[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{11}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

describe('alphabet', () => {
  it('has 32 symbols and leaves out the look-alikes I, O, 0 and 1', () => {
    expect(SECRET_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(new Set(SECRET_ALPHABET).size).toBe(32);
    for (const c of 'IO01') expect(SECRET_ALPHABET).not.toContain(c);
  });
});

describe('generation (130 secret bits, 5 per character, no modulo bias)', () => {
  it('maps bits to characters most-significant-bit first (known answers)', () => {
    const zero = generateSecretKey(stream([0, 0, 0, 0], new Array(17).fill(0)));
    expect(zero.format()).toBe('C1-AAAAAA-AAAAAAAAAAA-AAAAA-AAAAA-AAAAA');
    const ones = generateSecretKey(stream([255, 255, 255, 255], new Array(17).fill(255)));
    expect(ones.format()).toBe('C1-999999-99999999999-99999-99999-99999');
    const mixed = generateSecretKey(stream([0xab, 0xcd, 0xef, 0x01], Array.from({ length: 17 }, (_, i) => i + 1)));
    expect(mixed.accountId).toBe('XRG88A');
    expect(mixed.format()).toBe('C1-XRG88A-AEBAGBAFA2D-SSCJL-BNGA4-DSRCA');
  });

  it('uses exactly 130 bits of the secret and 30 bits of the account id; the leftover bits are discarded', () => {
    const base = Array.from({ length: 17 }, (_, i) => i + 1);
    const a = generateSecretKey(stream([0xab, 0xcd, 0xef, 0x00], base));
    const b = generateSecretKey(stream([0xab, 0xcd, 0xef, 0x03], base.slice(0, 16).concat([base[16]! | 0x0f])));
    expect(b.accountId).toBe(a.accountId); // low 2 bits of the 4th byte are unused
    expect(b.format().slice(10)).toBe(a.format().slice(10)); // low 4 bits of the 17th byte are unused
    const c = generateSecretKey(stream([0xab, 0xcd, 0xef, 0x00], base.slice(0, 16).concat([base[16]! ^ 0x80])));
    expect(c.format()).not.toBe(a.format()); // a used bit does change the key
  });

  it('always has the documented shape', () => {
    fc.assert(fc.property(fc.uint8Array({ minLength: 21, maxLength: 21 }), (bytes) => {
      expect(generateSecretKey(fixed(Array.from(bytes))).format()).toMatch(SHAPE);
    }));
  });

  it('is unique and uniformly distributed over many keys from the system RNG', () => {
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const key = generateSecretKey(osRng).format();
      seen.add(key);
      for (const c of key.slice(10).replaceAll('-', '')) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(seen.size).toBe(1000);
    const expected = (1000 * 26) / 32;
    for (const c of SECRET_ALPHABET) expect(Math.abs((counts.get(c) ?? 0) - expected)).toBeLessThan(expected * 0.2);
  });

  it('keeps the secret characters out of serialisation and inspection', () => {
    const key = generateSecretKey(osRng);
    const secret = key.format().slice(10).replaceAll('-', '');
    expect(JSON.stringify(key)).not.toContain(secret);
    expect(JSON.stringify(key)).toContain(key.accountId);
    expect(String(key)).not.toContain(secret);
  });

  it('wipes the secret on request', () => {
    const key = generateSecretKey(osRng);
    key.wipe();
    expect(key.secret.isWiped).toBe(true);
    expect(() => key.format()).toThrow();
  });
});

describe('parsing', () => {
  const sample = 'C1-XRG88A-AEBAGBAFA2D-SSCJL-BNGA4-DSRCA';

  it.each([
    ['display form', sample],
    ['without hyphens', 'C1XRG88AAEBAGBAFA2DSSCJLBNGA4DSRCA'],
    ['lower case', sample.toLowerCase()],
    ['with spaces and a newline', 'C1 XRG88A\nAEBAGBAFA2D SSCJL BNGA4 DSRCA '],
    ['with non-breaking spaces', `C1 XRG88A AEBAGBAFA2D${' '}SSCJLBNGA4DSRCA`],
  ])('accepts %s', (_name, text) => {
    expect(parseSecretKey(text).format()).toBe(sample);
  });

  it('round-trips any generated key', () => {
    fc.assert(fc.property(fc.uint8Array({ minLength: 21, maxLength: 21 }), (bytes) => {
      const key = generateSecretKey(fixed(Array.from(bytes)));
      expect(parseSecretKey(key.format()).format()).toBe(key.format());
    }));
  });

  it.each([
    ['too short', 'C1-XRG88A-AEBAGBAFA2D-SSCJL-BNGA4-DSRC', 'invalid_length'],
    ['too long', `${sample}A`, 'invalid_length'],
    ['empty', '', 'invalid_length'],
    ['unknown version tag', sample.replace('C1', 'C2'), 'invalid_version'],
    ['letter I', sample.replace('AEBAGB', 'AEIAGB'), 'invalid_character'],
    ['letter O', sample.replace('SSCJL', 'SSOJL'), 'invalid_character'],
    ['digit 0', sample.replace('BNGA4', 'BNGA0'), 'invalid_character'],
    ['digit 1', sample.replace('DSRCA', '1SRCA'), 'invalid_character'],
    ['punctuation', sample.replace('SSCJL', 'SS!JL'), 'invalid_character'],
  ])('rejects %s', (_name, text, code) => {
    expect(() => parseSecretKey(text)).toThrow(SecretKeyError);
    try { parseSecretKey(text); } catch (e) { expect((e as SecretKeyError).code).toBe(code); }
  });

  it('never echoes the rejected text in the error', () => {
    try { parseSecretKey('C1-SECRETSECRET-LEAK'); } catch (e) { expect(String((e as Error).message)).not.toMatch(/SECRETSECRET|LEAK/); }
  });

  it('can make a new secret for an existing account, keeping its id', () => {
    const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
    const a = generateSecretKey(rng, 'ABCDEF');
    const b = generateSecretKey(rng, 'ABCDEF');
    expect(a.accountId).toBe('ABCDEF');
    expect(a.format().startsWith('C1-ABCDEF-')).toBe(true);
    expect(a.format()).not.toBe(b.format());
  });
});
