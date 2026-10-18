import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519, x25519PublicKey } from '../adapters/noble/x25519';
import type { Aead, Hpke, KeyPair, Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// RFC 9180, base mode: DHKEM(X25519, HKDF-SHA256) [0x0020], HKDF-SHA256 [0x0001], AEAD [0x0001 AES-128 | 0x0002 AES-256].
const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const N_SECRET = 32;
const N_NONCE = 12;
const N_PK = 32;
const MODE_BASE = 0;

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const i2osp2 = (n: number): Uint8Array => Uint8Array.of((n >> 8) & 0xff, n & 0xff);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const SUITE_ID_KEM = concat(ascii('KEM'), i2osp2(KEM_ID));

function labeledExtract(suiteId: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
  return extract(sha256, concat(ascii('HPKE-v1'), suiteId, ascii(label), ikm), salt);
}

function labeledExpand(suiteId: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array {
  return expand(sha256, prk, concat(i2osp2(length), ascii('HPKE-v1'), suiteId, ascii(label), info), length);
}

function deriveKeyPair(ikm: Uint8Array): KeyPair {
  const prk = labeledExtract(SUITE_ID_KEM, new Uint8Array(0), 'dkp_prk', ikm);
  const secretKey = SecretBuf.take(labeledExpand(SUITE_ID_KEM, prk, 'sk', new Uint8Array(0), 32));
  return { secretKey, publicKey: x25519PublicKey(secretKey) };
}

function sharedSecret(dh: SecretBuf, kemContext: Uint8Array): Uint8Array {
  const prk = dh.use((raw) => labeledExtract(SUITE_ID_KEM, new Uint8Array(0), 'eae_prk', raw));
  return labeledExpand(SUITE_ID_KEM, prk, 'shared_secret', kemContext, N_SECRET);
}

export interface HpkeConfig {
  readonly aead: Aead;
  /** 0x0001 AES-128-GCM (RFC vectors only) or 0x0002 AES-256-GCM (production). */
  readonly aeadId: 1 | 2;
}

export function createHpke({ aead, aeadId }: HpkeConfig): Hpke {
  const suiteId = concat(ascii('HPKE'), i2osp2(KEM_ID), i2osp2(KDF_ID), i2osp2(aeadId));
  const nK = aeadId === 1 ? 16 : 32;

  async function keySchedule(secret: Uint8Array, info: Uint8Array): Promise<{ key: SecretBuf; baseNonce: Uint8Array }> {
    const empty = new Uint8Array(0);
    const pskIdHash = labeledExtract(suiteId, empty, 'psk_id_hash', empty);
    const infoHash = labeledExtract(suiteId, empty, 'info_hash', info);
    const context = concat(Uint8Array.of(MODE_BASE), pskIdHash, infoHash);
    const prk = labeledExtract(suiteId, secret, 'secret', empty);
    return {
      key: SecretBuf.take(labeledExpand(suiteId, prk, 'key', context, nK)),
      baseNonce: labeledExpand(suiteId, prk, 'base_nonce', context, N_NONCE),
    };
  }

  return {
    async generate(rng: Rng) {
      return deriveKeyPair(rng.bytes(32));
    },

    async seal({ recipientPublicKey, info, aad, plaintext, rng }) {
      if (recipientPublicKey.length !== N_PK) throw new RangeError('invalid recipient public key');
      const ephemeral = deriveKeyPair(rng.bytes(32));
      const dh = x25519(ephemeral.secretKey, recipientPublicKey);
      ephemeral.secretKey.wipe();
      const secret = sharedSecret(dh, concat(ephemeral.publicKey, recipientPublicKey));
      dh.wipe();
      const { key, baseNonce } = await keySchedule(secret, info);
      try {
        return { enc: ephemeral.publicKey, ct: await aead.seal(key, baseNonce, plaintext, aad) };
      } finally {
        key.wipe();
      }
    },

    async open({ recipientSecretKey, enc, info, aad, ct }) {
      if (enc.length !== N_PK) throw new RangeError('invalid encapsulated key');
      const dh = x25519(recipientSecretKey, enc);
      const secret = sharedSecret(dh, concat(enc, x25519PublicKey(recipientSecretKey)));
      dh.wipe();
      const { key, baseNonce } = await keySchedule(secret, info);
      try {
        return await aead.open(key, baseNonce, ct, aad);
      } finally {
        key.wipe();
      }
    },
  };
}
