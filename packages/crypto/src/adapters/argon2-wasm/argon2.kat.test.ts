import { argon2id as nobleArgon2id } from '@noble/hashes/argon2.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import vector from '../../../../../vectors/kat/argon2id.json' with { type: 'json' };
import { KdfBelowFloor } from '../../ports/index';
import { SecretBuf } from '../../secret-buf';
import { hex, toHex } from '../../test-support';
import { argon2idRaw, createArgon2Kdf } from './argon2id';

describe('Argon2id (RFC 9106 section 5.3)', () => {
  it('reference implementation (noble, pure JS) reproduces the RFC tag including secret and associated data', () => {
    const tag = nobleArgon2id(hex(vector.password), hex(vector.salt), {
      m: vector.memory_kib, t: vector.passes, p: vector.parallelism, dkLen: vector.tag_length,
      key: hex(vector.secret), personalization: hex(vector.associated_data), version: 0x13,
    });
    expect(toHex(tag)).toBe(vector.tag);
  });

  it('WASM build agrees with the reference on the RFC password/salt/parameters (no secret or AD: hash-wasm lacks AD)', async () => {
    const wasm = await argon2idRaw({ password: hex(vector.password), salt: hex(vector.salt), mKib: vector.memory_kib, t: vector.passes, p: vector.parallelism, length: vector.tag_length });
    const ref = nobleArgon2id(hex(vector.password), hex(vector.salt), { m: vector.memory_kib, t: vector.passes, p: vector.parallelism, dkLen: vector.tag_length });
    expect(toHex(wasm)).toBe(toHex(ref));
  });

  it('property: WASM equals the reference for random inputs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 40 }), fc.uint8Array({ minLength: 8, maxLength: 32 }), fc.integer({ min: 1, max: 3 }), async (password, salt, p) => {
        const wasm = await argon2idRaw({ password, salt, mKib: 8 * p, t: 1, p, length: 32 });
        const ref = nobleArgon2id(password, salt, { m: 8 * p, t: 1, p, dkLen: 32 });
        expect(toHex(wasm)).toBe(toHex(ref));
      }),
      { numRuns: 15 },
    );
  });
});

describe('Argon2id parameter floors (m >= 32768 KiB, t >= 2, p >= 1)', () => {
  const kdf = createArgon2Kdf();
  const pw = () => SecretBuf.from(new TextEncoder().encode('correct horse'));
  const salt = new Uint8Array(16).fill(5);

  it.each([
    { mKib: 32767, t: 2, p: 1 },
    { mKib: 32768, t: 1, p: 1 },
    { mKib: 32768, t: 2, p: 0 },
    { mKib: 1024, t: 3, p: 4 },
  ])('rejects %j with KdfBelowFloor', async (params) => {
    await expect(kdf.derive(pw(), salt, { kdf: 'argon2id', ...params })).rejects.toBeInstanceOf(KdfBelowFloor);
  });

  it('rejects the wrong KDF kind', async () => {
    await expect(kdf.derive(pw(), salt, { kdf: 'pbkdf2-hmac-sha256', iterations: 650_000 })).rejects.toThrow();
  });

  it('derives 32 bytes at the floor and is deterministic', async () => {
    const a = await kdf.derive(pw(), salt, { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 });
    const b = await kdf.derive(pw(), salt, { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 });
    expect(a.length).toBe(32);
    expect(toHex(a.use((x) => x))).toBe(toHex(b.use((x) => x)));
  });
});
