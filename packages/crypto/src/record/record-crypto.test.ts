import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import vector from '../../../../vectors/kat/record-v1.json' with { type: 'json' };
import { createAesGcm } from '../adapters/webcrypto/aes-gcm.js';
import { createHkdf } from '../adapters/webcrypto/hkdf.js';
import { AeadError, type Rng } from '../ports/index.js';
import { SecretBuf } from '../secret-buf.js';
import { hex, toHex } from '../test-support.js';
import { createRecordCrypto, pad, unpad, type RecordContext } from './record-crypto.js';

const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const crypt = createRecordCrypto({ aead: createAesGcm(), hkdf: createHkdf(), rng: osRng });
const fk = () => SecretBuf.from(hex(vector.fold_key));
const ctx: RecordContext = { foldId: hex(vector.fold_id), recordId: hex(vector.record_id), table: vector.table, epoch: vector.epoch, schema: vector.schema };
const payload = hex(vector.payload);

describe('known answer (independent implementation)', () => {
  const fixed = createRecordCrypto({ aead: createAesGcm(), hkdf: createHkdf(), rng: { bytes: () => hex(vector.nonce) } });

  it('seal reproduces the frozen blob', async () => {
    expect(toHex(await fixed.seal(fk(), ctx, payload))).toBe(vector.blob);
  });

  it('open decrypts the frozen blob', async () => {
    expect(toHex(await crypt.open(fk(), ctx, hex(vector.blob)))).toBe(vector.payload);
  });
});

