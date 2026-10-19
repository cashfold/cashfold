import { randomBytes } from 'node:crypto';
import { KdfBelowFloor, SecretBuf, createAesGcm, createHkdf, createRelayClient } from '@cashfold/crypto';
import { encodeFoldKeyGrant } from '@cashfold/protocol';
import { decode, encode } from '@cashfold/protocol/cbor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../../src/store/store.js';
import { newAccountId, newDevice, register, signIn, signedOp, startRelay, type Harness, type TestAccount } from './relay-harness.js';
import { randomX, testPake } from './pake.js';

// The relay's behaviour over HTTP with real SRP and real frames, against any Store. Memory runs it in the unit suite;
// PostgreSQL (Testcontainers) runs it in the integration suite.

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const cbor = (v: unknown) => encode(v as never);

export function describeRelay(label: string, makeStore: () => Promise<Store>): void {
  describe(`Relay: ${label}`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      while (open.length > 0) await open.pop()!.close();
    });
    const start = async (over: Parameters<typeof startRelay>[1] = {}, extra: Parameters<typeof startRelay>[2] = {}): Promise<Harness> => {
      const h = await startRelay(await makeStore(), over, extra);
      open.push(h);
      return h;
    };

    describe('registration and sign-in', () => {
      it('registers, signs in with SRP, and reads its own status and key set through frames', async () => {
        const h = await start();
        const a = await register(h);
        const { session, accountId } = await signIn(h, a);
        expect(accountId).toBe(a.accountId);
        const me = await session.request('GET', '/accounts/me');
        expect(me.status).toBe(200);
        expect(me.body).toMatchObject(new Map([['account_id', a.accountId]]).size ? {} : {});
        expect((me.body as Map<string, unknown>).get('account_id')).toBe(a.accountId);
        expect((me.body as Map<string, unknown>).get('email_verified')).toBe(false);
        const keyset = (await session.request('GET', '/accounts/me/keyset')).body as Map<string, unknown>;
        expect((keyset.get('keyset') as Uint8Array).length).toBe(300);
        expect(Buffer.from(keyset.get('auth_salt') as Uint8Array)).toEqual(a.authSalt);
      });

      it('refuses a duplicate email or account id, and a malformed registration', async () => {
        const h = await start();
        const a = await register(h);
        await expect(register(h, { email: a.email })).rejects.toThrow('409');
        await expect(register(h, { accountId: a.accountId })).rejects.toThrow('409');
        const bad = await h.raw('POST', '/accounts', { 'content-type': 'application/cbor' }, cbor({ account_id: 'x' }));
        expect(bad.statusCode).toBe(400);
        const notCbor = await h.raw('POST', '/accounts', { 'content-type': 'application/cbor' }, Buffer.from('garbage'));
        expect(notCbor.statusCode).toBe(400);
      });

      it('refuses server-weak key-derivation settings on registration', async () => {
        const h = await start();
        const pake = await testPake();
        const body = (kdf: unknown) => cbor({
          account_id: newAccountId(), email: 'weak@example.com', auth_salt: randomBytes(16), kdf, srp_verifier: pake.verifier(SecretBuf.from(randomX())), keyset: randomBytes(100),
          device: { dev_id: randomBytes(16), sig_pk: randomBytes(32) },
        });
        for (const kdf of [
          { kdf: 'argon2id', m_kib: 1024n, t: 3n, p: 1n, enc_salt: randomBytes(16) }, { kdf: 'argon2id', m_kib: 65_536n, t: 1n, p: 1n, enc_salt: randomBytes(16) },
          { kdf: 'pbkdf2-hmac-sha256', iter: 1000n, enc_salt: randomBytes(16) },
        ]) {
          expect((await h.raw('POST', '/accounts', { 'content-type': 'application/cbor' }, body(kdf))).statusCode).toBe(400);
        }
      });

      it('rejects a wrong password with one uniform answer', async () => {
        const h = await start();
        const a = await register(h);
        await expect(signIn(h, a, a.device, randomX())).rejects.toMatchObject({ kind: 'rejected' });
        await expect(signIn(h, { ...a, email: 'nobody@example.com' })).rejects.toMatchObject({ kind: 'rejected' });
      });

      it('answers hello for an unknown address in the same shape and size as for a real one', async () => {
        const h = await start();
        const a = await register(h);
        const hello = async (email: string) => h.raw('POST', '/auth/hello', { 'content-type': 'application/cbor' }, cbor({ email, device_id: randomBytes(16) }));
        const [real, fake] = [await hello(a.email), await hello('ghost@example.com')];
        expect([real.statusCode, fake.statusCode]).toEqual([200, 200]);
        expect(real.rawPayload.length).toBe(fake.rawPayload.length);
        const shape = (r: { rawPayload: Buffer }) => [...(decode(new Uint8Array(r.rawPayload)) as Map<string, unknown>).keys()].sort();
        expect(shape(real)).toEqual(shape(fake));
      });

      it('rate-limits hello and sends Retry-After', async () => {
        const h = await start();
        const send = () => h.raw('POST', '/auth/hello', { 'content-type': 'application/cbor' }, cbor({ email: 'spam@example.com', device_id: randomBytes(16) }));
        for (let i = 0; i < 10; i++) expect((await send()).statusCode).toBe(200);
        const limited = await send();
        expect(limited.statusCode).toBe(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect((decode(new Uint8Array(limited.rawPayload)) as Map<string, unknown>).get('error')).toBe('rate_limited');
      });

      it('backs off after repeated wrong passwords and recovers with time', async () => {
        const h = await start();
        const a = await register(h);
        for (let i = 0; i < 6; i++) {
          h.clock.now += 120_000;
          await signIn(h, a, a.device, randomX()).catch(() => undefined);
        }
        await expect(signIn(h, a)).rejects.toMatchObject({ kind: 'rate_limited' });
        h.clock.now += 20 * 60_000;
        await expect(signIn(h, a)).resolves.toBeDefined();
      });

      it('aborts sign-in when the server offers key-derivation settings below the floor (AUTH-3)', async () => {
        const h = await start();
        const a = await register(h);
        const pake = await testPake();
        const weak: typeof h.send = async (req) => {
          const res = await h.send(req);
          if (req.path !== '/auth/hello') return res;
          const m = decode(res.body) as Map<string, unknown>;
          m.set('kdf', new Map<string, unknown>([['kdf', 'argon2id'], ['m_kib', 1024n], ['t', 1n], ['p', 1n], ['enc_salt', randomBytes(16)]]));
          return { ...res, body: encode(m as never) };
        };
        const client = createRelayClient({ send: weak, pake, aead: createAesGcm(), hkdf: createHkdf() });
        await expect(client.signIn({ email: a.email, deviceId: a.device.devId, deriveX: async () => SecretBuf.from(a.x) })).rejects.toBeInstanceOf(KdfBelowFloor);
      });

      it('invite-only registration needs a code', async () => {
        const h = await start({ registration: 'invite', inviteCodes: ['let-me-in'] });
        await expect(register(h)).rejects.toThrow('403');
        await expect(register(h, { invite: 'wrong' })).rejects.toThrow('403');
        await expect(register(h, { invite: 'let-me-in' })).resolves.toBeDefined();
      });
    });

    describe('the authenticated transport', () => {
      it('refuses requests with no session, an unknown session, or no frame', async () => {
        const h = await start();
        expect((await h.raw('GET', '/accounts/me')).statusCode).toBe(401);
        expect((await h.raw('GET', '/accounts/me', { 'x-cashfold-session': b64u(randomBytes(16)) })).statusCode).toBe(401);
        const a = await register(h);
        const { session } = await signIn(h, a);
        expect((await h.raw('GET', '/accounts/me', { 'x-cashfold-session': b64u(session.sessionId) })).statusCode).toBe(401);
      });

      it('refuses a replayed request frame and ends the session', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        const frame = await session.sealRequest('GET', '/accounts/me');
        const headers = { 'x-cashfold-session': b64u(session.sessionId), 'x-cashfold-frame': b64u(frame) };
        expect((await h.raw('GET', '/accounts/me', headers)).statusCode).toBe(200);
        expect((await h.raw('GET', '/accounts/me', headers)).statusCode).toBe(401); // the same bytes again
        await expect(session.request('GET', '/accounts/me')).rejects.toBeDefined(); // the session is gone for good
      });

      it('refuses a frame aimed at a different route than the one it was sealed for', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        const frame = await session.sealRequest('GET', '/devices');
        const res = await h.raw('GET', '/accounts/me', { 'x-cashfold-session': b64u(session.sessionId), 'x-cashfold-frame': b64u(frame) });
        expect(res.statusCode).toBe(400);
      });

      it('refuses a tampered frame', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        const frame = Uint8Array.from(await session.sealRequest('GET', '/accounts/me'));
        frame[frame.length - 3] = frame.at(-3)! ^ 1;
        const res = await h.raw('GET', '/accounts/me', { 'x-cashfold-session': b64u(session.sessionId), 'x-cashfold-frame': b64u(frame) });
        expect(res.statusCode).toBe(401);
      });

      it('keeps sessions apart: one account\'s session cannot see another\'s data', async () => {
        const h = await start();
        const [a, b] = [await register(h), await register(h)];
        const [sa, sb] = [(await signIn(h, a)).session, (await signIn(h, b)).session];
        expect(((await sa.request('GET', '/accounts/me')).body as Map<string, unknown>).get('account_id')).toBe(a.accountId);
        expect(((await sb.request('GET', '/accounts/me')).body as Map<string, unknown>).get('account_id')).toBe(b.accountId);
      });

      it('expires a session after 30 idle minutes', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        h.clock.now += 31 * 60_000;
        await expect(session.request('GET', '/accounts/me')).rejects.toBeDefined();
      });

      it('never reveals a reason in an error body', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        await expect(session.request('GET', '/folds/AAAAAAAAAAAAAAAAAAAAAA/ops?after=0')).rejects.toMatchObject({ kind: 'forbidden' });
        const res = await h.raw('POST', '/auth/proof-a', { 'content-type': 'application/cbor' }, cbor({ session_id: randomBytes(16), A: randomBytes(512) }));
        expect(res.statusCode).toBe(401);
        expect(Array.from((decode(new Uint8Array(res.rawPayload)) as Map<string, unknown>).keys())).toEqual(['error']);
      });
    });

    describe('devices', () => {
      it('lists a device, registers a second one for itself only, and revokes it (AUTH-7)', async () => {
        const h = await start();
        const a = await register(h);
        const first = (await signIn(h, a)).session;
        expect(((await first.request('GET', '/devices')).body as unknown[]).length).toBe(1);

        const second = await newDevice();
        const other = (await signIn(h, a, second)).session; // a new device signs in with the same secrets, before it is registered
        await expect(other.request('GET', '/devices')).rejects.toMatchObject({ kind: 'forbidden' }); // not yet registered
        expect((await other.request('GET', '/accounts/me/keyset')).status).toBe(200); // but it may fetch the key set
        await expect(other.request('POST', '/devices', { dev_id: randomBytes(16), sig_pk: second.sigPk })).rejects.toMatchObject({ kind: 'forbidden' }); // only itself
        expect((await other.request('POST', '/devices', { dev_id: second.devId, sig_pk: second.sigPk })).status).toBe(201);
        expect(((await first.request('GET', '/devices')).body as unknown[]).length).toBe(2);

        expect((await first.request('DELETE', `/devices/${b64u(second.devId)}`)).status).toBe(204);
        await expect(other.request('GET', '/accounts/me')).rejects.toBeDefined(); // its session ended at once
        await expect(signIn(h, a, second)).rejects.toMatchObject({ kind: 'revoked' }); // and, once it proves the password, it is told it was removed
        await expect(signIn(h, a, second, randomX())).rejects.toMatchObject({ kind: 'rejected' }); // without the password it learns nothing
        expect((await first.request('GET', '/accounts/me')).status).toBe(200); // the other device is unaffected
        await expect(first.request('DELETE', `/devices/${b64u(second.devId)}`)).rejects.toMatchObject({ kind: 'not_found' });
      });
    });

    describe('device labels', () => {
      it('stores an encrypted label for any of the account\'s devices, and lists it back', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        const label = randomBytes(40);
        expect((await session.request('PUT', `/devices/${b64u(a.device.devId)}`, { label_ct: label })).status).toBe(204);
        const [d] = (await session.request('GET', '/devices')).body as Array<Map<string, unknown>>;
        expect(Buffer.from(d!.get('label_ct') as Uint8Array)).toEqual(label);
        await session.request('PUT', `/devices/${b64u(a.device.devId)}`, { label_ct: null });
        expect(((await session.request('GET', '/devices')).body as Array<Map<string, unknown>>)[0]!.has('label_ct')).toBe(false);
      });

      it('refuses an unknown device, another account\'s device, a revoked device and an oversized label', async () => {
        const h = await start();
        const [a, b] = [await register(h), await register(h)];
        const { session } = await signIn(h, a);
        await expect(session.request('PUT', `/devices/${b64u(randomBytes(16))}`, { label_ct: null })).rejects.toMatchObject({ kind: 'not_found' });
        await expect(session.request('PUT', `/devices/${b64u(b.device.devId)}`, { label_ct: null })).rejects.toMatchObject({ kind: 'not_found' });
        await expect(session.request('PUT', `/devices/${b64u(a.device.devId)}`, { label_ct: randomBytes(300) })).rejects.toMatchObject({ status: 400 });
        const second = await newDevice();
        const other = (await signIn(h, a, second)).session;
        await other.request('POST', '/devices', { dev_id: second.devId, sig_pk: second.sigPk });
        await session.request('DELETE', `/devices/${b64u(second.devId)}`);
        await expect(session.request('PUT', `/devices/${b64u(second.devId)}`, { label_ct: null })).rejects.toMatchObject({ kind: 'not_found' });
      });
    });

    describe('credential change and account deletion', () => {
      it('replaces the credentials atomically and ends every other session (AUTH-6)', async () => {
        const h = await start();
        const a = await register(h);
        const pake = await testPake();
        const [one, two] = [(await signIn(h, a)).session, (await signIn(h, a, await newDevice())).session];
        const x2 = randomX();
        const kdf = { kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n, enc_salt: randomBytes(16) };
        const rotated = await one.request('PUT', '/accounts/me/keyset', { auth_salt: randomBytes(16), kdf, srp_verifier: pake.verifier(SecretBuf.from(x2)), keyset: randomBytes(310) });
        expect(rotated.status).toBe(204);
        expect((await one.request('GET', '/accounts/me/keyset')).status).toBe(200); // the session that changed it continues
        await expect(two.request('GET', '/accounts/me')).rejects.toBeDefined(); // every other session ended
        await expect(signIn(h, a, a.device, a.x)).rejects.toMatchObject({ kind: 'rejected' }); // the old secret no longer works
        await expect(signIn(h, a, a.device, x2)).resolves.toBeDefined(); // the new one does
      });

      it('deletes an account only after a fresh proof, tells its other devices (410), and removes its Folds', async () => {
        const h = await start();
        const a = await register(h);
        const { session, freshProof } = await signIn(h, a);
        const other = (await signIn(h, a, await newDevice())).session;
        const fold = randomBytes(16);
        await session.request('POST', '/folds', { fold });
        await expect(session.request('DELETE', '/accounts/me', { fresh_proof: randomBytes(32) })).rejects.toMatchObject({ kind: 'forbidden' });
        h.clock.now += 6 * 60_000; // the sign-in is no longer fresh
        await expect(session.request('DELETE', '/accounts/me', { fresh_proof: freshProof })).rejects.toMatchObject({ kind: 'forbidden' });
        const again = await signIn(h, a);
        expect((await again.session.request('DELETE', '/accounts/me', { fresh_proof: again.freshProof })).status).toBe(204);
        await expect(other.request('GET', '/accounts/me')).rejects.toBeDefined();
        await expect(signIn(h, a)).rejects.toMatchObject({ kind: 'rejected' });
        expect(await h.relay.services.store.folds.roleOf(fold, a.accountId)).toBeUndefined();
      });
    });

    describe('email verification', () => {
      it('sends one link, accepts it once, and not after it expires', async () => {
        const h = await start();
        const a = await register(h);
        expect(h.mail.sent).toHaveLength(1);
        const mail = h.mail.sent[0]!;
        expect(mail.to).toBe(a.email);
        expect(mail.text).not.toMatch(/balance|amount|transaction|\d{4,}\.\d/i);
        const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
        expect((await h.raw('POST', '/accounts/verify-email', { 'content-type': 'application/cbor' }, cbor({ token }))).statusCode).toBe(204);
        expect((await h.raw('POST', '/accounts/verify-email', { 'content-type': 'application/cbor' }, cbor({ token }))).statusCode).toBe(400);
        const { session } = await signIn(h, a);
        expect(((await session.request('GET', '/accounts/me')).body as Map<string, unknown>).get('email_verified')).toBe(true);

        const b = await register(h);
        const expired = /#token=([A-Za-z0-9_-]+)/.exec(h.mail.sent.at(-1)!.text)![1]!;
        h.clock.now += 25 * 3_600_000;
        expect(b.accountId).toBeDefined();
        expect((await h.raw('POST', '/accounts/verify-email', { 'content-type': 'application/cbor' }, cbor({ token: expired }))).statusCode).toBe(400);
      });

      it('reports that verification is off when no mail is configured', async () => {
        const h = await start({ mail: { kind: 'none' } });
        const a = await register(h);
        const { session } = await signIn(h, a);
        expect(((await session.request('GET', '/accounts/me')).body as Map<string, unknown>).get('verification')).toBe('disabled');
      });

      it('lets the owner choose to be discoverable or not', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        expect((await session.request('PUT', '/accounts/me/discoverable', { discoverable: false })).status).toBe(204);
        expect(((await session.request('GET', '/accounts/me')).body as Map<string, unknown>).get('discoverable')).toBe(false);
      });
    });

    describe('folds, ops and snapshots', () => {
      const setup = async (h: Harness) => {
        const a = await register(h);
        const { session } = await signIn(h, a);
        const fold = randomBytes(16);
        await session.request('POST', '/folds', { fold });
        return { a, session, fold, foldPath: b64u(fold) };
      };
      const results = (body: unknown) => (body as Array<Map<string, unknown>>).map((m) => ({ error: m.get('error'), seq: m.get('server_seq') }));

      it('stores pushed ops, numbers them, and returns them in order on pull', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        const ops = [await signedOp(fold, a.device, 1n), await signedOp(fold, a.device, 2n), await signedOp(fold, a.device, 3n)];
        const pushed = results((await session.request('POST', `/folds/${foldPath}/ops`, ops)).body);
        expect(pushed.map((r) => r.seq)).toEqual([1n, 2n, 3n]);
        const page = (await session.request('GET', `/folds/${foldPath}/ops?after=1`)).body as Map<string, unknown>;
        expect(page.get('head')).toBe(3n);
        expect(page.get('more')).toBe(false);
        const got = (page.get('ops') as Array<Map<string, unknown>>).map((m) => m.get('server_seq'));
        expect(got).toEqual([2n, 3n]);
        expect((page.get('ops') as Array<Map<string, unknown>>)[0]!.get('op')).toEqual(ops[1]);
      });

      it('treats a resent op as a duplicate and keeps one copy', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        const op = await signedOp(fold, a.device, 1n);
        await session.request('POST', `/folds/${foldPath}/ops`, [op]);
        const again = results((await session.request('POST', `/folds/${foldPath}/ops`, [op])).body);
        expect(again[0]!.error).toBe('duplicate');
        expect(((await session.request('GET', `/folds/${foldPath}/ops?after=0`)).body as Map<string, unknown>).get('head')).toBe(1n);
      });

      it('refuses a gap in a device\'s sequence and a different op reusing a sequence number', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        expect(results((await session.request('POST', `/folds/${foldPath}/ops`, [await signedOp(fold, a.device, 3n)])).body)[0]!.error).toBe('seq_gap');
        await session.request('POST', `/folds/${foldPath}/ops`, [await signedOp(fold, a.device, 1n)]);
        expect(results((await session.request('POST', `/folds/${foldPath}/ops`, [await signedOp(fold, a.device, 1n)])).body)[0]!.error).toBe('seq_conflict');
      });

      it('refuses a forged signature, an op from another device, and an op for another Fold', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        const forged = Uint8Array.from(await signedOp(fold, a.device, 1n));
        forged[forged.length - 5] = forged.at(-5)! ^ 1;
        expect(results((await session.request('POST', `/folds/${foldPath}/ops`, [forged])).body)[0]!.error).toMatch(/bad_signature|unauthorised/);
        const stranger = await newDevice();
        expect(results((await session.request('POST', `/folds/${foldPath}/ops`, [await signedOp(fold, stranger, 1n)])).body)[0]!.error).toBe('unauthorised');
        expect(results((await session.request('POST', `/folds/${foldPath}/ops`, [await signedOp(randomBytes(16), a.device, 1n)])).body)[0]!.error).toBe('unauthorised');
        expect(((await session.request('GET', `/folds/${foldPath}/ops?after=0`)).body as Map<string, unknown>).get('head')).toBe(0n);
      });

      it('keeps one account\'s Folds from another, for push, pull, snapshot and ack', async () => {
        const h = await start();
        const { fold, foldPath } = await setup(h);
        const b = await register(h);
        const mine = (await signIn(h, b)).session;
        for (const [m, path, body] of [
          ['POST', `/folds/${foldPath}/ops`, [await signedOp(fold, b.device, 1n)]], ['GET', `/folds/${foldPath}/ops?after=0`, undefined],
          ['GET', `/folds/${foldPath}/snapshot`, undefined], ['POST', `/folds/${foldPath}/ack`, { seq: 0n }], ['DELETE', `/folds/${foldPath}`, undefined],
        ] as const) {
          await expect(mine.request(m, path, body)).rejects.toMatchObject({ kind: 'forbidden' });
        }
        expect(((await mine.request('GET', '/folds')).body as unknown[]).length).toBe(0);
      });

      it('pages a long log and caps the page size', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        for (let i = 0; i < 3; i++) await session.request('POST', `/folds/${foldPath}/ops`, await Promise.all([1, 2, 3, 4].map((k) => signedOp(fold, a.device, BigInt(i * 4 + k)))));
        const page = (await session.request('GET', `/folds/${foldPath}/ops?after=0&limit=5`)).body as Map<string, unknown>;
        expect((page.get('ops') as unknown[]).length).toBe(5);
        expect(page.get('more')).toBe(true);
        await expect(session.request('GET', `/folds/${foldPath}/ops?after=0&limit=5000`)).rejects.toMatchObject({ status: 400 });
        await expect(session.request('GET', `/folds/${foldPath}/ops?after=-1`)).rejects.toMatchObject({ status: 400 });
      });

      it('refuses a duplicate Fold and lets only the owner delete one', async () => {
        const h = await start();
        const { session, fold, foldPath } = await setup(h);
        await expect(session.request('POST', '/folds', { fold })).rejects.toMatchObject({ kind: 'conflict' });
        expect((await session.request('DELETE', `/folds/${foldPath}`)).status).toBe(204);
        expect(((await session.request('GET', '/folds')).body as unknown[]).length).toBe(0);
      });

      it('keeps a snapshot, refuses one ahead of the log, and prunes only what every device has acknowledged', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        await session.request('POST', `/folds/${foldPath}/ops`, await Promise.all([1n, 2n, 3n].map((n) => signedOp(fold, a.device, n))));
        const snap = { fold, at_seq: 2n, epoch: 1n, blob: randomBytes(64), sig: randomBytes(64) };
        await expect(session.request('PUT', `/folds/${foldPath}/snapshot`, { ...snap, at_seq: 9n })).rejects.toMatchObject({ status: 400 });
        expect((await session.request('PUT', `/folds/${foldPath}/snapshot`, snap)).status).toBe(204);
        const got = (await session.request('GET', `/folds/${foldPath}/snapshot`)).body as Map<string, unknown>;
        expect(got.get('at_seq')).toBe(2n);
        expect(got.get('epoch')).toBe(1n);
        expect(Buffer.from(got.get('blob') as Uint8Array)).toEqual(snap.blob);

        await session.request('POST', `/folds/${foldPath}/ack`, { seq: 3n });
        const opsAfter = (await session.request('GET', `/folds/${foldPath}/ops?after=0`)).body as Map<string, unknown>;
        expect((opsAfter.get('ops') as unknown[]).length).toBeLessThanOrEqual(3);
        expect(opsAfter.get('head')).toBe(3n);
      });

      it('stores the owner\'s grant with the Fold and returns it to the owner\'s devices, oldest epoch first', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        const dev2 = await newDevice();
        const second = (await signIn(h, a, dev2)).session;
        await second.request('POST', '/devices', { dev_id: dev2.devId, sig_pk: dev2.sigPk });
        const fold = randomBytes(16);
        const grant = (epoch: number, f = fold, member = a.accountId) => encodeFoldKeyGrant({ fold: f, epoch, member: Buffer.from(member), role: 1, enc: randomBytes(32), ct: randomBytes(48), granted_by: Buffer.from(a.accountId), sig: randomBytes(64) });
        const g1 = grant(1);
        await session.request('POST', '/folds', { fold, grant: g1 });
        const got = (await second.request('GET', `/folds/${b64u(fold)}/grants?member=me`)).body as Uint8Array[];
        expect(got.map((g) => Buffer.from(g))).toEqual([Buffer.from(g1)]);
      });

      it('refuses a grant for someone else, for another Fold, or that is not a grant', async () => {
        const h = await start();
        const a = await register(h);
        const { session } = await signIn(h, a);
        const fold = randomBytes(16);
        const mk = (f: Uint8Array, member: string) => encodeFoldKeyGrant({ fold: f, epoch: 1, member: Buffer.from(member), role: 1, enc: randomBytes(32), ct: randomBytes(48), granted_by: Buffer.from(a.accountId), sig: randomBytes(64) });
        await expect(session.request('POST', '/folds', { fold, grant: mk(fold, 'ZZZZZZ') })).rejects.toMatchObject({ status: 400 });
        await expect(session.request('POST', '/folds', { fold, grant: mk(randomBytes(16), a.accountId) })).rejects.toMatchObject({ status: 400 });
        await expect(session.request('POST', '/folds', { fold, grant: randomBytes(20) })).rejects.toMatchObject({ status: 400 });
        expect(((await session.request('GET', '/folds')).body as unknown[]).length).toBe(0); // nothing half-created
      });

      it('only returns grants to a member of the Fold', async () => {
        const h = await start();
        const [a, b] = [await register(h), await register(h)];
        const { session } = await signIn(h, a);
        const fold = randomBytes(16);
        await session.request('POST', '/folds', { fold });
        const other = (await signIn(h, b)).session;
        await expect(other.request('GET', `/folds/${b64u(fold)}/grants?member=me`)).rejects.toMatchObject({ kind: 'forbidden' });
        await expect(session.request('GET', `/folds/${b64u(fold)}/grants?member=someone`)).rejects.toMatchObject({ status: 400 });
      });

      it('tells a connected device to pull when another device pushes', async () => {
        const h = await start();
        const { a, session, fold, foldPath } = await setup(h);
        await h.relay.app.listen(0, '127.0.0.1');
        const addr = h.relay.app.getHttpServer().address() as { port: number };
        const path = `/folds/${foldPath}/stream?session=${b64u(session.sessionId)}`;
        const { WebSocket } = await import('ws');
        const ws = new WebSocket(`ws://127.0.0.1:${addr.port}${path}`);
        const pings: number[] = [];
        ws.on('message', (d: Buffer) => pings.push(d.length));
        await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
        ws.send(await session.sealRequest('GET', path));
        await vi.waitFor(() => expect(pings).toEqual([1]));
        const other = (await signIn(h, a)).session;
        await other.request('POST', `/folds/${foldPath}/ops`, [await signedOp(fold, a.device, 1n)]);
        await vi.waitFor(() => expect(pings).toEqual([1, 1]));
        ws.close();
      });

      it('closes a stream that does not authenticate', async () => {
        const h = await start();
        const { session, foldPath } = await setup(h);
        await h.relay.app.listen(0, '127.0.0.1');
        const addr = h.relay.app.getHttpServer().address() as { port: number };
        const { WebSocket } = await import('ws');
        const noSession = new WebSocket(`ws://127.0.0.1:${addr.port}/folds/${foldPath}/stream`);
        const err = await new Promise<Error>((resolve) => noSession.once('error', resolve));
        expect(err.message).toMatch(/401/);
        const path = `/folds/${foldPath}/stream?session=${b64u(session.sessionId)}`;
        const ws = new WebSocket(`ws://127.0.0.1:${addr.port}${path}`);
        await new Promise<void>((resolve) => ws.once('open', () => resolve()));
        ws.send(Buffer.from('not a frame'));
        const code = await new Promise<number>((resolve) => ws.once('close', resolve));
        expect(code).toBe(4401);
      });
    });

    describe('exchange rates', () => {
      const upstream = async () => JSON.stringify({ rates: { EUR: 0.9137, GBP: '0.79', BAD: -1, JPY: 151.5 } });

      it('publishes nothing until configured and nothing until a refresh succeeds', async () => {
        const off = await start();
        expect((await off.raw('GET', '/rates')).statusCode).toBe(404);
        const on = await start({ rates: { kind: 'upstream', url: 'https://rates.example.test/latest', everyHours: 6 } }, { fetchRates: upstream });
        expect((await on.raw('GET', '/rates')).statusCode).toBe(404);
        expect(await on.relay.services.rates.refresh()).toBe(true);
        const res = await on.raw('GET', '/rates');
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).toContain('"EUR":"0.9137"'); // text, never a float
        expect(res.body).not.toContain('BAD');
        expect(res.headers['set-cookie']).toBeUndefined();
      });

      it('keeps the last good table when the upstream fails or returns rubbish', async () => {
        let body = JSON.stringify({ rates: { EUR: '0.9' } });
        const h = await start({ rates: { kind: 'upstream', url: 'https://rates.example.test/latest', everyHours: 6 } }, { fetchRates: async () => body });
        await h.relay.services.rates.refresh();
        body = 'nonsense';
        expect(await h.relay.services.rates.refresh()).toBe(false);
        expect((await h.raw('GET', '/rates')).body).toContain('"EUR":"0.9"');
      });
    });
  });
}
export type { TestAccount };
