// Scenarios that run inside a dedicated worker (OPFS access handles only exist there) and return plain data
// for the browser test to assert on. Test support only: never imported by application code.
import { idToBytes, type Id } from '@cashfold/core';
import { storeContract } from '@cashfold/core/testing';
import { SecretBuf } from '@cashfold/crypto';
import { EncryptedDatabase } from './database.js';
import { migrate, MigrationError } from './migrate.js';
import type { Migration } from './migrations/generated.js';
import { loadRuntime, type SqliteRuntime } from './runtime.js';
import { createSqliteOpLog, createSqliteProjections } from './sqlite-stores.js';

const key = (fill: number) => SecretBuf.from(new Uint8Array(32).fill(fill));
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

export interface ScenarioContext {
  readonly dir: string;
  readonly clear: boolean;
  /** Scenario-specific argument (the contract case index). */
  readonly arg?: number;
}

async function runtimeFor(ctx: ScenarioContext): Promise<SqliteRuntime> {
  return loadRuntime({ vfsName: `t${ctx.dir.replaceAll('/', '_')}`, directory: ctx.dir, initialCapacity: 8, clearOnInit: ctx.clear });
}

/** Opens `/test.db`, runs the callback, always closes. */
async function withDb<T>(ctx: ScenarioContext, fill: number, fn: (db: EncryptedDatabase, rt: SqliteRuntime) => Promise<T> | T): Promise<T> {
  const rt = await runtimeFor(ctx);
  const db = EncryptedDatabase.open(rt, '/test.db', key(fill));
  try {
    return await fn(db, rt);
  } finally {
    db.close();
  }
}

