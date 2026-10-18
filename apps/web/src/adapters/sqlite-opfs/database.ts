import type { SecretBuf } from '@cashfold/crypto';
import type { Database as OoDatabase, PreparedStatement } from '@sqlite.org/sqlite-wasm';
import type { SqliteRuntime } from './runtime.js';

/** Values read from SQLite. Every INTEGER is a bigint: money and 64-bit ids must never pass through a double. */
export type SqlValue = bigint | string | Uint8Array | null | number;
/** Values accepted as parameters. Numbers must be safe integers; floating point is rejected. */
export type Bind = bigint | number | string | Uint8Array | null;

export class DatabaseKeyError extends Error {
  constructor() {
    super('The database could not be opened with this key');
    this.name = 'DatabaseKeyError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

/** ChaCha20-Poly1305 with per-page authentication (SQLite3 Multiple Ciphers default scheme). See ADR-0002. */
const CIPHER = 'chacha20';
const SQLITE_INTEGER = 1;

function toBind(value: Bind): bigint | string | Uint8Array | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('only safe integers may be bound as numbers; pass bigint for 64-bit values');
    return BigInt(value);
  }
  return value;
}

/**
 * An encrypted SQLite database in OPFS. Runs synchronously inside the Core Worker.
 * Transactions nest (the outermost is BEGIN IMMEDIATE, inner ones are savepoints).
 */
export class EncryptedDatabase {
  private depth = 0;

  private constructor(
    private readonly runtime: SqliteRuntime,
    private readonly db: OoDatabase,
    readonly file: string,
  ) {}

  /**
   * Opens (or creates) the database and unlocks it with the 32-byte database key.
   * A wrong key surfaces as `DatabaseKeyError` on first read; a new file accepts any key.
   */
  static open(runtime: SqliteRuntime, file: string, key: SecretBuf): EncryptedDatabase {
    if (key.length !== 32) throw new RangeError('the database key must be 32 bytes');
    const { sqlite3 } = runtime;
    const db = new sqlite3.oo1.DB({ filename: file, flags: 'c', vfs: runtime.cipherVfs });
    try {
      db.exec(`PRAGMA cipher='${CIPHER}'`);
      EncryptedDatabase.applyKey(runtime, db, key);
      try {
        db.selectValue('SELECT count(*) FROM sqlite_master');
      } catch (e) {
        throw /NOTADB|not a database/i.test(String(e)) ? new DatabaseKeyError() : e;
      }
      db.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA temp_store=MEMORY; PRAGMA journal_mode=DELETE');
    } catch (e) {
      db.close();
      throw e;
    }
    return new EncryptedDatabase(runtime, db, file);
  }

  /** Hands the key to SQLite3 Multiple Ciphers through the WASM heap and zeroes that copy straight away. */
  private static applyKey(runtime: SqliteRuntime, db: OoDatabase, key: SecretBuf): void {
    const w = runtime.sqlite3.wasm;
    const exports = w.exports as unknown as Record<string, (...a: unknown[]) => number>;
    const ptr = w.alloc(key.length);
    try {
      key.use((bytes) => w.heap8u().set(bytes, ptr));
      const rc = exports['sqlite3_key_v2']!(db.pointer, 0, ptr, key.length);
      if (rc !== 0) throw new DatabaseError(`setting the database key failed (sqlite3 result code ${rc})`);
    } finally {
      w.heap8u().fill(0, ptr, ptr + key.length);
      w.dealloc(ptr);
    }
  }

  /** Runs one or more statements without parameters. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Runs a single statement with parameters; returns the number of rows changed. */
  run(sql: string, bind: readonly Bind[] = []): number {
    this.db.exec({ sql, bind: bind.map(toBind) as never });
    return this.db.changes();
  }

  /** Reads all rows. INTEGER columns are bigint; REAL stays number; TEXT string; BLOB Uint8Array. */
  rows(sql: string, bind: readonly Bind[] = []): SqlValue[][] {
    const stmt = this.db.prepare(sql);
    try {
      if (bind.length > 0) stmt.bind(bind.map(toBind) as never);
      const out: SqlValue[][] = [];
      const capi = this.runtime.sqlite3.capi;
      while (stmt.step()) {
        const row: SqlValue[] = [];
        for (let i = 0; i < stmt.columnCount; i++) {
          row.push(capi.sqlite3_column_type(stmt.pointer!, i) === SQLITE_INTEGER ? BigInt(capi.sqlite3_column_int64(stmt.pointer!, i)) : (stmt.get(i) as SqlValue));
        }
        out.push(row);
      }
      return out;
    } finally {
      (stmt as PreparedStatement).finalize();
    }
  }

  /** The first column of the first row, or undefined when there are no rows. */
  value(sql: string, bind: readonly Bind[] = []): SqlValue | undefined {
    return this.rows(sql, bind)[0]?.[0];
  }

  /**
   * Runs `fn` atomically. Errors roll back. Nested calls become savepoints, so a failed inner step
   * can be undone without abandoning the outer transaction.
   */
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const nested = this.depth > 0;
    const savepoint = `sp${this.depth}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = await fn();
      this.depth--;
      this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (e) {
      this.depth--;
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      throw e;
    }
  }

  get userVersion(): number {
    return Number(this.value('PRAGMA user_version'));
  }

  close(): void {
    if (this.db.isOpen()) this.db.close();
  }

  /** Closes and permanently deletes the database file and its journal. */
  destroy(): void {
    this.close();
    for (const name of [this.file, `${this.file}-journal`]) {
      if (this.runtime.pool.getFileNames().includes(name)) this.runtime.pool.unlink(name);
    }
  }
}
