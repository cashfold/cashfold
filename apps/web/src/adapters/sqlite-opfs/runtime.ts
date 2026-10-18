import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@aztec/sqlite3mc-wasm';

// SQLite3 Multiple Ciphers (WASM) over the OPFS "SyncAccessHandle pool" VFS, used from the Core Worker.
// The pool VFS needs no cross-origin isolation headers. Encryption is added by wrapping the pool VFS in the
// Multiple Ciphers VFS shim, so every page, the rollback journal and temp pages pass through the cipher.

export interface RuntimeOptions {
  /** Name the pool VFS registers under. */
  readonly vfsName: string;
  /** OPFS directory holding the pool files. */
  readonly directory: string;
  /** Pool slots to pre-allocate: the database, its journal, and headroom. */
  readonly initialCapacity?: number;
  /** Delete every pool file on start. For tests only. */
  readonly clearOnInit?: boolean;
}

export interface SqliteRuntime {
  readonly sqlite3: Sqlite3Static;
  readonly pool: SAHPoolUtil;
  /** Name of the encrypting VFS to open databases with. */
  readonly cipherVfs: string;
}

const runtimes = new Map<string, Promise<SqliteRuntime>>();

export const DEFAULT_RUNTIME: RuntimeOptions = { vfsName: 'cashfold', directory: '/cashfold', initialCapacity: 6 };

/** Initialises SQLite once per VFS name in this worker. Fails if OPFS access handles are unavailable. */
export function loadRuntime(options: RuntimeOptions = DEFAULT_RUNTIME): Promise<SqliteRuntime> {
  const existing = runtimes.get(options.vfsName);
  if (existing !== undefined) return existing;
  const created = (async (): Promise<SqliteRuntime> => {
    const sqlite3 = await sqlite3InitModule();
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      name: options.vfsName,
      directory: options.directory,
      initialCapacity: options.initialCapacity ?? 6,
      clearOnInit: options.clearOnInit ?? false,
    });
    const w = sqlite3.wasm;
    const scope = w.scopedAllocPush();
    try {
      const cstr = (w.scopedAllocCString as unknown as (s: string) => number)(options.vfsName);
      const rc = (w.exports as unknown as Record<string, (...a: unknown[]) => number>)['sqlite3mc_vfs_create']!(cstr, 0);
      if (rc !== 0) throw new Error(`could not create the encrypting VFS (sqlite3 result code ${rc})`);
    } finally {
      w.scopedAllocPop(scope);
    }
    return { sqlite3, pool, cipherVfs: `multipleciphers-${options.vfsName}` };
  })();
  runtimes.set(options.vfsName, created);
  created.catch(() => runtimes.delete(options.vfsName));
  return created;
}
