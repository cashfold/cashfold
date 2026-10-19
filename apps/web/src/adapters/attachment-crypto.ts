import { attachmentKey, createAesGcm, createAttachmentCrypto, createHkdf, SecretBuf, type Rng } from '@cashfold/crypto';
import { idToBytes, type AttachmentCryptoPort, type Id } from '@cashfold/core';
import type { FoldKeyring } from './sqlite-opfs/fold-store';

// Sealing attachments with the Fold key (FR-093). The key of a file is derived from the Fold key and the file's id; the 4-byte nonce
// prefix that every frame of the file shares travels in front of the first piece, so a piece on its own is all a device needs.

export function createWebAttachmentCrypto(deps: { keyring: () => FoldKeyring | undefined; rng: Rng }): AttachmentCryptoPort {
  const frames = createAttachmentCrypto({ aead: createAesGcm(), rng: deps.rng });
  const hkdf = createHkdf();
  const keyOf = async (fold: Id, epoch: number, attachment: Id): Promise<SecretBuf> => {
    const foldKey = await deps.keyring()?.key(fold, epoch);
    if (foldKey === undefined) throw new Error('no key for that epoch');
    return attachmentKey(hkdf, foldKey, idToBytes(attachment));
  };
  return {
    async seal(fold, epoch, attachment, plain) {
      const key = await keyOf(fold, epoch, attachment);
      try {
        const sealed = await frames.seal(key, idToBytes(attachment), plain);
        return sealed.frames.map((f, i) => (i === 0 ? Uint8Array.from([...sealed.prefix, ...f]) : f));
      } finally {
        key.wipe();
      }
    },
    async open(fold, epoch, attachment, pieces) {
      const first = pieces[0];
      if (first === undefined || first.length < 4) throw new Error('empty attachment');
      const key = await keyOf(fold, epoch, attachment);
      try {
        return await frames.open(key, idToBytes(attachment), { prefix: first.slice(0, 4), frames: pieces.map((p, i) => (i === 0 ? p.slice(4) : p)) });
      } finally {
        key.wipe();
      }
    },
  };
}
