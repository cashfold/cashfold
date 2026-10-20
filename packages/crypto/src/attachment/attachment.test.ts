import { describe, expect, it } from 'vitest';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { AeadError, type Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { ATTACHMENT_FRAME, AttachmentError, attachmentKey, createAttachmentCrypto } from './attachment';

const rng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const att = createAttachmentCrypto({ aead: createAesGcm(), rng });
const id = new Uint8Array(16).fill(5);
const key = () => SecretBuf.from(new Uint8Array(32).fill(9));
const data = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);

describe('attachments (FR-093)', () => {
  it('splits into 64 KiB frames and round-trips exactly, for sizes around the frame boundary', async () => {
    expect(ATTACHMENT_FRAME).toBe(65_536);
    for (const size of [0, 1, 100, 65_535, 65_536, 65_537, 131_072, 200_001]) {
      const plain = data(size);
      const sealed = await att.seal(key(), id, plain);
      expect(sealed.frames.length).toBe(Math.max(1, Math.ceil(size / 65_536)));
      for (const f of sealed.frames) expect(f.length).toBeLessThanOrEqual(65_536 + 16);
      expect(await att.open(key(), id, sealed)).toEqual(plain);
    }
  });

  it('uses a nonce of a 4-byte random prefix and an 8-byte counter, never repeated within an attachment', async () => {
    const sealed = await att.seal(key(), id, data(300_000));
    expect(sealed.prefix).toHaveLength(4);
    expect(att.nonce(sealed.prefix, 0)).toEqual(Uint8Array.from([...sealed.prefix, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(att.nonce(sealed.prefix, 258)).toEqual(Uint8Array.from([...sealed.prefix, 0, 0, 0, 0, 0, 0, 1, 2]));
    const other = await att.seal(key(), id, data(10));
    expect(Buffer.from(other.prefix).equals(Buffer.from(sealed.prefix))).toBe(false);
  });

  it('detects a missing last frame, a dropped middle frame, a reordered pair and an extra frame', async () => {
    const sealed = await att.seal(key(), id, data(300_000));
    const [a, b, c, d, e] = sealed.frames as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    await expect(att.open(key(), id, { ...sealed, frames: [a, b, c, d] })).rejects.toBeInstanceOf(AeadError); // truncated
    await expect(att.open(key(), id, { ...sealed, frames: [a, c, d, e] })).rejects.toBeInstanceOf(AeadError); // dropped
    await expect(att.open(key(), id, { ...sealed, frames: [b, a, c, d, e] })).rejects.toBeInstanceOf(AeadError); // reordered
    await expect(att.open(key(), id, { ...sealed, frames: [...sealed.frames, e] })).rejects.toBeInstanceOf(AeadError); // extended
    await expect(att.open(key(), id, { ...sealed, frames: [] })).rejects.toBeInstanceOf(AttachmentError);
  });

  it('is bound to its attachment: another id, another key or a changed byte fails', async () => {
    const sealed = await att.seal(key(), id, data(1000));
    await expect(att.open(key(), new Uint8Array(16).fill(6), sealed)).rejects.toBeInstanceOf(AeadError);
    await expect(att.open(SecretBuf.from(new Uint8Array(32).fill(1)), id, sealed)).rejects.toBeInstanceOf(AeadError);
    const bad = Uint8Array.from(sealed.frames[0]!);
    bad[3] = bad[3]! ^ 1;
    await expect(att.open(key(), id, { ...sealed, frames: [bad] })).rejects.toBeInstanceOf(AeadError);
  });

  it('a single frame is both first and last, so cutting one from a longer file is caught', async () => {
    const long = await att.seal(key(), id, data(100_000));
    await expect(att.open(key(), id, { ...long, frames: [long.frames[0]!] })).rejects.toBeInstanceOf(AeadError);
  });

  it('derives a key per attachment from the Fold key', async () => {
    const hkdf = createHkdf();
    const fk = SecretBuf.from(new Uint8Array(32).fill(3));
    const a = await attachmentKey(hkdf, fk, id);
    const b = await attachmentKey(hkdf, fk, new Uint8Array(16).fill(6));
    expect(a.use((x) => Buffer.from(x).toString('hex'))).not.toBe(b.use((x) => Buffer.from(x).toString('hex')));
    expect(a.length).toBe(32);
  });

  it('refuses an attachment of the wrong id length', async () => {
    await expect(att.seal(key(), new Uint8Array(8), data(1))).rejects.toBeInstanceOf(AttachmentError);
  });
});
