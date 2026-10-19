import { describe, expect, it } from 'vitest';
import { checkKdfPolicy, KDF_FLOORS, type KdfSettings } from './kdf-policy';

const argon = (over: Partial<Extract<KdfSettings, { kdf: 'argon2id' }>> = {}): KdfSettings => ({ kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, ...over });

describe('key-derivation policy (FR-019)', () => {
  it('accepts settings at or above the floors', () => {
    expect(checkKdfPolicy(argon()).ok).toBe(true);
    expect(checkKdfPolicy(argon({ mKib: KDF_FLOORS.argon2id.mKib, t: KDF_FLOORS.argon2id.t, p: KDF_FLOORS.argon2id.p })).ok).toBe(true);
    expect(checkKdfPolicy({ kdf: 'pbkdf2-hmac-sha256', iterations: 600_000 }).ok).toBe(true);
    expect(checkKdfPolicy(argon({ mKib: 1_000_000, t: 10, p: 4 })).ok).toBe(true);
  });

  it.each([
    ['memory', argon({ mKib: 32_767 })], ['passes', argon({ t: 1 })], ['parallelism', argon({ p: 0 })],
    ['pbkdf2', { kdf: 'pbkdf2-hmac-sha256', iterations: 599_999 } as KdfSettings],
  ])('refuses %s below the floor, and says which it was', (_name, settings) => {
    const r = checkKdfPolicy(settings);
    expect(r).toMatchObject({ ok: false, error: { code: 'kdf_below_floor' } });
  });

  it.each([
    argon({ mKib: Number.NaN }), argon({ t: 2.5 }), argon({ mKib: -1 }), argon({ mKib: 2 ** 40 }), argon({ t: 1000 }),
    { kdf: 'scrypt' } as unknown as KdfSettings, { kdf: 'pbkdf2-hmac-sha256', iterations: 2 ** 40 } as KdfSettings,
  ])('refuses malformed or absurd settings (%#)', (settings) => {
    expect(checkKdfPolicy(settings)).toMatchObject({ ok: false, error: { code: expect.stringMatching(/kdf_below_floor|kdf_invalid/) as string } });
  });

  it('never reveals what a server offered beyond the code', () => {
    const r = checkKdfPolicy(argon({ mKib: 1 }));
    expect(r.ok ? '' : r.error.message).not.toMatch(/\d/);
  });
});