async function throws(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return 'no error';
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message.split('\n')[0]}`;
  }
}

async function rawEdit(rt: SqliteRuntime, dir: string, file: string, edit: (sah: FileSystemSyncAccessHandle) => void): Promise<void> {
  // The pool stores each logical file in an opaque slot: 4096-byte header (path first), payload after it.
  await rt.pool.pauseVfs();
  try {
    const root = await navigator.storage.getDirectory();
    let d = root;
    for (const part of dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part);
    d = await d.getDirectoryHandle('.opaque');
    for await (const [, handle] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const sah = await (handle as FileSystemFileHandle).createSyncAccessHandle();
      try {
        const head = new Uint8Array(512);
        sah.read(head, { at: 0 });
        const path = new TextDecoder().decode(head.slice(0, Math.max(0, head.indexOf(0))));
        if (path === file) edit(sah);
      } finally {
        sah.flush();
        sah.close();
      }
    }
  } finally {
    await rt.pool.unpauseVfs();
  }
}

export const scenarios = {
  /** Runs one case of the shared OpLogStore/ProjectionStore contract against the SQLite stores. */
  async contractCase(ctx: ScenarioContext) {
    const c = storeContract[ctx.arg ?? -1];
    if (c === undefined) throw new RangeError('no such contract case');
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const stores = {
        oplog: createSqliteOpLog(db),
        projections: createSqliteProjections(db),
        async prepareFold(fold: Id) {
          db.run('INSERT OR IGNORE INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, ?, 1, 1, ?, 0)', [idToBytes(fold), 'Test Fold', 'USD']);
        },
      };
      return c.run(stores);
    });
  },

  async bigints(ctx: ScenarioContext) {
    return withDb(ctx, 1, (db) => {
      db.exec('CREATE TABLE m(id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL) STRICT');
      const values = [2n ** 62n + 1n, 2n ** 53n + 1n, 9007199254740993n, -(2n ** 62n) - 3n, 5n, 0n];
      values.forEach((v, i) => db.run('INSERT INTO m VALUES (?, ?)', [i + 1, v]));
      const sum = db.value('SELECT SUM(amount_minor) FROM m');
      const rows = db.rows('SELECT id, amount_minor FROM m ORDER BY id');
      db.run('INSERT INTO m VALUES (?, ?)', [100, 9223372036854775807n]);
      db.run('INSERT INTO m VALUES (?, ?)', [101, -9223372036854775808n]);
      return {
        sum,
        expectedSum: values.reduce((a, b) => a + b, 0n),
        types: rows.map((r) => `${typeof r[0]}/${typeof r[1]}`),
        roundTrip: rows.map((r) => r[1]),
        extremes: db.rows('SELECT amount_minor FROM m WHERE id >= 100 ORDER BY id').map((r) => r[0]),
      };
    });
  },

  async bindRules(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE m(v INTEGER) STRICT');
      return {
        unsafe: await throws(() => db.run('INSERT INTO m VALUES (?)', [2 ** 53])),
        float: await throws(() => db.run('INSERT INTO m VALUES (?)', [1.5])),
        nan: await throws(() => db.run('INSERT INTO m VALUES (?)', [Number.NaN])),
        safe: await throws(() => db.run('INSERT INTO m VALUES (?)', [42])),
        strictText: await throws(() => db.run("INSERT INTO m VALUES ('abc')")),
        stored: db.rows('SELECT v, typeof(v) FROM m'),
      };
    });
  },

  async sumOverflow(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE m(v INTEGER) STRICT');
      db.run('INSERT INTO m VALUES (?)', [9223372036854775807n]);
      db.run('INSERT INTO m VALUES (?)', [1n]);
      return { sum: await throws(() => db.value('SELECT SUM(v) FROM m')) };
    });
  },

  async encryptedAtRest(ctx: ScenarioContext) {
    const marker = 'SECRET-MARKER-groceries-4711';
    const rt = await runtimeFor(ctx);
    const db = EncryptedDatabase.open(rt, '/test.db', key(1));
    db.exec('CREATE TABLE n(id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT');
    for (let i = 0; i < 200; i++) db.run('INSERT INTO n VALUES (?, ?)', [i, `${marker}-${i}`]);
    await db.transaction(() => db.run("UPDATE n SET note = 'JOURNAL-MARKER-in-flight' WHERE id = 1"));
    // Look at every file in the pool while a write transaction is open: database and rollback journal.
    db.exec('BEGIN');
    db.run("UPDATE n SET note = 'JOURNAL-MARKER-mid-transaction' WHERE id = 2");
    const names = rt.pool.getFileNames();
    const leaks: string[] = [];
    for (const name of names) {
      const bytes = await rt.pool.exportFile(name);
      const text = latin1(bytes);
      if (text.includes('SECRET-MARKER') || text.includes('JOURNAL-MARKER') || text.startsWith('SQLite format 3')) leaks.push(name);
    }
    db.exec('COMMIT');
    db.close();
    const onDisk = await rt.pool.exportFile('/test.db');
    const wrongKey = await throws(() => EncryptedDatabase.open(rt, '/test.db', key(2)));
    const reopened = EncryptedDatabase.open(rt, '/test.db', key(1));
    const count = reopened.value('SELECT count(*) FROM n');
    reopened.close();
    return { names, leaks, hasMagic: latin1(onDisk.slice(0, 16)).startsWith('SQLite format 3'), hasMarker: latin1(onDisk).includes(marker), size: onDisk.length, wrongKey, count };
  },

  async tamper(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const seed = () => {
      const db = EncryptedDatabase.open(rt, '/test.db', key(1));
      db.exec('CREATE TABLE n(id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT');
      for (let i = 0; i < 400; i++) db.run('INSERT INTO n VALUES (?, ?)', [i, `row ${i} ${'x'.repeat(40)}`]);
      db.close();
    };
    const check = async () => {
      try {
        const db = EncryptedDatabase.open(rt, '/test.db', key(1));
        try {
          const n = db.value('SELECT count(*) FROM n');
          const all = db.rows('SELECT * FROM n');
          return `opened: count=${n} rows=${all.length}`;
        } finally {
          db.close();
        }
      } catch (e) {
        return `rejected: ${(e as Error).name}`;
      }
    };
    const out: Record<string, string> = {};
    seed();
    out['control'] = await check();
    const page = 4096;
    await rawEdit(rt, ctx.dir, '/test.db', (sah) => {
      const b = new Uint8Array(1);
      sah.read(b, { at: 4096 + page * 2 + 100 });
      b[0] = b[0]! ^ 1;
      sah.write(b, { at: 4096 + page * 2 + 100 });
    });
    out['oneBitFlip'] = await check();
    await rawEdit(rt, ctx.dir, '/test.db', (sah) => {
      const b = new Uint8Array(1);
      sah.read(b, { at: 4096 + page * 2 + 100 });
      b[0] = b[0]! ^ 1;
      sah.write(b, { at: 4096 + page * 2 + 100 });
    });
    out['restored'] = await check();
    await rawEdit(rt, ctx.dir, '/test.db', (sah) => {
      const copy = new Uint8Array(page);
      sah.read(copy, { at: 4096 + page * 3 });
      sah.write(copy, { at: 4096 + page * 2 });
    });
    out['pageCopiedOverAnother'] = await check();
    return out;
  },

  async migrations(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      const first = await migrate(db);
      const tables = db.rows("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").map((r) => r[0] as string);
      const again = await migrate(db);
      const version = db.userVersion;

      const bad: Migration[] = [
        { version: 1, name: 'ok', sql: 'CREATE TABLE a(x INTEGER) STRICT' },
        { version: 2, name: 'broken', sql: 'CREATE TABLE b(x INTEGER) STRICT; CREATE TABLE a(x INTEGER) STRICT' },
      ];
      const scratch = EncryptedDatabase.open(await runtimeFor(ctx), '/scratch.db', key(1));
      const failure = await throws(() => migrate(scratch, bad));
      const afterFailure = { version: scratch.userVersion, hasA: scratch.rows("SELECT name FROM sqlite_master WHERE name IN ('a','b') ORDER BY name").map((r) => r[0]) };
      scratch.close();

      db.exec('PRAGMA user_version = 999');
      const tooNew = await throws(() => migrate(db));
      return { first, again, version, tables, failure, afterFailure, tooNew, isMigrationError: tooNew.startsWith(MigrationError.name) };
    });
  },

  async transactions(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT) STRICT');
      await db.transaction(() => db.run("INSERT INTO t VALUES (1, 'committed')"));
      const rolledBack = await throws(() => db.transaction(() => { db.run("INSERT INTO t VALUES (2, 'lost')"); throw new Error('boom'); }));
      await db.transaction(async () => {
        db.run("INSERT INTO t VALUES (3, 'outer')");
        const inner = await throws(() => db.transaction(() => { db.run("INSERT INTO t VALUES (4, 'inner-lost')"); throw new Error('inner'); }));
        await db.transaction(() => db.run("INSERT INTO t VALUES (5, 'inner-kept')"));
        if (inner === 'no error') throw new Error('inner should have failed');
      });
      const asyncAtomic = await throws(() => db.transaction(async () => {
        db.run("INSERT INTO t VALUES (6, 'async-lost')");
        await Promise.resolve();
        throw new Error('late');
      }));
      return { rolledBack, asyncAtomic, rows: db.rows('SELECT id, v FROM t ORDER BY id') };
    });
  },

  async foreignKeys(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const fold = new Uint8Array(16).fill(9);
      const orphan = await throws(() => db.run('INSERT INTO category(fold_id, id, direction, name) VALUES (?, ?, 1, ?)', [fold, new Uint8Array(16).fill(1), 'Food']));
      db.run('INSERT INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, ?, 1, 1, ?, 0)', [fold, 'Personal', 'USD']);
      db.run('INSERT INTO category(fold_id, id, direction, name) VALUES (?, ?, 1, ?)', [fold, new Uint8Array(16).fill(1), 'Food']);
      const before = db.value('SELECT count(*) FROM category');
      db.run('DELETE FROM fold WHERE fold_id = ?', [fold]);
      return { orphan, before, after: db.value('SELECT count(*) FROM category'), fk: db.value('PRAGMA foreign_keys'), secureDelete: db.value('PRAGMA secure_delete'), temp: db.value('PRAGMA temp_store') };
    });
  },

  async seedPersistence(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE p(v INTEGER) STRICT');
      db.run('INSERT INTO p VALUES (?)', [2n ** 60n + 7n]);
      return true;
    });
  },

  async readPersistence(ctx: ScenarioContext) {
    return withDb(ctx, 1, (db) => ({ v: db.value('SELECT v FROM p') }));
  },

  async destroy(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const db = EncryptedDatabase.open(rt, '/test.db', key(1));
    db.exec('CREATE TABLE d(v INTEGER) STRICT');
    const before = rt.pool.getFileNames();
    db.destroy();
    return { before, after: rt.pool.getFileNames() };
  },

  /** 50,000 transactions: the SC-008 working set. Thresholds are generous; they catch gross regressions only. */
  async benchmark(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const fold = new Uint8Array(16).fill(1);
      const account = new Uint8Array(16).fill(2);
      db.run('INSERT INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, ?, 1, 1, ?, 0)', [fold, 'Personal', 'USD']);
      db.run('INSERT INTO account(fold_id, id, kind, name, currency, exponent, opening_date) VALUES (?, ?, 1, ?, ?, 2, 20260101)', [fold, account, 'Checking', 'USD']);
      const t0 = performance.now();
      await db.transaction(() => {
        for (let i = 0; i < 50_000; i++) {
          const id = new Uint8Array(16);
          new DataView(id.buffer).setUint32(0, i);
          db.run(
            'INSERT INTO txn(fold_id, id, account_id, direction, amount_minor, currency, base_amount_minor, base_currency, occurred_utc_ms, tz_offset_min, local_date, note) VALUES (?,?,?,1,?,?,?,?,?,0,?,?)',
            [fold, id, account, BigInt(-100 - (i % 5000)), 'USD', BigInt(-100 - (i % 5000)), 'USD', 1_760_000_000_000 + i, 20260101 + (i % 300), `note ${i}`],
          );
        }
      });
      const insertMs = performance.now() - t0;
      const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
      const balanceMs = time(() => db.value('SELECT balance_minor FROM account_balance WHERE account_id = ?', [account]));
      const monthMs = time(() => db.rows('SELECT category_id, SUM(amount_minor) FROM txn WHERE fold_id = ? AND local_date BETWEEN 20260101 AND 20260131 AND deleted = 0 GROUP BY category_id', [fold]));
      const listMs = time(() => db.rows('SELECT id, amount_minor FROM txn WHERE fold_id = ? AND account_id = ? AND deleted = 0 ORDER BY local_date DESC, id DESC LIMIT 50', [fold, account]));
      const t1 = performance.now();
      for (let k = 0; k < 20; k++) await db.transaction(() => db.run('UPDATE txn SET note = ? WHERE fold_id = ? AND id = ?', [`edited ${k}`, fold, new Uint8Array(16)]));
      const commitMs = (performance.now() - t1) / 20;
      const plan = db.rows('EXPLAIN QUERY PLAN SELECT id FROM txn WHERE fold_id = ? AND account_id = ? AND deleted = 0 ORDER BY local_date DESC, id DESC LIMIT 50', [fold, account]).map((r) => String(r[3]));
      return { insertMs, balanceMs, monthMs, listMs, commitMs, plan, count: db.value('SELECT count(*) FROM txn') };
    });
  },
} satisfies Record<string, (ctx: ScenarioContext) => unknown>;

export type ScenarioName = keyof typeof scenarios;
