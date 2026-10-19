import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '../../src/store/store.js';
import { newDevice, register, signIn, startRelay, type Harness } from './relay-harness.js';

// Account deletion on the service (FR-101): what goes, what stays for other people, and what the account's other devices are told.
export function describeDeleteAccount(label: string, makeStore: () => Promise<Store>): void {
  describe(`Account deletion: ${label}`, () => {
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

    it('is refused with 409 while the account owns a Fold others belong to, and nothing is removed', async () => {
      const h = await start();
      const [alice, bob] = [await register(h), await register(h)];
      const { session } = await signIn(h, alice);
      const fold = randomBytes(16);
      await session.request('POST', '/folds', { fold });
      const store = h.relay.services.store;
      await store.folds.addMember(fold, bob.accountId, 2, 1);
      const fresh = await signIn(h, alice);
      expect(await status(fresh.session.request('DELETE', '/accounts/me', { fresh_proof: fresh.freshProof }))).toBe(409);
      expect(await store.folds.roleOf(fold, alice.accountId)).toBe(1);
      expect((await signIn(h, alice)).session).toBeDefined(); // still there
    });

    it('removes sole-member Folds, keeps shared Folds for the others, and drops devices, grants and sessions', async () => {
      const h = await start();
      const [alice, bob] = [await register(h), await register(h)];
      const store = h.relay.services.store;
      const { session: bobs } = await signIn(h, bob);
      const shared = randomBytes(16);
      await bobs.request('POST', '/folds', { fold: shared });
      await store.folds.addMember(shared, alice.accountId, 2, 1);
      const { session } = await signIn(h, alice);
      const mine = randomBytes(16);
      await session.request('POST', '/folds', { fold: mine });
      await store.grants.put(mine, alice.accountId, 1, randomBytes(40));

      const fresh = await signIn(h, alice);
      expect((await fresh.session.request('DELETE', '/accounts/me', { fresh_proof: fresh.freshProof })).status).toBe(204);

      expect(await store.folds.roleOf(mine, alice.accountId)).toBeUndefined();
      expect(await store.folds.members(mine)).toEqual([]);
      expect(await store.grants.forMember(mine, alice.accountId)).toEqual([]);
      expect(await store.folds.members(shared)).not.toContain(alice.accountId);
      expect(await store.folds.roleOf(shared, bob.accountId)).toBe(1);
      expect(await store.accounts.byId(alice.accountId)).toBeUndefined();
      expect(await store.accounts.isTombstoned(alice.accountId)).toBe(true);
    });

    it('answers the account\'s other devices with 410 Gone, and a signed-out device with the same', async () => {
      const h = await start();
      const alice = await register(h);
      const { session } = await signIn(h, alice);
      const other = (await signIn(h, alice, await newDevice())).session;
      const fresh = await signIn(h, alice);
      await fresh.session.request('DELETE', '/accounts/me', { fresh_proof: fresh.freshProof });
      expect(await status(other.request('GET', '/accounts/me'))).toBe(410);
      expect(await status(session.request('GET', '/accounts/me'))).toBe(410);
      await expect(signIn(h, alice)).rejects.toMatchObject({ kind: 'rejected' }); // a new sign-in learns nothing more than "no"
    });
  });
}
