import { describe, expect, it } from 'vitest';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { SealError, type OpKeys } from '../op/op-sealer';
import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { createSnapshotSealer } from './snapshot-sealer';

const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const signer = createEd25519Signer();
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const FOLD = uuid(1);
const DEV = uuid(0xd1);

async function setup() {
  const device = await signer.generate(osRng);
  const other = await signer.generate(osRng);
  const folds = new Map<string, SecretBuf>([[`${FOLD}:1`, SecretBuf.from(new Uint8Array(32).fill(1))], [`${uuid(2)}:1`, SecretBuf.from(new Uint8Array(32).fill(3))]]);
  const keys: OpKeys = {
    foldKey: async (fold, epoch) => folds.get(`${fold}:${epoch}`),
    deviceSigningKey: () => device.secretKey,
    signerPublicKey: async (_f, dev) => (dev === DEV ? device.publicKey : dev === uuid(0xd2) ? other.publicKey : undefined),
  };
  return { sealer: createSnapshotSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng, keys }), keys, device };
}
const ctx = { fold: FOLD, epoch: 1, atSeq: 42n };
const payload = Uint8Array.from({ length: 700 }, (_, i) => i % 251);
const fails = async (p: Promise<unknown>, kind: string) => expect(await p.then(() => 'ok', (e: unknown) => (e as SealError).kind)).toBe(kind);

describe('snapshot sealer', () => {
  it('round-trips a payload and names the signing device', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal({ ...ctx, dev: DEV }, payload);
    expect(await sealer.open(ctx, sealed)).toEqual({ payload, dev: DEV });
    expect(sealed.sig).toHaveLength(64);
  });

  it('hides the length within a bucket and does not leak the payload', async () => {
    const { sealer } = await setup();
    const [a, b] = [await sealer.seal({ ...ctx, dev: DEV }, new Uint8Array(300)), await sealer.seal({ ...ctx, dev: DEV }, new Uint8Array(400))];
    expect(a.blob.length).toBe(b.blob.length);
    expect(Buffer.from(a.blob).includes(Buffer.from(new Uint8Array(40)))).toBe(false);
  });

  it('refuses any flipped bit in the blob or the signature', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal({ ...ctx, dev: DEV }, payload);
    for (const at of [0, 20, 40, sealed.blob.length - 1]) {
      const blob = Uint8Array.from(sealed.blob);
      blob[at] = blob[at]! ^ 1;
      await fails(sealer.open(ctx, { ...sealed, blob }), at < 16 ? 'unknown_signer' : 'bad_signature');
    }
    const sig = Uint8Array.from(sealed.sig);
    sig[3] = sig[3]! ^ 1;
    await fails(sealer.open(ctx, { ...sealed, sig }), 'bad_signature');
  });

  it('binds the snapshot to its Fold, epoch and position', async () => {
    const { sealer } = await setup();
    const sealed = await sealer.seal({ ...ctx, dev: DEV }, payload);
    await fails(sealer.open({ ...ctx, atSeq: 41n }, sealed), 'bad_signature'); // a relay cannot present it as an earlier or later checkpoint
    await fails(sealer.open({ ...ctx, epoch: 2 }, sealed), 'bad_signature');
    await fails(sealer.open({ ...ctx, fold: uuid(2) }, sealed), 'bad_signature');
  });

  it('rejects a snapshot signed by a device the Fold does not know, and one signed by the wrong key', async () => {
    const { sealer, keys } = await setup();
    const sealed = await sealer.seal({ ...ctx, dev: uuid(0xee) }, payload);
    await fails(sealer.open(ctx, sealed), 'unknown_signer');
    const claimed = await sealer.seal({ ...ctx, dev: uuid(0xd2) }, payload); // signed with `device` but claims the other device
    await fails(sealer.open(ctx, claimed), 'bad_signature');
    void keys;
  });

  it('fails when the device holds no key for the epoch', async () => {
    const { sealer } = await setup();
    await fails(sealer.seal({ ...ctx, epoch: 9, dev: DEV }, payload), 'unknown_key');
    const sealed = await sealer.seal({ ...ctx, dev: DEV }, payload);
    await fails(sealer.open({ ...ctx, epoch: 9 }, sealed), 'bad_signature');
  });

  it('rejects a truncated blob', async () => {
    const { sealer } = await setup();
    await fails(sealer.open(ctx, { blob: new Uint8Array(10), sig: new Uint8Array(64) }), 'malformed');
  });
});
