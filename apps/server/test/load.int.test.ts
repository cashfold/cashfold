import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../src/store/memory-store.js';
import { createPgStore } from '../src/store/pg-store.js';
import type { OpRow, Store } from '../src/store/store.js';

// Load test of the relay's store: push and pull throughput, and what happens when many devices push into one Fold or into many
// (R-13, T194). It decides how `server_seq` is assigned; the outcome is recorded in docs/adr/0007-fold-sequence.md.
// Opt in with LOAD=1 (it takes minutes and starts PostgreSQL): `LOAD=1 pnpm --filter @cashfold/server test:integration -t load`.

const enabled = process.env['LOAD'] === '1';
const BLOB = 320; // a typical sealed operation
const BATCH = 256; // the largest push a client makes

let container: StartedPostgreSqlContainer | undefined;
beforeAll(async () => {
  if (enabled) container = await new PostgreSqlContainer('postgres:17-alpine').start();
}, 180_000);
afterAll(async () => {
  await container?.stop();
});

const hex = (n: number) => n.toString(16).padStart(8, '0');
const ops = (dev: Buffer, from: number, count: number): OpRow[] =>
  Array.from({ length: count }, (_, i) => ({
    opId: randomBytes(16), recId: randomBytes(16), devId: dev, devSeq: BigInt(from + i + 1), hlcWall: 1_800_000_000_000 + from + i, hlcCtr: 0, epoch: 1, schemaVer: 1, blob: randomBytes(BLOB), sig: randomBytes(64),
  }));

async function makeFold(store: Store, owner: string, n: number): Promise<Buffer> {
  const id = Buffer.alloc(16);
  id.writeUInt32BE(n, 12);
  await store.folds.create(id, owner, 1);
  return id;
}

async function account(store: Store, n: number): Promise<string> {
  const id = `L${hex(n).slice(-5).toUpperCase().replace(/[01OI]/g, '2')}`;
  await store.accounts.create({ accountId: id, emailHmac: randomBytes(32), email: `l${n}@example.com`, authSalt: randomBytes(16), kdf: { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: randomBytes(16) }, srpVerifier: randomBytes(512), keyset: randomBytes(300), discoverable: false, createdAtMs: 1 });
  return id;
}

const percentile = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)]!;
const fmt = (n: number): string => n.toFixed(0);

async function run(label: string, make: () => Promise<Store>): Promise<void> {
  const store = await make();
  const report: string[] = [`\n== ${label} ==`];

  // 1. One device, one Fold, sequential batches.
  {
    const owner = await account(store, 1);
    const fold = await makeFold(store, owner, 1);
    const dev = randomBytes(16);
    const total = 20_000;
    const started = performance.now();
    for (let at = 0; at < total; at += BATCH) {
      const out = await store.ops.push(fold, ops(dev, at, Math.min(BATCH, total - at)));
      expect(out.every((o) => o.status === 'stored')).toBe(true);
    }
    const secs = (performance.now() - started) / 1000;
    report.push(`push, 1 device, 1 Fold: ${fmt(total / secs)} ops/s (${total} ops in batches of ${BATCH}, ${fmt((total / secs) * BLOB / 1024)} KiB/s of ciphertext)`);

    const pullStart = performance.now();
    let after = 0n;
    let pulled = 0;
    for (;;) {
      const page = await store.ops.pull(fold, after, 500);
      pulled += page.ops.length;
      if (!page.more) break;
      after = page.ops.at(-1)!.serverSeq;
    }
    const pullSecs = (performance.now() - pullStart) / 1000;
    expect(pulled).toBe(total);
    report.push(`pull, pages of 500: ${fmt(total / pullSecs)} ops/s`);
  }

  // 2. Many devices into ONE Fold at once: the case a per-Fold counter serialises.
  for (const writers of [4, 16]) {
    const owner = await account(store, 100 + writers);
    const fold = await makeFold(store, owner, 100 + writers);
    const perWriter = 2_000;
    const latencies: number[] = [];
    const started = performance.now();
    await Promise.all(
      Array.from({ length: writers }, async () => {
        const dev = randomBytes(16);
        for (let at = 0; at < perWriter; at += BATCH) {
          const t0 = performance.now();
          const out = await store.ops.push(fold, ops(dev, at, Math.min(BATCH, perWriter - at)));
          latencies.push(performance.now() - t0);
          expect(out.every((o) => o.status === 'stored')).toBe(true);
        }
      }),
    );
    const secs = (performance.now() - started) / 1000;
    const total = writers * perWriter;
    expect(await store.ops.head(fold)).toBe(BigInt(total)); // gapless, nothing lost
    report.push(`push, ${writers} devices into 1 Fold: ${fmt(total / secs)} ops/s, batch latency p50 ${fmt(percentile(latencies, 0.5))} ms / p95 ${fmt(percentile(latencies, 0.95))} ms`);
  }

  // 3. The same writers, each into their own Fold: what the counter costs when nothing contends.
  for (const writers of [16]) {
    const perWriter = 2_000;
    const latencies: number[] = [];
    const folds: Buffer[] = [];
    for (let i = 0; i < writers; i++) folds.push(await makeFold(store, await account(store, 1000 + i), 1000 + i));
    const started = performance.now();
    await Promise.all(
      folds.map(async (fold) => {
        const dev = randomBytes(16);
        for (let at = 0; at < perWriter; at += BATCH) {
          const t0 = performance.now();
          await store.ops.push(fold, ops(dev, at, Math.min(BATCH, perWriter - at)));
          latencies.push(performance.now() - t0);
        }
      }),
    );
    const secs = (performance.now() - started) / 1000;
    report.push(`push, ${writers} devices into ${writers} Folds: ${fmt((writers * perWriter) / secs)} ops/s, batch latency p50 ${fmt(percentile(latencies, 0.5))} ms / p95 ${fmt(percentile(latencies, 0.95))} ms`);
  }

  await store.close();
  process.stdout.write(`${report.join("\n")}\n`);
}

describe.skipIf(!enabled)('load', () => {
  it('memory store', async () => run('memory store', async () => createMemoryStore()), 600_000);

  it('postgresql', async () => {
    let n = 0;
    await run('PostgreSQL 17 (Testcontainers, default settings)', async () => {
      const schema = `load${Date.now().toString(36)}_${n++}`;
      const pg = await import('pg');
      const admin = new pg.default.Client({ connectionString: container!.getConnectionUri() });
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.end();
      const url = new URL(container!.getConnectionUri());
      url.searchParams.set('options', `-c search_path=${schema}`);
      return createPgStore(url.toString());
    });
  }, 900_000);
});
