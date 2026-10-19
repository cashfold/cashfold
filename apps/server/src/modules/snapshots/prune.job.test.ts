import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../store/memory-store.js';
import { createPruneJob } from './prune.job.js';

describe('prune job', () => {
  it('prunes after a device is revoked, with no acknowledgement arriving', async () => {
    const store = createMemoryStore();
    const [d1, d2, fold] = [randomBytes(16), randomBytes(16), randomBytes(16)];
    const device = (devId: Buffer) => ({ devId, accountId: 'ABCDEF', sigPk: randomBytes(32), labelCt: null, createdAtMs: 1, revokedAtMs: null });
    await store.accounts.create({
      accountId: 'ABCDEF', emailHmac: randomBytes(32), email: 'a@example.com', authSalt: randomBytes(16), kdf: { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: randomBytes(16) },
      srpVerifier: randomBytes(512), keyset: randomBytes(100), discoverable: true, createdAtMs: 1, emailVerifiedAtMs: null,
    } as never);
    await store.devices.add(device(d1) as never);
    await store.devices.add(device(d2) as never);
    await store.folds.create(fold, 'ABCDEF', 1);
    const row = (seq: bigint) => ({ opId: randomBytes(16), recId: randomBytes(16), devId: d1, devSeq: seq, hlcWall: 1, hlcCtr: 0, epoch: 1, schemaVer: 1, blob: randomBytes(40), sig: randomBytes(64) });
    await store.ops.push(fold, [row(1n), row(2n), row(3n)]);
    await store.snapshots.put({ foldId: fold, atSeq: 2n, epoch: 1, blob: randomBytes(40), sig: randomBytes(64) });
    const job = createPruneJob(store);
    expect(await job.sweep()).toBe(0);
    await store.snapshots.acknowledge(fold, d1, 2n);
    expect(await job.sweep()).toBe(0); // the second device has not confirmed
    await store.devices.revoke('ABCDEF', d2, 5);
    expect(await job.sweep()).toBe(2); // now the remaining device is enough
    expect(await job.sweep()).toBe(0);
  });
});
