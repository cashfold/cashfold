import { createCipheriv, hkdfSync } from 'node:crypto';
import { createAesGcm, createFrameEndpoint, createHkdf, deriveTransportKeys, SecretBuf } from '@cashfold/crypto';
import { decode, encode } from '@cashfold/protocol/cbor';
import { describe, expect, it } from 'vitest';
import { createServerTransport, FrameError, MAX_FRAME_BODY, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './frame.js';

const K = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const transcript = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i));
const sessionId = Buffer.alloc(16, 7);
const text = (s: string) => Buffer.from(s);

const server = (now?: () => number) => createServerTransport({ sessionId, sessionKey: K, transcript, ...(now && { nowMs: now }) });
async function client() {
  const keys = await deriveTransportKeys({ hkdf: createHkdf(), key: SecretBuf.from(K), transcript });
  return createFrameEndpoint({ role: 'client', sessionId, keys, aead: createAesGcm() });
}

describe('server transport', () => {
  it('speaks to the independent client implementation in both directions, in order', async () => {
    const c = await client();
    const s = server();
    for (let i = 0; i < 3; i++) expect(s.open(await c.seal(text(`up ${i}`))).toString()).toBe(`up ${i}`);
    for (let i = 0; i < 3; i++) expect(Buffer.from(await c.open(s.seal(text(`down ${i}`)))).toString()).toBe(`down ${i}`);
  });

  it('produces frames that match a hand-built reference (Node primitives, no shared code)', () => {
    const keys = { s2c: Buffer.from(hkdfSync('sha256', K, transcript, 'cashfold.transport.v1|s2c', 32)) };
    const body = text('exact bytes');
    const nonce = Buffer.alloc(12);
    const aad = Buffer.from(encode(['cashfold.frame.v1', sessionId, 1n, 0n, BigInt(body.length)] as never));
    const cipher = createCipheriv('aes-256-gcm', keys.s2c, nonce);
    cipher.setAAD(aad);
    const expected = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
    const frame = decode(server().seal(body)) as Map<bigint, unknown>;
    expect(Buffer.from(frame.get(4n) as Uint8Array)).toEqual(expected);
    expect(frame.get(3n)).toBe(0n);
    expect(frame.get(2n)).toBe(1n);
  });

  it('rejects replays, reflections, tampering and foreign sessions, and each closes the session', async () => {
    const c = await client();
    const tamper = (frame: Uint8Array, edit: (m: Map<bigint, unknown>) => void) => {
      const m = decode(frame) as Map<bigint, unknown>;
      edit(m);
      return encode(m as never);
    };
    const cases: Array<[string, (f: Uint8Array) => Uint8Array, string]> = [
      ['ciphertext', (f) => tamper(f, (m) => { const x = Uint8Array.from(m.get(4n) as Uint8Array); x[0] = x[0]! ^ 1; m.set(4n, x); }), 'bad_tag'],
      ['counter', (f) => tamper(f, (m) => m.set(3n, 9n)), 'bad_tag'],
      ['direction', (f) => tamper(f, (m) => m.set(2n, 1n)), 'wrong_direction'],
      ['session', (f) => tamper(f, (m) => m.set(1n, Buffer.alloc(16, 9))), 'wrong_session'],
      ['truncated', (f) => tamper(f, (m) => m.set(4n, (m.get(4n) as Uint8Array).slice(0, 8))), 'malformed'],
      ['junk', () => text('not cbor at all'), 'malformed'],
    ];
    for (const [name, mutate, kind] of cases) {
      const s = server();
      const frame = await c.seal(text('x'));
      expect(() => s.open(mutate(frame)), name).toThrowError(expect.objectContaining({ kind }) as never);
      expect(s.closed, name).toBe(true);
    }
    const s = server();
    const f = await c.seal(text('once'));
    s.open(f);
    expect(() => s.open(f)).toThrowError(expect.objectContaining({ kind: 'replay' }) as never);
    expect(s.closed).toBe(true);
    expect(() => s.open(f)).toThrow(FrameError);
  });

  it('expires after 30 idle minutes or 24 hours, and limits the body size', async () => {
    let now = 0;
    const c = await client();
    const s = server(() => now);
    s.open(await c.seal(text('a')));
    now += SESSION_IDLE_MS - 1;
    s.open(await c.seal(text('b')));
    now += SESSION_IDLE_MS + 1;
    expect(s.isExpired()).toBe(true);
    expect(() => s.seal(text('late'))).toThrowError(expect.objectContaining({ kind: 'expired' }) as never);

    now = 0;
    const long = server(() => now);
    now = SESSION_ABSOLUTE_MS + 1;
    expect(long.isExpired()).toBe(true);
    expect(() => server().seal(Buffer.alloc(MAX_FRAME_BODY + 1))).toThrowError(expect.objectContaining({ kind: 'too_large' }) as never);
  });

  it('wipes its keys on close', () => {
    const s = server();
    s.close();
    expect(() => s.seal(text('x'))).toThrowError(expect.objectContaining({ kind: 'closed' }) as never);
  });
});