describe('blob layout', () => {
  it('is nonce(12) || ciphertext of a 256-byte-padded payload || tag(16)', async () => {
    const blob = await crypt.seal(fk(), ctx, payload);
    expect(blob.length).toBe(12 + 256 + 16);
    const big = await crypt.seal(fk(), ctx, new Uint8Array(253)); // 4 + 253 = 257 -> 512
    expect(big.length).toBe(12 + 512 + 16);
  });

  it('uses a fresh nonce on every seal, so re-encrypting identical data differs', async () => {
    const a = await crypt.seal(fk(), ctx, payload);
    const b = await crypt.seal(fk(), ctx, payload);
    expect(toHex(a.slice(0, 12))).not.toBe(toHex(b.slice(0, 12)));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('hides payload length within a 256-byte bucket', async () => {
    const lens = new Set<number>();
    for (const n of [0, 1, 100, 200, 251]) lens.add((await crypt.seal(fk(), ctx, new Uint8Array(n))).length);
    expect(lens.size).toBe(1);
  });
});

describe('binding: swap and tamper tests', () => {
  const swap = <K extends keyof RecordContext>(key: K, value: RecordContext[K]): RecordContext => ({ ...ctx, [key]: value });

  it.each([
    ['another record', swap('recordId', hex('ff'.repeat(16)))],
    ['another fold', swap('foldId', hex('ee'.repeat(16)))],
    ['another table', swap('table', 7)],
    ['another epoch', swap('epoch', 4)],
    ['another schema', swap('schema', 2)],
  ])('a blob moved to %s fails authentication', async (_name, other) => {
    const blob = await crypt.seal(fk(), ctx, payload);
    await expect(crypt.open(fk(), other, blob)).rejects.toBeInstanceOf(AeadError);
  });

  it('fails with a different fold key', async () => {
    const blob = await crypt.seal(fk(), ctx, payload);
    await expect(crypt.open(SecretBuf.from(new Uint8Array(32).fill(1)), ctx, blob)).rejects.toBeInstanceOf(AeadError);
  });

  it('fails on any single flipped bit (nonce, body, tag)', async () => {
    const blob = await crypt.seal(fk(), ctx, payload);
    for (const i of [0, 11, 12, 100, 267, blob.length - 17, blob.length - 1]) {
      const bad = Uint8Array.from(blob);
      bad[i] = bad[i]! ^ 1;
      await expect(crypt.open(fk(), ctx, bad)).rejects.toBeInstanceOf(AeadError);
    }
  });

  it('fails on truncated or extended blobs', async () => {
    const blob = await crypt.seal(fk(), ctx, payload);
    await expect(crypt.open(fk(), ctx, blob.slice(0, 27))).rejects.toBeInstanceOf(AeadError);
    await expect(crypt.open(fk(), ctx, blob.slice(0, blob.length - 1))).rejects.toBeInstanceOf(AeadError);
    await expect(crypt.open(fk(), ctx, new Uint8Array([...blob, 0]))).rejects.toBeInstanceOf(AeadError);
  });

  it('derives a distinct key per record (same payload under two record ids differs in key use)', async () => {
    const a = await createRecordCrypto({ aead: createAesGcm(), hkdf: createHkdf(), rng: { bytes: () => new Uint8Array(12) } }).seal(fk(), ctx, payload);
    const b = await createRecordCrypto({ aead: createAesGcm(), hkdf: createHkdf(), rng: { bytes: () => new Uint8Array(12) } }).seal(fk(), swap('recordId', hex('ff'.repeat(16))), payload);
    expect(toHex(a.slice(12))).not.toBe(toHex(b.slice(12)));
  });
});

describe('table discovery (the table code is inside the payload, so a receiver may not know it)', () => {
  it('finds the table code by authentication', async () => {
    for (const table of [1, 6, 14]) {
      const blob = await crypt.seal(fk(), { ...ctx, table }, payload);
      const { table: found, payload: out } = await crypt.openDiscoveringTable(fk(), { foldId: ctx.foldId, recordId: ctx.recordId, epoch: ctx.epoch, schema: ctx.schema }, blob);
      expect(found).toBe(table);
      expect(toHex(out)).toBe(vector.payload);
    }
  });

  it('fails when no table code authenticates', async () => {
    const blob = await crypt.seal(fk(), { ...ctx, table: 99 }, payload);
    await expect(crypt.openDiscoveringTable(fk(), { foldId: ctx.foldId, recordId: ctx.recordId, epoch: ctx.epoch, schema: ctx.schema }, blob)).rejects.toBeInstanceOf(AeadError);
  });
});

describe('input validation', () => {
  it('rejects malformed identifiers and out-of-range numbers', async () => {
    await expect(crypt.seal(fk(), { ...ctx, foldId: new Uint8Array(15) }, payload)).rejects.toThrow(RangeError);
    await expect(crypt.seal(fk(), { ...ctx, recordId: new Uint8Array(17) }, payload)).rejects.toThrow(RangeError);
    await expect(crypt.seal(fk(), { ...ctx, table: -1 }, payload)).rejects.toThrow(RangeError);
    await expect(crypt.seal(fk(), { ...ctx, table: 256 }, payload)).rejects.toThrow(RangeError);
    await expect(crypt.seal(fk(), { ...ctx, epoch: 2 ** 32 }, payload)).rejects.toThrow(RangeError);
    await expect(crypt.seal(fk(), { ...ctx, schema: 65536 }, payload)).rejects.toThrow(RangeError);
    await expect(crypt.seal(fk(), { ...ctx, epoch: 1.5 }, payload)).rejects.toThrow(RangeError);
  });
});

describe('padding', () => {
  it('pads to a multiple of 256 with a 4-byte length prefix', () => {
    expect(pad(new Uint8Array(0)).length).toBe(256);
    expect(pad(new Uint8Array(252)).length).toBe(256);
    expect(pad(new Uint8Array(253)).length).toBe(512);
    expect(Array.from(pad(Uint8Array.of(9)).slice(0, 5))).toEqual([0, 0, 0, 1, 9]);
  });

  it('property: unpad(pad(x)) = x', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1000 }), (x) => {
        expect(toHex(unpad(pad(x)))).toBe(toHex(x));
      }),
    );
  });

  it('rejects non-canonical padding', () => {
    const good = pad(Uint8Array.of(1, 2, 3));
    const nonZero = Uint8Array.from(good);
    nonZero[100] = 1;
    expect(() => unpad(nonZero)).toThrow(AeadError);
    expect(() => unpad(good.slice(0, 255))).toThrow(AeadError); // not a multiple of 256
    expect(() => unpad(new Uint8Array([...good, ...new Uint8Array(256)]))).toThrow(AeadError); // longer than necessary
    const lying = Uint8Array.from(good);
    lying[3] = 255; // declared length exceeds the buffer
    expect(() => unpad(lying)).toThrow(AeadError);
    expect(() => unpad(new Uint8Array(0))).toThrow(AeadError);
  });
});
