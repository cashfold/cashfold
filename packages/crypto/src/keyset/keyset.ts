import { encode } from '@cashfold/protocol/cbor';
import type { KeySet } from '@cashfold/protocol';
import { x25519PublicKey } from '../adapters/noble/x25519';
import type { Aead, Rng, Signer } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// The personal key set (ARCH 5.4): an X25519 key pair for receiving Fold keys and an Ed25519 key pair for signing.
// The private halves are sealed under the Account Unlock Key (AUK) with AES-256-GCM. The AAD binds each ciphertext
// to this key set and to its role, so ciphertexts cannot be swapped or moved to another key set.

const LABEL = 'cashfold.keyset.v1';
const NONCE_BYTES = 12;

type KdfRecord = KeySet['kdf'];

export class KeySetError extends Error {
  constructor(readonly code: 'public_key_mismatch') {
    super(`Key set rejected (${code})`);
    this.name = 'KeySetError';
  }
}

export interface KeySetPrivate {
  readonly encSk: SecretBuf;
  readonly sigSk: SecretBuf;
}

export interface KeySetService {
  /** Generates a fresh key set. The caller owns the returned private keys and must wipe them. */
  create(args: { auk: SecretBuf; kdf: KdfRecord }): Promise<{ keySet: KeySet } & KeySetPrivate>;
  /** Opens the private keys. Rejects with `AeadError` for a wrong AUK or any tampering. */
  open(keySet: KeySet, auk: SecretBuf): Promise<KeySetPrivate>;
  /**
   * The same keys sealed under a different AUK (password or Secret Key change, recovery). Public keys and uuid stay, so
   * grants and bundles already issued remain valid. The caller wipes the returned private keys.
   */
  rewrap(args: { keySet: KeySet; from: SecretBuf; to: SecretBuf; kdf: KdfRecord }): Promise<{ keySet: KeySet } & KeySetPrivate>;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const aadFor = (uuid: Uint8Array, role: 'enc' | 'sig'): Uint8Array => encode([LABEL, uuid, role]);

export function createKeySetService({ aead, signer, rng }: { aead: Aead; signer: Signer; rng: Rng }): KeySetService {
  async function seal(auk: SecretBuf, uuid: Uint8Array, role: 'enc' | 'sig', secret: SecretBuf): Promise<Uint8Array> {
    const nonce = Uint8Array.from(rng.bytes(NONCE_BYTES));
    const sealed = await secret.use((sk) => aead.seal(auk, nonce, sk, aadFor(uuid, role)));
    return Uint8Array.from([...nonce, ...sealed]);
  }

  async function unseal(auk: SecretBuf, uuid: Uint8Array, role: 'enc' | 'sig', blob: Uint8Array): Promise<SecretBuf> {
    return SecretBuf.take(await aead.open(auk, blob.slice(0, NONCE_BYTES), blob.slice(NONCE_BYTES), aadFor(uuid, role)));
  }

  const service: KeySetService = {
    async create({ auk, kdf }) {
      const uuid = Uint8Array.from(rng.bytes(16));
      const encSk = SecretBuf.take(Uint8Array.from(rng.bytes(32)));
      const sig = await signer.generate(rng);
      try {
        const keySet: KeySet = {
          v: 1,
          uuid,
          enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM', pk: x25519PublicKey(encSk), sk_ct: await seal(auk, uuid, 'enc', encSk) },
          sig: { alg: 'Ed25519', pk: sig.publicKey, sk_ct: await seal(auk, uuid, 'sig', sig.secretKey) },
          kdf,
          encrypted_by: 'mp',
        };
        return { keySet, encSk, sigSk: sig.secretKey };
      } catch (e) {
        encSk.wipe();
        sig.secretKey.wipe();
        throw e;
      }
    },

    async rewrap({ keySet, from, to, kdf }) {
      const keys = await service.open(keySet, from);
      try {
        return {
          keySet: { ...keySet, kdf, enc: { ...keySet.enc, sk_ct: await seal(to, keySet.uuid, 'enc', keys.encSk) }, sig: { ...keySet.sig, sk_ct: await seal(to, keySet.uuid, 'sig', keys.sigSk) } },
          ...keys,
        };
      } catch (e) {
        keys.encSk.wipe();
        keys.sigSk.wipe();
        throw e;
      }
    },

    async open(keySet, auk) {
      const encSk = await unseal(auk, keySet.uuid, 'enc', keySet.enc.sk_ct);
      let sigSk: SecretBuf | undefined;
      try {
        sigSk = await unseal(auk, keySet.uuid, 'sig', keySet.sig.sk_ct);
        const encOk = sameBytes(x25519PublicKey(encSk), keySet.enc.pk);
        const sigOk = sameBytes(await signer.publicKey(sigSk), keySet.sig.pk);
        if (!encOk || !sigOk) throw new KeySetError('public_key_mismatch');
        return { encSk, sigSk };
      } catch (e) {
        encSk.wipe();
        sigSk?.wipe();
        throw e;
      }
    },
  };
  return service;
}
