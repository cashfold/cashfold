import { randomBytes } from 'node:crypto';
import { encode } from '@cashfold/protocol/cbor';
import { SecretBuf } from '@cashfold/crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '../../src/store/store.js';
import { randomX, testPake } from './pake.js';
import { newDevice, register, signIn, startRelay, type Harness } from './relay-harness.js';

// The Recovery Key credential on the service (ARCH 6.8, FR-009): a second SRP verifier and the wrapped keys, which the service
// can neither read nor use. An account without one is indistinguishable from an address that has no account.
export function describeRecovery(label: string, makeStore: () => Promise<Store>): void {
  describe(`Recovery credential: ${label}`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      while (open.length > 0) await open.pop()!.close();
    });
    const start = async (): Promise<Harness> => {
      const h = await startRelay(await makeStore(), { rateLimitScale: 1000 });
      open.push(h);
      return h;
    };
    const status = async (p: Promise<unknown>): Promise<number> => p.then(() => 200, (e: { status?: number }) => e.status ?? 0);
    const setUp = async (h: Harness) => {
      const a = await register(h);
      const { session } = await signIn(h, a);
      const x = randomX();
      const body = { uuid: randomBytes(16), auth_salt: randomBytes(16), srp_verifier: (await testPake()).verifier(SecretBuf.from(x)), wrapped: randomBytes(92) };
      expect((await session.request('PUT', '/accounts/me/recovery', body)).status).toBe(204);
      return { a, session, x, body };
    };

    it('stores the credential and gives back the wrapped keys with the key set after a recovery sign-in', async () => {
      const h = await start();
      const { a, x, body } = await setUp(h);
      const { session, authSalt } = await signIn(h, a, a.device, x, 'recovery');
      expect(Buffer.from(authSalt)).toEqual(body.auth_salt); // the recovery credential has its own salt
      const got = (await session.request('GET', '/accounts/me/recovery')).body as Map<string, Uint8Array>;
      expect(Buffer.from(got.get('wrapped')!)).toEqual(body.wrapped);
      expect(Buffer.from(got.get('uuid')!)).toEqual(body.uuid);
      expect(got.get('keyset')).toBeInstanceOf(Uint8Array);
    });

    it('lets a device that is not registered yet read the wrapped keys and set new credentials, which is how recovery works', async () => {
      const h = await start();
      const { a, x, body } = await setUp(h);
      const { session } = await signIn(h, a, await newDevice(), x, 'recovery');
      expect(Buffer.from(((await session.request('GET', '/accounts/me/recovery')).body as Map<string, Uint8Array>).get('wrapped')!)).toEqual(body.wrapped);
      const x2 = randomX();
      const rotated = await session.request('PUT', '/accounts/me/keyset', {
        auth_salt: randomBytes(16), kdf: { kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n, enc_salt: randomBytes(16) }, srp_verifier: (await testPake()).verifier(SecretBuf.from(x2)), keyset: randomBytes(310),
      });
      expect(rotated.status).toBe(204);
      await expect(signIn(h, a, a.device, x2)).resolves.toBeDefined();
      expect(await status(session.request('GET', '/accounts/me'))).toBe(403); // nothing else is open to an unregistered device
    });

    it('does not accept the account password for it, nor the Recovery Key for the password', async () => {
      const h = await start();
      const { a, x } = await setUp(h);
      await expect(signIn(h, a, a.device, a.x, 'recovery')).rejects.toMatchObject({ kind: 'rejected' });
      await expect(signIn(h, a, a.device, x)).rejects.toMatchObject({ kind: 'rejected' });
      await expect(signIn(h, a, a.device, a.x)).resolves.toBeDefined();
    });

    it('answers an account with no Recovery Key exactly like an unknown address', async () => {
      const h = await start();
      const withoutKey = await register(h);
      await expect(signIn(h, withoutKey, withoutKey.device, randomX(), 'recovery')).rejects.toMatchObject({ kind: 'rejected' });
      const hello = async (email: string) => {
        const r = await h.raw('POST', '/auth/hello', { 'content-type': 'application/cbor' }, encode({ email, device_id: randomBytes(16), credential: 'recovery' } as never));
        return r.statusCode;
      };
      expect(await hello(withoutKey.email)).toBe(await hello('nobody@example.com'));
    });

    it('survives a password change, can be replaced and removed, and goes with the account', async () => {
      const h = await start();
      const { a, session, body } = await setUp(h);
      const x2 = randomX();
      const rotated = await session.request('PUT', '/accounts/me/keyset', {
        auth_salt: randomBytes(16), kdf: { kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n, enc_salt: randomBytes(16) }, srp_verifier: (await testPake()).verifier(SecretBuf.from(x2)), keyset: randomBytes(310),
      });
      expect(rotated.status).toBe(204);
      const again = await signIn(h, a, a.device, x2);
      expect(((await again.session.request('GET', '/accounts/me/recovery')).body as Map<string, Uint8Array>).get('wrapped')).toBeDefined();
      expect(Buffer.from(((await again.session.request('GET', '/accounts/me/recovery')).body as Map<string, Uint8Array>).get('uuid')!)).toEqual(body.uuid);

      const replacement = { ...body, uuid: randomBytes(16) };
      await again.session.request('PUT', '/accounts/me/recovery', replacement);
      expect(Buffer.from(((await again.session.request('GET', '/accounts/me/recovery')).body as Map<string, Uint8Array>).get('uuid')!)).toEqual(replacement.uuid);

      expect((await again.session.request('DELETE', '/accounts/me/recovery')).status).toBe(204);
      expect(await status(again.session.request('GET', '/accounts/me/recovery'))).toBe(404);

      await again.session.request('PUT', '/accounts/me/recovery', body);
      const fresh = await signIn(h, a, a.device, x2);
      await fresh.session.request('DELETE', '/accounts/me', { fresh_proof: fresh.freshProof });
      expect(await h.relay.services.store.recovery.get(a.accountId)).toBeUndefined();
    });

    it('refuses a malformed credential', async () => {
      const h = await start();
      const a = await register(h);
      const { session } = await signIn(h, a);
      expect(await status(session.request('PUT', '/accounts/me/recovery', { uuid: randomBytes(15), auth_salt: randomBytes(16), srp_verifier: randomBytes(512), wrapped: randomBytes(92) }))).toBe(400);
      expect(await status(session.request('PUT', '/accounts/me/recovery', { uuid: randomBytes(16), auth_salt: randomBytes(16), srp_verifier: randomBytes(100), wrapped: randomBytes(92) }))).toBe(400);
    });
  });
}
