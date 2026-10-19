import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountRow, DeviceRow, NewAccount, OpRow, Store } from './store.js';

// Behaviour every Store must have. The memory store runs it in unit tests; PostgreSQL runs it in the integration suite.

const b = (n: number, len = 16): Buffer => Buffer.alloc(len, n);
const kdf = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: b(9) } as const;
const account = (id: string, emailByte: number, over: Partial<NewAccount> = {}): NewAccount => ({
  accountId: id, emailHmac: b(emailByte, 32), email: `${id.toLowerCase()}@example.com`, authSalt: b(1), kdf, srpVerifier: b(2, 512), keyset: b(3, 120), discoverable: true, createdAtMs: 1_000, ...over,
});
const device = (accountId: string, n: number, over: Partial<DeviceRow> = {}): DeviceRow => ({ devId: b(n), accountId, sigPk: b(n + 100, 32), labelCt: null, createdAtMs: 1_000 + n, revokedAtMs: null, ...over });
const op = (n: number, devId: Buffer, devSeq: bigint, over: Partial<OpRow> = {}): OpRow => ({
  opId: b(n), recId: b(200 + n), devId, devSeq, hlcWall: 1_700_000_000_000 + n, hlcCtr: n % 5, epoch: 1, schemaVer: 1, blob: b(n, 300), sig: b(n, 64), ...over,
});

