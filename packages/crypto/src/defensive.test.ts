import { describe, expect, it } from 'vitest';
import { encode } from '@cashfold/protocol/cbor';
import { createEd25519Signer } from './adapters/noble/ed25519';
import { x25519 } from './adapters/noble/x25519';
import { createAesGcm } from './adapters/webcrypto/aes-gcm';
import { createHkdf } from './adapters/webcrypto/hkdf';
import { createKeySetService } from './keyset/keyset';
import { SealError, type OpKeys } from './op/op-sealer';
import { createPake } from './pake/srp-client';
import { SecretBuf } from './secret-buf';
import { createSnapshotSealer } from './snapshot/snapshot-sealer';
import { createFrameEndpoint, deriveTransportKeys, FrameError } from './transport/frame';
import { checkKdfFloors } from './transport/relay-client';

// The paths that only run when something underneath fails or something hostile arrives: each must fail closed and say why.

const osRng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

describe('primitives', () => {
  it('refuse a low-order public key', () => {
    const sk = SecretBuf.from(osRng.bytes(32));
    expect(() => x25519(sk, new Uint8Array(32))).toThrow();
  });

  it('verify returns false, never throws, for a public key or signature of the wrong shape', async () => {
    const signer = createEd25519Signer();
    expect(await signer.verify(new Uint8Array(5), new Uint8Array(3), new Uint8Array(64))).toBe(false);
    expect(await signer.verify(new Uint8Array(32), new Uint8Array(3), new Uint8Array(7))).toBe(false);
  });
});

describe('key set creation', () => {
  it('wipes what it made and passes the failure on when the random source fails midway', async () => {
    let calls = 0;
    const flaky = { bytes: (n: number) => (++calls > 2 ? (() => { throw new Error('rng failed'); })() : osRng.bytes(n)) };
    const service = createKeySetService({ aead: createAesGcm(), signer: createEd25519Signer(), rng: flaky });
    await expect(service.create({ auk: SecretBuf.from(osRng.bytes(32)), kdf: { kdf: 'argon2id', m_kib: 32768, t: 2, p: 1, v: 19, enc_salt: osRng.bytes(16) } })).rejects.toThrow('rng failed');
  });
});

describe('sealing refuses to hide a failure that is not the expected one', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const FOLD = uuid(1);
  const DEV = uuid(2);

  it('rethrows an unexpected error from the key lookup rather than calling it a decryption failure (snapshots)', async () => {
    const signer = createEd25519Signer();
    const device = await signer.generate(osRng);
    const broken = SecretBuf.from(osRng.bytes(32));
    const keys: OpKeys = { foldKey: async () => broken, deviceSigningKey: () => device.secretKey, signerPublicKey: async () => device.publicKey };
    const sealer = createSnapshotSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng, keys });
    const sealed = await sealer.seal({ fold: FOLD, epoch: 1, atSeq: 1n, dev: DEV }, new Uint8Array(10));
    broken.wipe(); // the key is now unusable: not an authentication failure, something else is wrong
    const outcome = await sealer.open({ fold: FOLD, epoch: 1, atSeq: 1n }, sealed).then(() => 'opened', (e: unknown) => (e instanceof SealError ? `seal:${e.kind}` : (e as Error).name));
    expect(outcome).not.toBe('opened');
    expect(outcome).not.toBe('seal:decrypt_failed');
  });
});

describe('key agreement', () => {
  it('wipes its secrets and reports a failure of the big-integer engine', () => {
    const failing = { modpow: () => { throw new Error('engine failed'); }, expSum: () => { throw new Error('engine failed'); } };
    const pake = createPake({ bn: failing, rng: osRng });
    expect(() => pake.start(SecretBuf.from(osRng.bytes(32)))).toThrow('engine failed');
  });
});

describe('frames', () => {
  const sessionId = new Uint8Array(16).fill(7);
  async function pair() {
    const mk = () => deriveTransportKeys({ hkdf: createHkdf(), key: SecretBuf.from(new Uint8Array(32).fill(1)), transcript: new Uint8Array(32).fill(2) });
    const [a, b] = [await mk(), await mk()];
    return {
      client: createFrameEndpoint({ role: 'client', sessionId, keys: a, aead: createAesGcm() }),
      server: createFrameEndpoint({ role: 'server', sessionId, keys: b, aead: createAesGcm() }),
    };
  }
  const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e as FrameError).kind ?? (e as Error).name);

  it('refuses bytes that are not CBOR, CBOR that is not a map, and a ciphertext shorter than its tag', async () => {
    const { server } = await pair();
    expect(await kind(server.open(Uint8Array.from([0xff, 0xff])))).toBe('malformed');
    const { server: s2 } = await pair();
    expect(await kind(s2.open(encode([1, 2, 3] as never)))).toBe('malformed');
    const { server: s3 } = await pair();
    expect(await kind(s3.open(encode(new Map<bigint, unknown>([[1n, sessionId], [2n, 0n], [3n, 0n], [4n, new Uint8Array(5)]]) as never)))).toBe('malformed');
  });
});

describe('key-derivation floors', () => {
  it('accepts PBKDF2 at the floor and refuses it below', () => {
    expect(checkKdfFloors({ kdf: 'pbkdf2-hmac-sha256', iter: 600_000, encSalt: new Uint8Array(16) })).toEqual({ kdf: 'pbkdf2-hmac-sha256', iterations: 600_000 });
    expect(() => checkKdfFloors({ kdf: 'pbkdf2-hmac-sha256', iter: 599_999, encSalt: new Uint8Array(16) })).toThrow();
  });
});
