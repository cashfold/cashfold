import { decode, encode } from '@cashfold/protocol/cbor';
import type { Aead, Hkdf } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// Authenticated transport frames after the SRP handshake (ARCH 6.5). TLS is the outer layer; this layer adds client
// authentication and replay protection: a strictly increasing counter per direction is bound into the nonce and the AAD.

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
/** Largest body in one frame: 256 ops are at most 4 MiB, plus the envelope around them. */
export const MAX_FRAME_BODY = 5 * 1024 * 1024;

export type FrameErrorKind = 'malformed' | 'wrong_session' | 'wrong_direction' | 'replay' | 'bad_tag' | 'too_large' | 'expired' | 'closed';

export class FrameError extends Error {
  constructor(readonly kind: FrameErrorKind) {
    super(`frame: ${kind}`);
    this.name = 'FrameError';
  }
}

const info = (direction: 'c2s' | 's2c'): Uint8Array => new TextEncoder().encode(`cashfold.transport.v1|${direction}`);

export interface TransportKeys {
  readonly c2s: SecretBuf;
  readonly s2c: SecretBuf;
}

/** `K_dir = HKDF(salt = transcript hash, IKM = K, info = "cashfold.transport.v1|dir")`. Consumes nothing: the caller wipes `key`. */
export async function deriveTransportKeys({ hkdf, key, transcript }: { hkdf: Hkdf; key: SecretBuf; transcript: Uint8Array }): Promise<TransportKeys> {
  return { c2s: await hkdf.derive(key, transcript, info('c2s'), 32), s2c: await hkdf.derive(key, transcript, info('s2c'), 32) };
}

export interface FrameEndpoint {
  /** Wraps a body in the next frame of this endpoint's direction. */
  seal(body: Uint8Array): Promise<Uint8Array>;
  /** Opens a frame from the peer. Any failure closes the session. */
  open(frame: Uint8Array): Promise<Uint8Array>;
  readonly closed: boolean;
  close(): void;
}

const nonce = (counter: bigint): Uint8Array => {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigUint64(4, counter);
  return out;
};

const aad = (sessionId: Uint8Array, direction: bigint, counter: bigint, length: number): Uint8Array =>
  encode(['cashfold.frame.v1', sessionId, direction, counter, BigInt(length)] as never);

export function createFrameEndpoint({ role, sessionId, keys, aead, nowMs = Date.now }: {
  role: 'client' | 'server'; sessionId: Uint8Array; keys: TransportKeys; aead: Aead; nowMs?: () => number;
}): FrameEndpoint {
  const out = role === 'client' ? { dir: 0n, key: keys.c2s } : { dir: 1n, key: keys.s2c };
  const inn = role === 'client' ? { dir: 1n, key: keys.s2c } : { dir: 0n, key: keys.c2s };
  const startedAt = nowMs();
  let lastActive = startedAt;
  let sent = 0n;
  let received = -1n;
  let closed = false;

  const close = (): void => {
    closed = true;
    keys.c2s.wipe();
    keys.s2c.wipe();
  };
  const fail = (kind: FrameErrorKind): never => {
    close();
    throw new FrameError(kind);
  };
  const checkLive = (): void => {
    if (closed) throw new FrameError('closed');
    const now = nowMs();
    if (now - lastActive > SESSION_IDLE_MS || now - startedAt > SESSION_ABSOLUTE_MS) fail('expired');
  };

  return {
    get closed() {
      return closed;
    },
    close,
    async seal(body) {
      checkLive();
      if (body.length > MAX_FRAME_BODY) throw new FrameError('too_large');
      const counter = sent++;
      const ct = await aead.seal(out.key, nonce(counter), body, aad(sessionId, out.dir, counter, body.length));
      lastActive = nowMs();
      return encode(new Map<bigint, unknown>([[1n, sessionId], [2n, out.dir], [3n, counter], [4n, ct]]) as never);
    },
    async open(frame) {
      checkLive();
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
      if (!session.every((b, i) => b === sessionId[i])) return fail('wrong_session');
      if (direction !== inn.dir) return fail('wrong_direction');
      if (counter < 0n || counter >= 2n ** 64n || counter <= received) return fail('replay');
      if (ct.length < 16 || ct.length - 16 > MAX_FRAME_BODY) return fail(ct.length < 16 ? 'malformed' : 'too_large');
      try {
        const body = await aead.open(inn.key, nonce(counter), ct, aad(sessionId, direction, counter, ct.length - 16));
        received = counter;
        lastActive = nowMs();
        return body;
      } catch {
        return fail('bad_tag');
      }
    },
  };
}
