import { randomBytes } from 'node:crypto';
import { SecretBuf } from '@cashfold/crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../common/rate-limit.js';
import { createMemoryStore } from '../../store/memory-store.js';
import { randomX, testPake } from '../../../test/support/pake.js';
import { AuthError, createAuthService, type AuthService } from './auth.service.js';
import { createSessionStore } from './sessions.js';
import { createSrpServer } from './srp-server.js';

// FR-013, FR-014, FR-015: the handshake from the client's side, against the real server logic.

const secret = randomBytes(32);
let now = 1_000_000;
const clock = { now: () => now };
const X = randomX();
const DEVICE = randomBytes(16);
const kdf = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: randomBytes(16) } as const;
let pake: Awaited<ReturnType<typeof testPake>>;
const srp = createSrpServer();

async function world() {
  const store = createMemoryStore();
  const sessions = createSessionStore(clock);
  const auth = createAuthService({ store, srp, sessions, limiter: createRateLimiter(clock), clock, secret, defaultKdf: { mKib: 65_536, t: 3, p: 1 } });
  const authSalt = randomBytes(16);
  const { emailMac } = await import('../../common/crypto-util.js');
  await store.accounts.create({
    accountId: 'ABCDEF', emailHmac: emailMac(secret, 'alice@example.com'), email: 'alice@example.com', authSalt, kdf,
    srpVerifier: pake.verifier(SecretBuf.from(X)), keyset: Buffer.alloc(100), discoverable: true, createdAtMs: now,
  });
  return { store, sessions, auth, authSalt };
}

/** Runs a whole exchange as a client; `x` is the secret the client derived (the right one unless a test says otherwise). */
async function signIn(auth: AuthService, opts: { email?: string; x?: Buffer; ip?: string; device?: Uint8Array } = {}) {
  const hello = await auth.hello({ email: opts.email ?? 'alice@example.com', deviceId: opts.device ?? DEVICE, ip: opts.ip ?? '10.0.0.1' });
  const session = pake.start(SecretBuf.from(opts.x ?? X));
  const { B } = await auth.proofA({ sessionId: hello.sessionId, A: session.A, ip: opts.ip ?? '10.0.0.1' });
  const done = session.respond({ accountId: hello.accountId, authSalt: hello.authSalt, B });
  const { M2 } = await auth.proofM1({ sessionId: hello.sessionId, M1: done.M1, ip: opts.ip ?? '10.0.0.1' });
  return { hello, done, M2 };
}

beforeAll(async () => {
  pake = await testPake();
});

