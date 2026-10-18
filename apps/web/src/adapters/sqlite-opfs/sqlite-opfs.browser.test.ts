import { describe, expect, it } from 'vitest';
import { storeContract } from '@cashfold/core/testing';
import type { ScenarioName, scenarios } from './test-scenarios';

type Result<K extends ScenarioName> = Awaited<ReturnType<(typeof scenarios)[K]>>;

let counter = 0;
const unique = () => `/sqlite-test-${Date.now().toString(36)}-${counter++}`;

/** Runs a scenario in a fresh dedicated worker and terminates it afterwards (which releases OPFS handles). */
async function run<K extends ScenarioName>(scenario: K, opts: { dir?: string; clear?: boolean; arg?: number } = {}): Promise<Result<K>> {
  const worker = new Worker(new URL('./test.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Result<K>>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent) => (ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error)));
      worker.onerror = (ev) => reject(new Error(ev.message));
      worker.postMessage({ scenario, ctx: { dir: opts.dir ?? unique(), clear: opts.clear ?? true, arg: opts.arg } });
    });
  } finally {
    worker.terminate();
  }
}

describe('64-bit integers (FR-037)', () => {
  it('stores, reads and sums values above 2^53 exactly, always as bigint', async () => {
    const r = await run('bigints');
    expect(r.sum).toBe(r.expectedSum);
    expect(r.sum).toBe(2n ** 62n + 1n + (2n ** 53n + 1n) + 9007199254740993n + (-(2n ** 62n) - 3n) + 5n);
    expect(r.roundTrip).toEqual([2n ** 62n + 1n, 2n ** 53n + 1n, 9007199254740993n, -(2n ** 62n) - 3n, 5n, 0n]);
    expect(r.types.every((t: string) => t === 'bigint/bigint')).toBe(true);
    expect(r.extremes).toEqual([9223372036854775807n, -9223372036854775808n]);
  });

  it('refuses unsafe numbers and floats as parameters, and non-integers in STRICT columns', async () => {
    const r = await run('bindRules');
    expect(r.unsafe).toContain('RangeError');
    expect(r.float).toContain('RangeError');
    expect(r.nan).toContain('RangeError');
    expect(r.safe).toBe('no error');
    expect(r.strictText).toMatch(/SQLite3Error/);
    expect(r.stored).toEqual([[42n, 'integer']]);
  });

  it('raises instead of wrapping when a SUM overflows', async () => {
    const r = await run('sumOverflow');
    expect(r.sum).toMatch(/integer overflow/i);
  });
});

describe('encryption at rest (FR-016)', () => {
  it('leaves no plaintext or SQLite header in the database or its rollback journal, mid-transaction included', async () => {
    const r = await run('encryptedAtRest');
    expect(r.names).toEqual(expect.arrayContaining(['/test.db', '/test.db-journal']));
    expect(r.leaks).toEqual([]);
    expect(r.hasMagic).toBe(false);
    expect(r.hasMarker).toBe(false);
    expect(r.size).toBeGreaterThan(8192);
  });

  it('opens only with the right key and keeps the data across close and reopen', async () => {
    const r = await run('encryptedAtRest');
    expect(r.wrongKey).toMatch(/^DatabaseKeyError/);
    expect(r.count).toBe(200n);
  });

  it('detects modified, and relocated, pages', async () => {
    const r = await run('tamper');
    expect(r['control']).toBe('opened: count=400 rows=400');
    expect(r['oneBitFlip']).toMatch(/^(rejected|opened)/);
    expect(r['oneBitFlip']).not.toBe('opened: count=400 rows=400'); // a flipped bit must never read back as healthy data
    expect(r['restored']).toBe('opened: count=400 rows=400'); // undoing the flip restores the original, so the check is meaningful
    expect(r['pageCopiedOverAnother']).not.toBe('opened: count=400 rows=400');
  });
});

