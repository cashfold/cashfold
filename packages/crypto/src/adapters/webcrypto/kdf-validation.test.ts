import { describe, expect, it } from 'vitest';
import { KdfBelowFloor } from '../../ports/index.js';
import { SecretBuf } from '../../secret-buf.js';
import { toHex } from '../../test-support.js';
import { createHkdf } from './hkdf.js';
import { createPbkdf2, PBKDF2_MIN_ITERATIONS } from './pbkdf2.js';

const pw = () => SecretBuf.from(new TextEncoder().encode('correct horse battery staple'));
const salt = new Uint8Array(16).fill(3);

describe('PBKDF2 Kdf wrapper', () => {
  const kdf = createPbkdf2();

  it('enforces the iteration floor', async () => {
    for (const iterations of [PBKDF2_MIN_ITERATIONS - 1, 1, 0, -5, 1.5, NaN]) {
      await expect(kdf.derive(pw(), salt, { kdf: 'pbkdf2-hmac-sha256', iterations })).rejects.toBeInstanceOf(KdfBelowFloor);
    }
  });

  it('derives 32 deterministic bytes at the floor', async () => {
    const a = await kdf.derive(pw(), salt, { kdf: 'pbkdf2-hmac-sha256', iterations: PBKDF2_MIN_ITERATIONS });
    const b = await kdf.derive(pw(), salt, { kdf: 'pbkdf2-hmac-sha256', iterations: PBKDF2_MIN_ITERATIONS });
    expect(a.length).toBe(32);
    expect(toHex(a.use((x) => x))).toBe(toHex(b.use((x) => x)));
  });

  it('rejects an Argon2id parameter set', async () => {
    await expect(kdf.derive(pw(), salt, { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 })).rejects.toThrow('not a PBKDF2');
  });
});

describe('HKDF output length validation', () => {
  const hkdf = createHkdf();
  it('rejects lengths outside 1..255*32', async () => {
    for (const length of [0, -1, 1.5, 255 * 32 + 1]) {
      await expect(hkdf.derive(pw(), salt, new Uint8Array(), length)).rejects.toThrow(RangeError);
    }
    expect((await hkdf.derive(pw(), salt, new Uint8Array(), 255 * 32)).length).toBe(255 * 32);
  });
});