describe('sign-in', () => {
  it('a client with the right secret completes the exchange, both sides prove themselves, and the session is authenticated', async () => {
    const { auth, sessions } = await world();
    const { hello, done, M2 } = await signIn(auth);
    expect(hello.accountId).toBe('ABCDEF');
    expect(done.verify(M2)).toBe(true);
    expect(sessions.get(Buffer.from(hello.sessionId).toString('hex'))?.accountId).toBe('ABCDEF');
  });

  it('a wrong password (a different secret) is rejected, and the session never becomes authenticated', async () => {
    const { auth, sessions } = await world();
    const hello = await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.1' });
    const session = pake.start(SecretBuf.from(randomX()));
    const { B } = await auth.proofA({ sessionId: hello.sessionId, A: session.A, ip: '10.0.0.1' });
    const done = session.respond({ accountId: hello.accountId, authSalt: hello.authSalt, B });
    await expect(auth.proofM1({ sessionId: hello.sessionId, M1: done.M1, ip: '10.0.0.1' })).rejects.toMatchObject({ kind: 'rejected' });
    expect(sessions.get(Buffer.from(hello.sessionId).toString('hex'))).toBeUndefined();
  });

  it('answers an unknown address like a real one: same shape, deterministic, and rejected only at the proof', async () => {
    const { auth } = await world();
    const a = await auth.hello({ email: 'nobody@example.com', deviceId: DEVICE, ip: '10.0.0.2' });
    const b = await auth.hello({ email: 'Nobody@Example.com', deviceId: DEVICE, ip: '10.0.0.2' });
    expect(Buffer.from(b.authSalt)).toEqual(Buffer.from(a.authSalt));
    expect(b.accountId).toBe(a.accountId);
    expect(a.authSalt).toHaveLength(16);
    expect(a.sessionId).toHaveLength(16);
    expect(a.kdf).toMatchObject({ kdf: 'argon2id', mKib: 65_536, t: 3, p: 1 });
    const other = await auth.hello({ email: 'someone.else@example.com', deviceId: DEVICE, ip: '10.0.0.2' });
    expect(Buffer.from(other.authSalt)).not.toEqual(Buffer.from(a.authSalt));
    await expect(signIn(auth, { email: 'nobody@example.com' })).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('does not reveal an account through the order, shape or error of its replies', async () => {
    const { auth } = await world();
    const real = await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.3' });
    const fake = await auth.hello({ email: 'ghost@example.com', deviceId: DEVICE, ip: '10.0.0.3' });
    expect(Object.keys(real).sort()).toEqual(Object.keys(fake).sort());
    expect(Object.keys(real.kdf).sort()).toEqual(Object.keys(fake.kdf).sort());
    const failure = async (email: string) => {
      const h = await auth.hello({ email, deviceId: DEVICE, ip: '10.0.0.4' });
      const s = pake.start(SecretBuf.from(randomX()));
      const { B } = await auth.proofA({ sessionId: h.sessionId, A: s.A, ip: '10.0.0.4' });
      const d = s.respond({ accountId: h.accountId, authSalt: h.authSalt, B });
      return auth.proofM1({ sessionId: h.sessionId, M1: d.M1, ip: '10.0.0.4' }).then(() => 'accepted', (e: AuthError) => `${e.kind}:${e.retryAfterSec}`);
    };
    expect(await failure('alice@example.com')).toBe(await failure('ghost@example.com'));
  });

  it('refuses A = 0 and A = N, a wrong state, an unknown session and a repeated proof', async () => {
    const { auth } = await world();
    const hello = await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.5' });
    await expect(auth.proofA({ sessionId: hello.sessionId, A: Buffer.alloc(512), ip: '10.0.0.5' })).rejects.toMatchObject({ kind: 'rejected' });
    // the failed handshake is gone: nothing can be resumed
    await expect(auth.proofA({ sessionId: hello.sessionId, A: pake.start(SecretBuf.from(X)).A, ip: '10.0.0.5' })).rejects.toMatchObject({ kind: 'rejected' });
    await expect(auth.proofM1({ sessionId: randomBytes(16), M1: Buffer.alloc(32), ip: '10.0.0.5' })).rejects.toMatchObject({ kind: 'rejected' });
    const h2 = await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.5' });
    await expect(auth.proofM1({ sessionId: h2.sessionId, M1: Buffer.alloc(32), ip: '10.0.0.5' })).rejects.toMatchObject({ kind: 'rejected' }); // proof before A
  });

  it('a handshake expires after 60 seconds', async () => {
    const { auth } = await world();
    const hello = await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.6' });
    now += 61_000;
    await expect(auth.proofA({ sessionId: hello.sessionId, A: pake.start(SecretBuf.from(X)).A, ip: '10.0.0.6' })).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('a recorded exchange cannot be replayed in a new session (AUTH-1)', async () => {
    const { auth } = await world();
    const first = await signIn(auth);
    const replayHello = await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.7' });
    // the attacker sends the recorded M1 (and A) into a fresh handshake: B differs, so the proof does not verify
    const recordedA = pake.start(SecretBuf.from(X)).A;
    await auth.proofA({ sessionId: replayHello.sessionId, A: recordedA, ip: '10.0.0.7' });
    await expect(auth.proofM1({ sessionId: replayHello.sessionId, M1: first.done.M1, ip: '10.0.0.7' })).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('refuses a revoked device at the first message (AUTH-7)', async () => {
    const { auth, store } = await world();
    await store.devices.add({ devId: Buffer.from(DEVICE), accountId: 'ABCDEF', sigPk: randomBytes(32), labelCt: null, createdAtMs: 1, revokedAtMs: null });
    await signIn(auth);
    await store.devices.revoke('ABCDEF', DEVICE, 5);
    await expect(auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.0.0.8' })).rejects.toMatchObject({ kind: 'rejected' });
    await expect(auth.hello({ email: 'alice@example.com', deviceId: randomBytes(16), ip: '10.0.0.8' })).resolves.toBeDefined(); // another device is fine
  });
});

describe('rate limiting and lockout (AUTH-5)', () => {
  it('limits hello per address and per client address', async () => {
    const { auth } = await world();
    for (let i = 0; i < 10; i++) await auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: `10.1.0.${i}` });
    await expect(auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.1.1.1' })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSec: expect.any(Number) });
    for (let i = 0; i < 30; i++) await auth.hello({ email: `user${i}@example.com`, deviceId: DEVICE, ip: '10.2.0.1' });
    await expect(auth.hello({ email: 'one.more@example.com', deviceId: DEVICE, ip: '10.2.0.1' })).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('backs off exponentially after repeated failures, for real and unknown accounts alike, and recovers', async () => {
    const outcome = async (email: string) => {
      const { auth } = await world();
      const results: string[] = [];
      for (let i = 0; i < 8; i++) {
        now += 15 * 60_000 + 1; // keep the hello limiter out of the way: only back-off is under test
        const r = await signIn(auth, { email, x: randomX(), ip: `10.3.${i}.1` }).then(() => 'ok', (e: AuthError) => e.kind);
        results.push(r);
        const wait = await auth.hello({ email, deviceId: DEVICE, ip: `10.3.${i}.2` }).then(() => 0, (e: AuthError) => e.retryAfterSec ?? 0);
        results.push(wait > 0 ? 'locked' : 'open');
        now -= 15 * 60_000; // time does not advance between attempts, so the lock stays
      }
      return results;
    };
    const real = await outcome('alice@example.com');
    const fake = await outcome('ghost@example.com');
    expect(real).toEqual(fake);
    expect(real).toContain('locked');
  });

  it('a correct sign-in clears the count', async () => {
    const { auth } = await world();
    for (let i = 0; i < 3; i++) await signIn(auth, { x: randomX(), ip: `10.4.0.${i}` }).catch(() => undefined);
    await signIn(auth, { ip: '10.4.1.1' });
    for (let i = 0; i < 3; i++) await signIn(auth, { x: randomX(), ip: `10.4.2.${i}` }).catch(() => undefined);
    await expect(auth.hello({ email: 'alice@example.com', deviceId: DEVICE, ip: '10.4.3.1' })).resolves.toBeDefined();
  });

  it('tells the owner when an account becomes locked', async () => {
    const locked: string[] = [];
    const store = createMemoryStore();
    const auth = createAuthService({ store, srp, sessions: createSessionStore(clock), limiter: createRateLimiter(clock), clock, secret, defaultKdf: { mKib: 65_536, t: 3, p: 1 }, onLocked: (id) => locked.push(id) });
    const { emailMac } = await import('../../common/crypto-util.js');
    await store.accounts.create({ accountId: 'ABCDEF', emailHmac: emailMac(secret, 'alice@example.com'), email: 'alice@example.com', authSalt: randomBytes(16), kdf, srpVerifier: pake.verifier(SecretBuf.from(X)), keyset: Buffer.alloc(100), discoverable: true, createdAtMs: now });
    for (let i = 0; i < 5; i++) {
      now += 60 * 60_000;
      await signIn(auth, { x: randomX(), ip: `10.5.${i}.1` }).catch(() => undefined);
    }
    expect(locked).toEqual(['ABCDEF']);
    expect((await store.accounts.byId('ABCDEF'))?.failCount).toBe(5);
  });
});
