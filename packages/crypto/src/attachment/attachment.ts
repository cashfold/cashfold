import type { Aead, Hkdf, Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// Attachments (FR-093, ARCH 9.8): a file is cut into 64 KiB frames, each sealed on its own with AES-256-GCM.
//   key   = HKDF(Fold key, "cashfold.attachment.v1" || attachment id)
//   nonce = 4 random bytes (one per attachment) || 8-byte frame counter, so no two frames of a file share a nonce
//   AAD   = attachment id || 4-byte frame index || 1 byte "this is the last frame"
// The index binds each frame to its place and the last-frame flag binds the end, so a relay that drops, reorders, repeats or
// cuts frames is caught when the file is opened.

export const ATTACHMENT_FRAME = 65_536;
const TAG = 16;

export class AttachmentError extends Error {
  constructor(readonly code: 'invalid_id' | 'no_frames' | 'too_large') {
    super(`Attachment rejected (${code})`);
    this.name = 'AttachmentError';
  }
}

export interface SealedAttachment {
  readonly prefix: Uint8Array;
  readonly frames: readonly Uint8Array[];
}

export interface AttachmentCrypto {
  seal(key: SecretBuf, id: Uint8Array, plain: Uint8Array): Promise<SealedAttachment>;
  /** Rejects with `AeadError` if any frame is missing, extra, moved or changed. */
  open(key: SecretBuf, id: Uint8Array, sealed: SealedAttachment): Promise<Uint8Array>;
  nonce(prefix: Uint8Array, counter: number): Uint8Array;
}

export async function attachmentKey(hkdf: Hkdf, foldKey: SecretBuf, id: Uint8Array): Promise<SecretBuf> {
  return hkdf.derive(foldKey, new Uint8Array(0), Uint8Array.from([...new TextEncoder().encode('cashfold.attachment.v1'), ...id]), 32);
}

export function createAttachmentCrypto({ aead, rng }: { aead: Aead; rng: Rng }): AttachmentCrypto {
  const nonce = (prefix: Uint8Array, counter: number): Uint8Array => {
    const out = new Uint8Array(12);
    out.set(prefix);
    new DataView(out.buffer).setBigUint64(4, BigInt(counter), false);
    return out;
  };
  const aad = (id: Uint8Array, index: number, last: boolean): Uint8Array => {
    const out = new Uint8Array(id.length + 5);
    out.set(id);
    new DataView(out.buffer).setUint32(id.length, index, false);
    out[id.length + 4] = last ? 1 : 0;
    return out;
  };
  const checkId = (id: Uint8Array): void => {
    if (id.length !== 16) throw new AttachmentError('invalid_id');
  };

  return {
    nonce,

    async seal(key, id, plain) {
      checkId(id);
      const count = Math.max(1, Math.ceil(plain.length / ATTACHMENT_FRAME));
      if (count > 0xffff_ffff) throw new AttachmentError('too_large');
      const prefix = Uint8Array.from(rng.bytes(4));
      const frames: Uint8Array[] = [];
      for (let i = 0; i < count; i++) {
        const piece = plain.subarray(i * ATTACHMENT_FRAME, (i + 1) * ATTACHMENT_FRAME);
        frames.push(await aead.seal(key, nonce(prefix, i), piece, aad(id, i, i === count - 1)));
      }
      return { prefix, frames };
    },

    async open(key, id, sealed) {
      checkId(id);
      if (sealed.frames.length === 0) throw new AttachmentError('no_frames');
      const parts: Uint8Array[] = [];
      for (let i = 0; i < sealed.frames.length; i++) {
        const frame = sealed.frames[i]!;
        // A frame is at most one full frame of data plus its tag; anything larger is not ours.
        if (frame.length > ATTACHMENT_FRAME + TAG) throw new AttachmentError('too_large');
        parts.push(await aead.open(key, nonce(sealed.prefix, i), frame, aad(id, i, i === sealed.frames.length - 1)));
      }
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    },
  };
}