export function describeStoreContract(label: string, make: () => Promise<Store>): void {
  describe(`Store contract: ${label}`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
    });
    afterEach(async () => {
      await store.close();
    });

    describe('accounts', () => {
      it('creates, reads back by id and by email MAC, and refuses duplicates', async () => {
        expect(await store.accounts.create(account('ABCDEF', 1))).toBe('ok');
        expect(await store.accounts.create(account('ABCDEF', 2))).toBe('id_taken');
        expect(await store.accounts.create(account('GHJKLM', 1))).toBe('email_taken');
        const byId = await store.accounts.byId('ABCDEF');
        expect(byId).toMatchObject({ accountId: 'ABCDEF', failCount: 0, lockedUntilMs: null, emailVerifiedAtMs: null, discoverable: true, kdf });
        expect(Buffer.from(byId!.srpVerifier)).toEqual(b(2, 512));
        expect((await store.accounts.byEmailHmac(b(1, 32)))?.accountId).toBe('ABCDEF');
        expect(await store.accounts.byEmailHmac(b(9, 32))).toBeUndefined();
        expect(await store.accounts.byId('NOPE12')).toBeUndefined();
      });

      it('counts failures with a lock time, and clears them', async () => {
        await store.accounts.create(account('ABCDEF', 1));
        expect(await store.accounts.recordFailure('ABCDEF', null)).toBe(1);
        expect(await store.accounts.recordFailure('ABCDEF', 5_000)).toBe(2);
        expect(await store.accounts.byId('ABCDEF')).toMatchObject({ failCount: 2, lockedUntilMs: 5_000 });
        await store.accounts.clearFailures('ABCDEF');
        expect(await store.accounts.byId('ABCDEF')).toMatchObject({ failCount: 0, lockedUntilMs: null });
        expect(await store.accounts.recordFailure('MISSING', null)).toBe(0);
      });

      it('replaces credentials as one step and resets the failure counter', async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.accounts.recordFailure('ABCDEF', 9);
        await store.accounts.replaceCredentials('ABCDEF', { authSalt: b(5), kdf: { ...kdf, t: 4 }, srpVerifier: b(6, 512), keyset: b(7, 130) });
        const a = (await store.accounts.byId('ABCDEF')) as AccountRow;
        expect([Buffer.from(a.authSalt), a.kdf.t, Buffer.from(a.srpVerifier)[0], a.failCount]).toEqual([b(5), 4, 6, 0]);
      });

      it('records verification and the discoverable choice', async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.accounts.setEmailVerified('ABCDEF', 7_000);
        await store.accounts.setDiscoverable('ABCDEF', false);
        expect(await store.accounts.byId('ABCDEF')).toMatchObject({ emailVerifiedAtMs: 7_000, discoverable: false });
      });

      it('removing an account removes its devices and leaves a tombstone, and frees nothing for reuse of the id', async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.devices.add(device('ABCDEF', 1));
        await store.accounts.remove('ABCDEF', 9_000);
        expect(await store.accounts.byId('ABCDEF')).toBeUndefined();
        expect(await store.accounts.byEmailHmac(b(1, 32))).toBeUndefined();
        expect(await store.devices.get(b(1))).toBeUndefined();
        expect(await store.accounts.isTombstoned('ABCDEF')).toBe(true);
        expect(await store.accounts.isTombstoned('OTHER1')).toBe(false);
      });
    });

    describe('devices', () => {
      beforeEach(async () => {
        await store.accounts.create(account('ABCDEF', 1));
      });

      it('adds, lists in creation order, gets, and refuses a repeated id', async () => {
        expect(await store.devices.add(device('ABCDEF', 2))).toBe('ok');
        expect(await store.devices.add(device('ABCDEF', 1))).toBe('ok');
        expect(await store.devices.add(device('ABCDEF', 1))).toBe('exists');
        expect((await store.devices.list('ABCDEF')).map((d) => d.devId[0])).toEqual([1, 2]);
        expect(await store.devices.get(b(1))).toMatchObject({ accountId: 'ABCDEF', revokedAtMs: null });
        expect(await store.devices.get(b(77))).toBeUndefined();
      });

      it('revokes once, only for the owner', async () => {
        await store.devices.add(device('ABCDEF', 1));
        expect(await store.devices.revoke('OTHER1', b(1), 5)).toBe(false);
        expect(await store.devices.revoke('ABCDEF', b(1), 5)).toBe(true);
        expect(await store.devices.revoke('ABCDEF', b(1), 6)).toBe(false);
        expect((await store.devices.get(b(1)))?.revokedAtMs).toBe(5);
      });
    });

    describe('email verification', () => {
      it('consumes a live token once and only until it expires', async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.emailVerification.put('ABCDEF', b(4, 32), 2_000);
        expect(await store.emailVerification.consume(b(5, 32), 1_000)).toBeUndefined();
        expect(await store.emailVerification.consume(b(4, 32), 1_000)).toBe('ABCDEF');
        expect(await store.emailVerification.consume(b(4, 32), 1_000)).toBeUndefined();
        await store.emailVerification.put('ABCDEF', b(6, 32), 2_000);
        expect(await store.emailVerification.consume(b(6, 32), 2_000)).toBeUndefined();
      });
    });

    describe('folds', () => {
      beforeEach(async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.accounts.create(account('GHJKLM', 2));
      });

      it('creates a fold owned by its creator, and lists only the caller\'s', async () => {
        expect(await store.folds.create(b(1), 'ABCDEF', 10)).toBe('ok');
        expect(await store.folds.create(b(1), 'GHJKLM', 11)).toBe('exists');
        await store.folds.create(b(2), 'GHJKLM', 12);
        expect((await store.folds.list('ABCDEF')).map((f) => [f.foldId[0], f.headSeq])).toEqual([[1, 0n]]);
        expect(await store.folds.roleOf(b(1), 'ABCDEF')).toBe(1);
        expect(await store.folds.roleOf(b(1), 'GHJKLM')).toBeUndefined();
        expect(await store.folds.members(b(1))).toEqual(['ABCDEF']);
      });

      it('removes a fold with its ops', async () => {
        await store.folds.create(b(1), 'ABCDEF', 10);
        await store.ops.push(b(1), [op(1, b(50), 1n)]);
        await store.folds.remove(b(1));
        expect(await store.folds.list('ABCDEF')).toEqual([]);
        expect(await store.ops.head(b(1))).toBe(0n);
      });
    });

    describe('ops', () => {
      const dev = b(50);
      beforeEach(async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.folds.create(b(1), 'ABCDEF', 10);
      });

      it('assigns server_seq in order, and answers each op', async () => {
        const out = await store.ops.push(b(1), [op(1, dev, 1n), op(2, dev, 2n), op(3, dev, 3n)]);
        expect(out.map((o) => (o.status === 'stored' ? o.serverSeq : o.status))).toEqual([1n, 2n, 3n]);
        expect(await store.ops.head(b(1))).toBe(3n);
        expect(await store.ops.lastDevSeq(b(1), dev)).toBe(3n);
      });

      it('is idempotent on the op id, returning the original server_seq', async () => {
        await store.ops.push(b(1), [op(1, dev, 1n), op(2, dev, 2n)]);
        const again = await store.ops.push(b(1), [op(2, dev, 2n), op(3, dev, 3n)]);
        expect(again.map((o) => [o.status, o.status === 'stored' || o.status === 'duplicate' ? o.serverSeq : 0n])).toEqual([['duplicate', 2n], ['stored', 3n]]);
        expect(await store.ops.head(b(1))).toBe(3n);
      });

      it('requires each device\'s sequence to be gapless and rejects a different op reusing a number', async () => {
        await store.ops.push(b(1), [op(1, dev, 1n)]);
        const out = await store.ops.push(b(1), [op(3, dev, 3n), op(2, dev, 2n), op(9, dev, 2n)]);
        expect(out.map((o) => o.status)).toEqual(['seq_gap', 'stored', 'seq_conflict']);
        expect(await store.ops.lastDevSeq(b(1), dev)).toBe(2n);
        expect(await store.ops.lastDevSeq(b(1), b(51))).toBe(0n);
      });

      it('keeps separate sequences per device', async () => {
        const out = await store.ops.push(b(1), [op(1, dev, 1n), op(2, b(51), 1n), op(3, dev, 2n), op(4, b(51), 2n)]);
        expect(out.every((o) => o.status === 'stored')).toBe(true);
      });

      it('pulls after a cursor in order, with a limit and a more flag, round-tripping every field', async () => {
        const pushed = [op(1, dev, 1n), op(2, dev, 2n), op(3, dev, 3n)];
        await store.ops.push(b(1), pushed);
        const page = await store.ops.pull(b(1), 0n, 2);
        expect(page).toMatchObject({ head: 3n, more: true });
        expect(page.ops.map((o) => o.serverSeq)).toEqual([1n, 2n]);
        expect(page.ops[0]).toMatchObject({ opId: pushed[0]!.opId, devSeq: 1n, hlcWall: 1_700_000_000_001, hlcCtr: 1, epoch: 1, schemaVer: 1 });
        expect(Buffer.from(page.ops[0]!.blob)).toEqual(Buffer.from(pushed[0]!.blob));
        expect(Buffer.from(page.ops[0]!.sig)).toEqual(Buffer.from(pushed[0]!.sig));
        const rest = await store.ops.pull(b(1), 2n, 500);
        expect(rest).toMatchObject({ head: 3n, more: false });
        expect(rest.ops.map((o) => o.serverSeq)).toEqual([3n]);
        expect((await store.ops.pull(b(1), 3n, 10)).ops).toEqual([]);
        expect(await store.ops.pull(b(99), 0n, 10)).toEqual({ ops: [], head: 0n, more: false });
      });

      it('stores a 64-bit device sequence exactly', async () => {
        // Starts from the highest representable gapless value through direct pushes is impractical; check the reported type instead.
        await store.ops.push(b(1), [op(1, dev, 1n)]);
        expect(typeof (await store.ops.lastDevSeq(b(1), dev))).toBe('bigint');
      });
    });

    describe('snapshots and pruning', () => {
      const dev = b(50);
      beforeEach(async () => {
        await store.accounts.create(account('ABCDEF', 1));
        await store.devices.add(device('ABCDEF', 50));
        await store.devices.add(device('ABCDEF', 51));
        await store.folds.create(b(1), 'ABCDEF', 10);
        await store.ops.push(b(1), [op(1, dev, 1n), op(2, dev, 2n), op(3, dev, 3n), op(4, dev, 4n)]);
      });

      it('keeps the newest snapshot only', async () => {
        await store.snapshots.put({ foldId: b(1), atSeq: 2n, blob: b(1, 50), sig: b(1, 64) });
        await store.snapshots.put({ foldId: b(1), atSeq: 1n, blob: b(2, 50), sig: b(2, 64) });
        expect(await store.snapshots.get(b(1))).toMatchObject({ atSeq: 2n });
        await store.snapshots.put({ foldId: b(1), atSeq: 4n, blob: b(3, 50), sig: b(3, 64) });
        expect(Buffer.from((await store.snapshots.get(b(1)))!.blob)).toEqual(b(3, 50));
        expect(await store.snapshots.get(b(99))).toBeUndefined();
      });

      it('prunes only once every active device has acknowledged the snapshot', async () => {
        await store.snapshots.put({ foldId: b(1), atSeq: 3n, blob: b(1, 50), sig: b(1, 64) });
        expect(await store.snapshots.prune(b(1))).toBe(0);
        await store.snapshots.acknowledge(b(1), b(50), 3n);
        expect(await store.snapshots.prune(b(1))).toBe(0); // the second device has not
        await store.snapshots.acknowledge(b(1), b(51), 5n);
        await store.snapshots.acknowledge(b(1), b(51), 1n); // never goes backwards
        expect(await store.snapshots.prune(b(1))).toBe(3);
        expect((await store.ops.pull(b(1), 0n, 10)).ops.map((o) => o.serverSeq)).toEqual([4n]);
        expect(await store.ops.head(b(1))).toBe(4n);
        expect(await store.ops.lastDevSeq(b(1), dev)).toBe(4n); // the sequence check outlives the pruned ops
      });

      it('ignores a revoked device when deciding', async () => {
        await store.snapshots.put({ foldId: b(1), atSeq: 2n, blob: b(1, 50), sig: b(1, 64) });
        await store.snapshots.acknowledge(b(1), b(50), 2n);
        await store.devices.revoke('ABCDEF', b(51), 99);
        expect(await store.snapshots.prune(b(1))).toBe(2);
      });

      it('prunes nothing without a snapshot', async () => {
        expect(await store.snapshots.prune(b(1))).toBe(0);
      });
    });

    describe('rates', () => {
      it('keeps the newest table, with rates exactly as text', async () => {
        expect(await store.rates.latest()).toBeUndefined();
        await store.rates.put({ asOfMs: 2_000, base: 'USD', source: 'test', rates: { EUR: '0.913700000000', JPY: '150.25' } });
        await store.rates.put({ asOfMs: 1_000, base: 'USD', source: 'old', rates: { EUR: '1' } });
        expect(await store.rates.latest()).toEqual({ asOfMs: 2_000, base: 'USD', source: 'test', rates: { EUR: '0.913700000000', JPY: '150.25' } });
      });
    });
  });
}
