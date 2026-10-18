import { describe, expect, it } from 'vitest';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { createOpSealer, envelopeToSealed, sealedToEnvelope, SealError, type FieldValue, type OpKeys, type SealableOp, type SealedOp } from './op-sealer';

const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const signer = createEd25519Signer();
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const FOLD = uuid(1);
const FOLD_B = uuid(2);
const DEV = uuid(0xd1);

async function setup() {
  const device = await signer.generate(osRng);
  const folds = new Map<string, SecretBuf>([
    [`${FOLD}:1`, SecretBuf.from(new Uint8Array(32).fill(1))],
    [`${FOLD}:2`, SecretBuf.from(new Uint8Array(32).fill(2))],
    [`${FOLD_B}:1`, SecretBuf.from(new Uint8Array(32).fill(3))],
  ]);
  const keys: OpKeys = {
    foldKey: async (fold, epoch) => folds.get(`${fold}:${epoch}`),
    deviceSigningKey: () => device.secretKey,
    signerPublicKey: async (_fold, dev) => (dev === DEV ? device.publicKey : undefined),
  };
  const sealer = createOpSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng, keys });
  return { sealer, keys, device, folds };
}

const op: SealableOp = {
  fold: FOLD, op: uuid(0x100), rec: uuid(0x200), dev: DEV, seq: 7n, hlc: { wallMs: 1_700_000_000_000, ctr: 3 }, epoch: 1, schema: 1, table: 6,
  fields: new Map<number, FieldValue>([[1, -12345n], [2, 'Coffee'], [3, new Uint8Array([1, 2, 3])], [0xffff, false]]),
  sets: new Map([[10, { add: [uuid(0x51)], rem: [[uuid(0x52), uuid(0x300)] as const] }]]),
};

describe('OpSealer', () => {
  it('seals and opens, preserving exact 64-bit values and set deltas', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal(op);
    expect(sealed.sig).toHaveLength(64);
    expect(sealed.blob.length).toBeGreaterThanOrEqual(12 + 256 + 16);
    expect(await sealer.open(sealed)).toEqual(op);
  });

  it('does not leak plaintext into the sealed op', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal(op);
    expect(Buffer.from(sealed.blob).includes(Buffer.from('Coffee'))).toBe(false);
    expect(JSON.stringify(sealed, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v))).not.toContain('Coffee');
  });

  it('converts to and from the protocol envelope without loss', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal(op);
    expect(envelopeToSealed(sealedToEnvelope(sealed))).toEqual(sealed);
  });

  it('rejects a tampered envelope field before decrypting (signature covers fields 1..10)', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal(op);
    const tampered: Array<[string, SealedOp]> = [
      ['seq', { ...sealed, seq: 8n }],
      ['hlc', { ...sealed, hlc: { ...sealed.hlc, ctr: 4 } }],
      ['epoch', { ...sealed, epoch: 2 }],
      ['schema', { ...sealed, schema: 2 }],
      ['rec', { ...sealed, rec: uuid(0x201) }],
      ['op id', { ...sealed, op: uuid(0x101) }],
      ['fold', { ...sealed, fold: FOLD_B }],
    ];
    for (const [name, t] of tampered) {
      await expect(sealer.open(t), name).rejects.toMatchObject({ kind: 'bad_signature' });
    }
  });

  it('rejects a modified blob', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal(op);
    const blob = Uint8Array.from(sealed.blob);
    blob[40] = blob[40]! ^ 1;
    await expect(sealer.open({ ...sealed, blob })).rejects.toMatchObject({ kind: 'bad_signature' });
  });

  it('a validly signed op whose blob was swapped from another record fails decryption', async () => {
    const { sealer, keys, device } = await setup();
    const a = await sealer.seal(op);
    const b = await sealer.seal({ ...op, op: uuid(0x101), rec: uuid(0x201), fields: new Map([[1, 1n]]) });
    // The relay cannot re-sign, but a device with a valid key (or a bug) could pair A's envelope with B's blob.
    const swapped: SealedOp = { ...a, blob: b.blob };
    const resigned = createOpSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng, keys });
    const env = sealedToEnvelope(swapped);
    const { opSigningBytes } = await import('@cashfold/protocol');
    const sig = await signer.sign(device.secretKey, opSigningBytes({ ...env, sig: new Uint8Array(64) }));
    await expect(resigned.open({ ...swapped, sig })).rejects.toMatchObject({ kind: 'decrypt_failed' });
  });

  it('rejects an op from an unknown device or with the wrong signing key', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal(op);
    await expect(sealer.open({ ...sealed, dev: uuid(0xbad) })).rejects.toMatchObject({ kind: 'unknown_signer' });
    const stranger = await signer.generate(osRng);
    const impostor = createOpSealer({
      aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng,
      keys: { foldKey: async () => SecretBuf.from(new Uint8Array(32).fill(1)), deviceSigningKey: () => stranger.secretKey, signerPublicKey: async () => stranger.publicKey },
    });
    const forged = await impostor.seal(op);
    await expect(sealer.open(forged)).rejects.toMatchObject({ kind: 'bad_signature' });
  });

  it('reports a missing fold key for the epoch, after the signature checks out', async () => {
    const { sealer, keys } = await setup();
    const epoch2 = await sealer.seal({ ...op, epoch: 2 });
    const onlyEpoch1 = createOpSealer({
      aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng,
      keys: { ...keys, foldKey: async (fold, epoch) => (epoch === 1 ? SecretBuf.from(new Uint8Array(32).fill(1)) : undefined) },
    });
    await expect(onlyEpoch1.open(epoch2)).rejects.toMatchObject({ kind: 'unknown_key' });
    await expect(onlyEpoch1.seal({ ...op, epoch: 2 })).rejects.toMatchObject({ kind: 'unknown_key' });
  });

  it('uses a fresh nonce on every seal of the same op', async () => {
    const { sealer } = await setup();
    const a = await sealer.seal(op);
    const b = await sealer.seal(op);
    expect(Buffer.from(a.blob.slice(0, 12)).equals(Buffer.from(b.blob.slice(0, 12)))).toBe(false);
  });

  it('exposes SealError with a machine-readable kind', async () => {
    const { sealer } = await setup();
    await expect(sealer.open({ ...(await sealer.seal(op)), dev: uuid(1) })).rejects.toBeInstanceOf(SealError);
  });

  it('rejects ops with invalid identifiers', async () => {
    const { sealer } = await setup();
    await expect(sealer.seal({ ...op, rec: 'not-a-uuid' })).rejects.toThrow(RangeError);
  });
});
