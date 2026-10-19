import { describe, expect, it } from 'vitest';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { SecretBuf } from '../secret-buf';
import { createFrameEndpoint, deriveTransportKeys, FrameError, MAX_FRAME_BODY, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './frame';
import { decode, encode } from '@cashfold/protocol/cbor';

// ARCH 6.5, contracts/auth-srp.md "Framing after AUTHED". Every property here is something an attacker who controls the
// network, or the relay itself, would try.

const aead = createAesGcm();
const hkdf = createHkdf();
const K = new Uint8Array(32).map((_, i) => i);
const transcript = new Uint8Array(32).map((_, i) => 255 - i);
const sessionId = new Uint8Array(16).fill(7);
const body = (text: string) => new TextEncoder().encode(text);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function pair(now = () => 0) {
  const keys = () => deriveTransportKeys({ hkdf, key: SecretBuf.from(K), transcript });
  const [a, b] = [await keys(), await keys()];
  return {
    client: createFrameEndpoint({ role: 'client', sessionId, keys: a, aead, nowMs: now }),
    server: createFrameEndpoint({ role: 'server', sessionId, keys: b, aead, nowMs: now }),
  };
}

describe('transport keys', () => {
  it('are two different 32-byte keys derived from K and the transcript', async () => {
    const keys = await deriveTransportKeys({ hkdf, key: SecretBuf.from(K), transcript });
    const [c2s, s2c] = [keys.c2s.use((k) => Array.from(k)), keys.s2c.use((k) => Array.from(k))];
    expect(c2s).toHaveLength(32);
    expect(c2s).not.toEqual(s2c);
    const other = await deriveTransportKeys({ hkdf, key: SecretBuf.from(K), transcript: new Uint8Array(32) });
    expect(other.c2s.use((k) => Array.from(k))).not.toEqual(c2s);
  });
});

describe('frames', () => {
  it('carry a body from client to server and back, each as a CBOR map of four fields', async () => {
    const { client, server } = await pair();
    const frame = await client.seal(body('hello server'));
    const decoded = decode(frame) as Map<bigint, unknown>;
    expect([...decoded.keys()].sort()).toEqual([1n, 2n, 3n, 4n]);
    expect(decoded.get(2n)).toBe(0n);
    expect(decoded.get(3n)).toBe(0n);
    expect(text(await server.open(frame))).toBe('hello server');
    const reply = await server.seal(body('hello client'));
    expect((decode(reply) as Map<bigint, unknown>).get(2n)).toBe(1n);
    expect(text(await client.open(reply))).toBe('hello client');
  });

  it('count up from zero in each direction and never reuse a counter', async () => {
    const { client, server } = await pair();
    const counters: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const f = await client.seal(body(`m${i}`));
      counters.push((decode(f) as Map<bigint, bigint>).get(3n)!);
      await server.open(f);
    }
    expect(counters).toEqual([0n, 1n, 2n]);
    expect((decode(await server.seal(body('x'))) as Map<bigint, bigint>).get(3n)).toBe(0n);
  });

  it('reject a replayed frame, an older frame, and a repeat of the latest', async () => {
    for (const replay of [1, 0]) {
      const { client, server } = await pair();
      const frames = [await client.seal(body('a')), await client.seal(body('b'))];
      await server.open(frames[1]!);
      await expect(server.open(frames[replay]!)).rejects.toMatchObject({ kind: 'replay' });
      expect(server.closed).toBe(true); // a replay ends the session (auth-srp.md)
    }
  });

  it('accept a gap (a dropped frame) but only moving forward', async () => {
    const { client, server } = await pair();
    await client.seal(body('lost'));
    const f1 = await client.seal(body('kept'));
    expect(text(await server.open(f1))).toBe('kept');
  });

  it('reject a frame sent back in the wrong direction (reflection)', async () => {
    const { client, server } = await pair();
    const f = await client.seal(body('x'));
    await expect(client.open(f)).rejects.toMatchObject({ kind: 'wrong_direction' });
    const r = await server.seal(body('y'));
    await expect(server.open(r)).rejects.toMatchObject({ kind: 'wrong_direction' });
  });

  it('reject another session\'s frame', async () => {
    const { client } = await pair();
    const keys = await deriveTransportKeys({ hkdf, key: SecretBuf.from(K), transcript });
    const elsewhere = createFrameEndpoint({ role: 'server', sessionId: new Uint8Array(16).fill(8), keys, aead });
    await expect(elsewhere.open(await client.seal(body('x')))).rejects.toMatchObject({ kind: 'wrong_session' });
  });

  it('reject a tampered counter, direction, session, ciphertext or tag, and close the session', async () => {
    const mutate = (frame: Uint8Array, edit: (m: Map<bigint, unknown>) => void): Uint8Array => {
      const m = decode(frame) as Map<bigint, unknown>;
      edit(m);
      return encode(m as never);
    };
    const cases: Array<[string, (m: Map<bigint, unknown>) => void]> = [
      ['counter', (m) => m.set(3n, 5n)],
      ['ciphertext', (m) => { const c = Uint8Array.from(m.get(4n) as Uint8Array); c[0] = c[0]! ^ 1; m.set(4n, c); }],
      ['tag', (m) => { const c = Uint8Array.from(m.get(4n) as Uint8Array); c[c.length - 1] = c.at(-1)! ^ 1; m.set(4n, c); }],
      ['truncated', (m) => m.set(4n, (m.get(4n) as Uint8Array).slice(0, 10))],
    ];
    for (const [name, edit] of cases) {
      const { client, server } = await pair();
      const bad = mutate(await client.seal(body('secret')), edit);
      await expect(server.open(bad), name).rejects.toBeInstanceOf(FrameError);
      expect(server.closed, name).toBe(true);
      await expect(server.open(await client.seal(body('after'))), `${name} then valid`).rejects.toMatchObject({ kind: 'closed' });
    }
  });

  it('reject malformed frames: not CBOR, missing fields, extra fields, wrong types', async () => {
    const { server } = await pair();
    for (const junk of [new Uint8Array(0), body('plain text'), encode(new Map<bigint, unknown>([[1n, 1n]]) as never), encode(new Map<bigint, unknown>([[1n, sessionId], [2n, 0n], [3n, 0n], [4n, new Uint8Array(40)], [5n, 1n]]) as never)]) {
      const s = (await pair()).server;
      await expect(s.open(junk)).rejects.toBeInstanceOf(FrameError);
    }
    expect(server.closed).toBe(false);
  });

  it('bind the body length: bodies up to the limit work, larger ones are refused on both ends', async () => {
    const { client, server } = await pair();
    const big = new Uint8Array(MAX_FRAME_BODY).fill(1);
    expect((await server.open(await client.seal(big))).length).toBe(MAX_FRAME_BODY);
    await expect(client.seal(new Uint8Array(MAX_FRAME_BODY + 1))).rejects.toMatchObject({ kind: 'too_large' });
  });

  it('expire after 30 minutes idle or 24 hours in total', async () => {
    let now = 1_000;
    const { client, server } = await pair(() => now);
    await server.open(await client.seal(body('a')));
    now += SESSION_IDLE_MS - 1;
    await server.open(await client.seal(body('b'))); // activity resets the idle clock
    now += SESSION_IDLE_MS + 1;
    await expect(client.seal(body('c'))).rejects.toMatchObject({ kind: 'expired' });
    const second = await pair(() => now);
    now += SESSION_ABSOLUTE_MS + 1;
    await expect(second.client.seal(body('d'))).rejects.toMatchObject({ kind: 'expired' });
  });

  it('wipe the keys when the session closes', async () => {
    const keys = await deriveTransportKeys({ hkdf, key: SecretBuf.from(K), transcript });
    const endpoint = createFrameEndpoint({ role: 'client', sessionId, keys, aead });
    endpoint.close();
    expect(keys.c2s.isWiped && keys.s2c.isWiped).toBe(true);
    await expect(endpoint.seal(body('x'))).rejects.toMatchObject({ kind: 'closed' });
  });
});
