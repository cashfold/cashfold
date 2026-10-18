import { decodeKeySet, encodeKeySet, type KeySet } from '@cashfold/protocol';
import { describe, expect, it } from 'vitest';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { x25519PublicKey } from '../adapters/noble/x25519';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import { AeadError, type KdfParams, type Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { toHex } from '../test-support';
import { createKeySetService, KeySetError } from './keyset';

const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const service = createKeySetService({ aead: createAesGcm(), signer: createEd25519Signer(), rng: osRng });
const auk = () => SecretBuf.from(new Uint8Array(32).fill(9));
const kdf = { kdf: 'argon2id' as const, m_kib: 65536, t: 3, p: 1, v: 19 as const, enc_salt: new Uint8Array(16).fill(4) };
const asParams = (): KdfParams => ({ kdf: 'argon2id', mKib: 65536, t: 3, p: 1 });

describe('personal key set', () => {
  it('creates an X25519 and an Ed25519 key pair with the private halves sealed under the AUK', async () => {
    const { keySet, encSk, sigSk } = await service.create({ auk: auk(), kdf });
    expect(keySet).toMatchObject({ v: 1, encrypted_by: 'mp', enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM' }, sig: { alg: 'Ed25519' }, kdf });
    expect(keySet.uuid).toHaveLength(16);
    expect(keySet.enc.sk_ct).toHaveLength(12 + 32 + 16);
    expect(keySet.sig.sk_ct).toHaveLength(12 + 32 + 16);
    expect(toHex(x25519PublicKey(encSk))).toBe(toHex(keySet.enc.pk));
    expect(toHex(await createEd25519Signer().publicKey(sigSk))).toBe(toHex(keySet.sig.pk));
    expect(Buffer.from(keySet.enc.sk_ct).includes(Buffer.from(encSk.use((b) => b)))).toBe(false);
  });

  it('opens with the right AUK and returns the same private keys', async () => {
    const made = await service.create({ auk: auk(), kdf });
    const opened = await service.open(made.keySet, auk());
    expect(toHex(opened.encSk.use((b) => b))).toBe(toHex(made.encSk.use((b) => b)));
    expect(toHex(opened.sigSk.use((b) => b))).toBe(toHex(made.sigSk.use((b) => b)));
  });

  it('survives the wire format: encode, decode, open', async () => {
    const made = await service.create({ auk: auk(), kdf });
    const decoded = decodeKeySet(encodeKeySet(made.keySet));
    const opened = await service.open(decoded, auk());
    expect(toHex(opened.sigSk.use((b) => b))).toBe(toHex(made.sigSk.use((b) => b)));
  });

  it('refuses a wrong AUK', async () => {
    const { keySet } = await service.create({ auk: auk(), kdf });
    await expect(service.open(keySet, SecretBuf.from(new Uint8Array(32).fill(8)))).rejects.toBeInstanceOf(AeadError);
  });

  it('binds each ciphertext to the key set id and to its role (enc or sig)', async () => {
    const { keySet } = await service.create({ auk: auk(), kdf });
    const swapped: KeySet = { ...keySet, enc: { ...keySet.enc, sk_ct: keySet.sig.sk_ct }, sig: { ...keySet.sig, sk_ct: keySet.enc.sk_ct } };
    await expect(service.open(swapped, auk())).rejects.toBeInstanceOf(AeadError);
    await expect(service.open({ ...keySet, uuid: new Uint8Array(16).fill(1) }, auk())).rejects.toBeInstanceOf(AeadError);
    const flipped = Uint8Array.from(keySet.enc.sk_ct);
    flipped[20] = flipped[20]! ^ 1;
    await expect(service.open({ ...keySet, enc: { ...keySet.enc, sk_ct: flipped } }, auk())).rejects.toBeInstanceOf(AeadError);
  });

  it('rejects a key set whose public key does not belong to the private key', async () => {
    const a = await service.create({ auk: auk(), kdf });
    const b = await service.create({ auk: auk(), kdf });
    const forged: KeySet = { ...a.keySet, enc: { ...a.keySet.enc, pk: b.keySet.enc.pk } };
    await expect(service.open(forged, auk())).rejects.toMatchObject({ code: 'public_key_mismatch' });
    await expect(service.open(forged, auk())).rejects.toBeInstanceOf(KeySetError);
  });

  it('uses fresh randomness for the id, the keys and the nonces', async () => {
    const a = await service.create({ auk: auk(), kdf });
    const b = await service.create({ auk: auk(), kdf });
    expect(toHex(a.keySet.uuid)).not.toBe(toHex(b.keySet.uuid));
    expect(toHex(a.keySet.enc.pk)).not.toBe(toHex(b.keySet.enc.pk));
    expect(toHex(a.keySet.enc.sk_ct.slice(0, 12))).not.toBe(toHex(b.keySet.enc.sk_ct.slice(0, 12)));
  });

  it('records the KDF parameters it was created with, in the wire shape', async () => {
    const { keySet } = await service.create({ auk: auk(), kdf });
    expect(keySet.kdf).toEqual(kdf);
    expect(asParams()).toEqual({ kdf: 'argon2id', mKib: 65536, t: 3, p: 1 });
  });
});