describe('schema migrations', () => {
  it('applies the ARCH 8.2 schema in order, idempotently, and refuses a newer database', async () => {
    const r = await run('migrations');
    expect(r.first).toBe(3);
    expect(r.again).toBe(3);
    expect(r.version).toBe(3);
    expect(r.tables).toEqual(expect.arrayContaining(['fold', 'op_log', 'sync_quarantine', 'record_meta', 'field_clock', 'set_add', 'set_removed', 'account', 'txn', 'transfer', 'category', 'payee', 'tag', 'budget', 'goal', 'schedule', 'fx_rate', 'import_batch', 'checkpoint', 'purged_record', 'ledger_entry', 'account_balance']));
    expect(r.tooNew).toMatch(/^MigrationError/);
  });

  it('rolls a failing migration back completely', async () => {
    const r = await run('migrations');
    expect(r.failure).toMatch(/SQLite3Error/);
    expect(r.afterFailure).toEqual({ version: 1, hasA: ['a'] }); // version 1 applied; version 2 left no trace (no table b)
  });
});

describe('transactions and constraints', () => {
  it('commits, rolls back on error (also across awaits) and nests with savepoints', async () => {
    const r = await run('transactions');
    expect(r.rolledBack).toBe('Error: boom');
    expect(r.asyncAtomic).toBe('Error: late');
    expect(r.rows).toEqual([[1n, 'committed'], [3n, 'outer'], [5n, 'inner-kept']]);
  });

  it('enforces foreign keys, cascades a Fold wipe, and applies the privacy pragmas', async () => {
    const r = await run('foreignKeys');
    expect(r.orphan).toMatch(/FOREIGN KEY/i);
    expect(r.before).toBe(1n);
    expect(r.after).toBe(0n);
    expect(r.fk).toBe(1n);
    expect(r.secureDelete).toBe(1n);
    expect(r.temp).toBe(2n); // MEMORY
  });
});

describe('the ledger over the encrypted database (user story 2)', () => {
  it('records, reads, deletes, restores and purges exactly, and leaves nothing readable on disk', async () => {
    const r = await run('ledger');
    expect(r['seeded']).toEqual({ categories: 49, base: 'USD', accounts: 0 });
    expect(r['needsRate']).toMatchObject({ code: 'rate_required', currency: 'EUR' });
    expect(r['eurBase']).toBe(-1_000n);
    expect(r['balances']).toEqual([['Zebra Savings', r['expectedMain']], ['Euro wallet', -900n]]);
    expect(r['search']).toEqual({ count: 1, tags: 2, amount: -450n });
    expect(r['dashboard']).toMatchObject({ expense: 1_450n, income: 2n ** 58n + 1n });
    expect(r['recentlyDeleted']).toEqual([30]);
    expect(r['purged']).toBe(1);
    expect(r['afterPurge']).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(r['countAfterPurge']).toBe(2);
    expect(r['unlockedAgain']).toBe(true);
    expect(r['reopenedBalances']).toEqual([['Zebra Savings', 100_000n + 2n ** 58n + 1n], ['Euro wallet', -900n]]);
    expect(r['leaks']).toEqual([]);
  });
});

describe('persistence and cleanup', () => {
  it('survives a worker restart', async () => {
    const dir = unique();
    await run('seedPersistence', { dir, clear: true });
    const r = await run('readPersistence', { dir, clear: false });
    expect(r.v).toBe(2n ** 60n + 7n);
  });

  it('destroy removes the database and its journal from OPFS', async () => {
    const r = await run('destroy');
    expect(r.before).toContain('/test.db');
    expect(r.after).not.toContain('/test.db');
  });
});

describe('50,000 transactions (SC-008 working set)', () => {
  it('stays well inside the budgets and uses the indexes', async () => {
    const r = await run('benchmark');
    expect(r.count).toBe(50_000n);
    expect(r.balanceMs).toBeLessThan(500);
    expect(r.monthMs).toBeLessThan(500);
    expect(r.listMs).toBeLessThan(100);
    expect(r.commitMs).toBeLessThan(100);
    expect(r.insertMs).toBeLessThan(30_000);
    expect(r.plan.join(' ')).toMatch(/txn_acct_date/);
    expect(r.plan.join(' ')).not.toMatch(/SCAN txn/);
  });
});

describe('SQLite stores satisfy the same contract as the in-memory stores', () => {
  storeContract.forEach((c, index) => {
    it(c.name, async () => {
      expect(await run('contractCase', { arg: index })).toEqual(c.expected);
    });
  });
});
