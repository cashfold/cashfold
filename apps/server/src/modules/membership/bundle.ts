import { decodeKeySet } from '@cashfold/protocol';
import { verifyEd25519 } from '../folds/folds.service.js';

// A person's public key bundle: account id, both public keys, and a signature made with the signing key inside it
// (`"cashfold.bundle.v1" || len16(account) || account || enc.pk || sig.pk`). The relay checks it when it is registered and
// hands it out unchanged; whoever receives it checks it again.

export function keysFromKeyset(keyset: Uint8Array): { encPk: Uint8Array; sigPk: Uint8Array } | undefined {
  try {
    const k = decodeKeySet(keyset);
    return { encPk: k.enc.pk, sigPk: k.sig.pk };
  } catch {
    return undefined;
  }
}

export function verifyBundleSignature(accountId: string, encPk: Uint8Array, sigPk: Uint8Array, selfSig: Uint8Array): boolean {
  const id = Buffer.from(accountId, 'utf8');
  const lengthPrefix = Buffer.alloc(2);
  lengthPrefix.writeUInt16BE(id.length);
  return verifyEd25519(sigPk, Buffer.concat([Buffer.from('cashfold.bundle.v1'), lengthPrefix, id, encPk, sigPk]), selfSig);
}
