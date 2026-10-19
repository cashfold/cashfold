import type { SecretBuf } from '@cashfold/crypto';
import { DatabaseKeyError, EncryptedDatabase, type Bind, type SqlValue } from './database';
import type { SqliteRuntime } from './runtime';

// A database that cannot be read (FR-072, FR-016, edge cases: disk full, interrupted writes, a damaged file). The person's password and keys are
// right by the time this runs, so a file that will not open, or that fails SQLite's own check, is damaged. What happens then:
//   1. the damaged file is left exactly as it is and a new database is made beside it under the next generation name (`/cashfold.g2.db`, ...);
//   2. a fresh database is made, and everything that is a source of truth is copied out of the old one as far as it can be read: the
//      operation log, the Fold keys, the membership logs, the device keys and the sealed attachment pieces;
//   3. everything derived from those (accounts, transactions, balances, ...) is rebuilt from the operation log, which is why it is not copied;
//   4. the sync position of each Fold goes back to the start, so a signed-in device fetches again what it can no longer vouch for.
// Nothing is dropped without a trace: the report says what was copied, what could not be read, and where the old file is.

export interface PoolLike {
  getFileNames(): string[];
  unlink(name: string): boolean | void;
  getCapacity?(): number;
  addCapacity?(n: number): Promise<number>;
}

const GENERATION = /^(.*?)(?:\.g(\d+))?\.db$/;

/** The file name of a database generation: `/cashfold.db`, `/cashfold.g2.db`, `/cashfold.g3.db`, ... */
export const generationFile = (base: string, generation: number): string => (generation <= 1 ? base : base.replace(/\.db$/, `.g${generation}.db`));

function generationsOf(pool: PoolLike, base: string): Array<{ name: string; generation: number }> {
  const stem = GENERATION.exec(base)?.[1] ?? base;
  const out: Array<{ name: string; generation: number }> = [];
  for (const name of pool.getFileNames()) {
    const m = GENERATION.exec(name);
    if (m !== null && m[1] === stem) out.push({ name, generation: m[2] === undefined ? 1 : Number(m[2]) });
  }
  return out.sort((x, y) => x.generation - y.generation);
}

/** The database file to open: the newest generation there is, or the first one on a device that has none yet. */
export function currentDatabaseFile(pool: PoolLike, base: string): string {
  return generationsOf(pool, base).at(-1)?.name ?? base;
}

/** Removes every generation of the database and its journals: a device that is wiped must leave nothing readable behind. */
export function removeAllGenerations(pool: PoolLike, base: string): void {
  for (const g of generationsOf(pool, base)) for (const n of [g.name, `${g.name}-journal`]) if (pool.getFileNames().includes(n)) pool.unlink(n);
}

export interface RecoveryReport {
  readonly reason: 'unreadable' | 'damaged';
  /** The damaged file, left as it was, beside the new database. */
  readonly damagedFile: string;
  /** The new database. */
  readonly newFile: string;
  /** Rows copied from each source table. */
  readonly copied: Readonly<Record<string, number>>;
  /** Tables that could not be read to the end. Whatever came before the damage was kept. */
  readonly incomplete: readonly string[];
  readonly atMs: number;
}

/** The tables that hold the truth. The rest of the schema is derived from them and is rebuilt. */
export const SOURCE_TABLES = ['fold', 'fold_key', 'fold_log', 'device', 'op_log', 'sync_quarantine', 'purged_record', 'attachment_chunk'] as const;

/** Whether SQLite finds the file sound. Reading every page also checks each page's authentication tag. */
export function isDamaged(db: EncryptedDatabase): boolean {
  try {
    const result = db.rows('PRAGMA quick_check(1)');
    return !(result.length === 1 && result[0]?.[0] === 'ok');
  } catch {
    return true;
  }
}

/** Makes room for another database and its journal, and drops every damaged copy but the newest one. */
async function prepare(pool: PoolLike, base: string, damaged: string): Promise<string> {
  const generations = generationsOf(pool, base);
  const next = generationFile(base, (generations.at(-1)?.generation ?? 1) + 1);
  if (pool.addCapacity !== undefined && pool.getCapacity !== undefined && pool.getFileNames().length + 3 > pool.getCapacity()) await pool.addCapacity(3);
  // Keep the newest damaged file and no more, so repeated trouble cannot fill the disk with copies.
  for (const g of generations) if (g.name !== damaged) for (const n of [g.name, `${g.name}-journal`]) if (pool.getFileNames().includes(n)) pool.unlink(n);
  return next;
}

function salvage(from: EncryptedDatabase, into: EncryptedDatabase): { copied: Record<string, number>; incomplete: string[] } {
  const copied: Record<string, number> = {};
  const incomplete: string[] = [];
  into.exec('PRAGMA foreign_keys=OFF');
  try {
    for (const table of SOURCE_TABLES) {
      const columns = into.rows(`PRAGMA table_info(${table})`).map((r) => r[1] as string);
      if (columns.length === 0) continue;
      const insert = `INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
      let n = 0;
      try {
        from.forEachRow(`SELECT ${columns.join(',')} FROM ${table}`, [], (row) => {
          into.run(insert, row as readonly Bind[]);
          n++;
        });
      } catch {
        incomplete.push(table);
      }
      copied[table] = n;
    }
    // What this device had fetched from the service can no longer be vouched for: fetch it again (duplicates are ignored).
    into.run('UPDATE fold SET pull_cursor = 0, last_synced_at = NULL');
  } finally {
    into.exec('PRAGMA foreign_keys=ON');
  }
  return { copied, incomplete };
}

/**
 * Opens the database, or, when it is damaged, leaves it as it is and builds a new one beside it from what can be read. `migrate` brings a fresh
 * database to the current schema. The caller rebuilds the projections of every Fold when a report comes back, and uses `db.file` from then on.
 */
export async function openOrRecover(
  runtime: SqliteRuntime, base: string, key: SecretBuf, nowMs: number, migrate: (db: EncryptedDatabase) => Promise<unknown>,
): Promise<{ db: EncryptedDatabase; report?: RecoveryReport }> {
  const pool = runtime.pool as unknown as PoolLike;
  const file = currentDatabaseFile(pool, base);
  let reason: RecoveryReport['reason'] | undefined;
  let db: EncryptedDatabase | undefined;
  try {
    db = EncryptedDatabase.open(runtime, file, key);
    if (isDamaged(db)) reason = 'damaged';
    else await migrate(db);
  } catch (e) {
    // The key is right (the password opened the credentials), so a file that does not open as a database is damaged.
    if (!(e instanceof DatabaseKeyError) && !/malformed|corrupt|not a database|NOTADB|CORRUPT|i\/o|disk image/i.test(String(e))) throw e;
    reason = 'unreadable';
  }
  if (reason === undefined) return { db: db! };
  db?.close();

  const newFile = await prepare(pool, base, file);
  const fresh = EncryptedDatabase.open(runtime, newFile, key);
  await migrate(fresh);
  let copied: Record<string, number> = {};
  let incomplete: string[] = [...SOURCE_TABLES];
  try {
    const old = EncryptedDatabase.open(runtime, file, key);
    try {
      ({ copied, incomplete } = salvage(old, fresh));
    } finally {
      old.close();
    }
  } catch {
    // The old file cannot be read at all: the new database starts empty.
  }
  return { db: fresh, report: { reason, damagedFile: file, newFile, copied, incomplete, atMs: nowMs } };
}

export type { SqlValue };
