import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { decode, encode } from '@cashfold/protocol/cbor';

// The server's end of the authenticated transport (ARCH 6.5, contracts/auth-srp.md), written with Node's own crypto.
// It is deliberately a separate implementation from the client's (packages/crypto/src/transport/frame.ts) so that a
// shared mistake cannot hide: frame.test.ts runs the two against each other and against fixed vectors.

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const MAX_FRAME_BODY = 5 * 1024 * 1024;

export type FrameErrorKind = 'malformed' | 'wrong_session' | 'wrong_direction' | 'replay' | 'bad_tag' | 'too_large' | 'expired' | 'closed';

export class FrameError extends Error {
  constructor(readonly kind: FrameErrorKind) {
    super(`frame: ${kind}`);
    this.name = 'FrameError';
  }
}

export interface ServerTransport {
  open(frame: Uint8Array): Buffer;
  seal(body: Uint8Array): Buffer;
  readonly closed: boolean;
  /** Whether the idle or absolute limit has passed, without counting as activity. */
  isExpired(): boolean;
  close(): void;
}

const aad = (sessionId: Uint8Array, direction: bigint, counter: bigint, length: number): Buffer =>
  Buffer.from(encode(['cashfold.frame.v1', sessionId, direction, counter, BigInt(length)] as never));
const nonce = (counter: bigint): Buffer => {
  const out = Buffer.alloc(12);
  out.writeBigUInt64BE(counter, 4);
  return out;
};

export function deriveKeys(sessionKey: Uint8Array, transcript: Uint8Array): { c2s: Buffer; s2c: Buffer } {
  const derive = (label: string): Buffer => Buffer.from(hkdfSync('sha256', sessionKey, transcript, `cashfold.transport.v1|${label}`, 32));
  return { c2s: derive('c2s'), s2c: derive('s2c') };
}

export function createServerTransport({ sessionId, sessionKey, transcript, nowMs = Date.now }: {
  sessionId: Uint8Array; sessionKey: Uint8Array; transcript: Uint8Array; nowMs?: () => number;
}): ServerTransport {
  const keys = deriveKeys(sessionKey, transcript);
  const startedAt = nowMs();
  let lastActive = startedAt;
  let sent = 0n;
  let received = -1n;
  let closed = false;

  const close = (): void => {
    closed = true;
    keys.c2s.fill(0);
    keys.s2c.fill(0);
  };
  const expired = (): boolean => nowMs() - lastActive > SESSION_IDLE_MS || nowMs() - startedAt > SESSION_ABSOLUTE_MS;
  const fail = (kind: FrameErrorKind): never => {
    close();
    throw new FrameError(kind);
  };
  const live = (): void => {
    if (closed) throw new FrameError('closed');
    if (expired()) fail('expired');
  };

  return {
    get closed() {
      return closed;
    },
    isExpired: () => closed || expired(),
    close,
    seal(body) {
      live();
      if (body.length > MAX_FRAME_BODY) throw new FrameError('too_large');
      const counter = sent++;
      const cipher = createCipheriv('aes-256-gcm', keys.s2c, nonce(counter));
      cipher.setAAD(aad(sessionId, 1n, counter, body.length));
      const ct = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
      lastActive = nowMs();
      return Buffer.from(encode(new Map<bigint, unknown>([[1n, sessionId], [2n, 1n], [3n, counter], [4n, ct]]) as never));
    },
    open(frame) {
      live();
      let fields: Map<bigint, unknown>;
      try {
        const decoded = decode(frame);
        if (!(decoded instanceof Map)) return fail('malformed');
        fields = decoded as Map<bigint, unknown>;
      } catch {
        return fail('malformed');
      }
      const [session, direction, counter, ct] = [fields.get(1n), fields.get(2n), fields.get(3n), fields.get(4n)];
      if (fields.size !== 4 || !(session instanceof Uint8Array) || session.length !== 16 || typeof direction !== 'bigint' || typeof counter !== 'bigint' || !(ct instanceof Uint8Array)) {
        return fail('malformed');
      }
      if (!Buffer.from(session).equals(Buffer.from(sessionId))) return fail('wrong_session');
      if (direction !== 0n) return fail('wrong_direction');
      if (counter < 0n || counter >= 2n ** 64n || counter <= received) return fail('replay');
      if (ct.length < 16) return fail('malformed');
      if (ct.length - 16 > MAX_FRAME_BODY) return fail('too_large');
      try {
        const decipher = createDecipheriv('aes-256-gcm', keys.c2s, nonce(counter));
        decipher.setAAD(aad(sessionId, 0n, counter, ct.length - 16));
        decipher.setAuthTag(Buffer.from(ct.subarray(ct.length - 16)));
        const body = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]);
        received = counter;
        lastActive = nowMs();
        return body;
      } catch {
        return fail('bad_tag');
      }
    },
  };
}
