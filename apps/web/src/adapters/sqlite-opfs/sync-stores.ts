import { idToBytes, type Id, type SyncCursorPort } from '@cashfold/core';
import type { EncryptedDatabase } from './database';

/** Where this device has got to in each Fold's relay log (`fold.pull_cursor`), and whether a snapshot supplied the history below it. */
export function createSqliteCursors(db: EncryptedDatabase): SyncCursorPort {
  return {
    async get(fold) {
      const row = db.rows('SELECT pull_cursor, snapshot_base FROM fold WHERE fold_id = ?', [idToBytes(fold)])[0];
      return row === undefined ? { serverSeq: 0n, fromSnapshot: false } : { serverSeq: row[0] as bigint, fromSnapshot: row[1] === 1n };
    },
    async set(fold, state) {
      db.run('UPDATE fold SET pull_cursor = ?, snapshot_base = ? WHERE fold_id = ?', [state.serverSeq, state.fromSnapshot ? 1n : 0n, idToBytes(fold)]);
    },
  };
}

export interface DeviceKeyRow {
  readonly id: Id;
  readonly sigPk: Uint8Array;
  readonly revoked: boolean;
}

/** The signing keys of the account's devices. A removed device's key is kept: what it wrote before removal is still genuine. */
export interface DeviceKeyStore {
  /** Replaces what is stored with the service's current list. */
  replaceAll(rows: readonly DeviceKeyRow[], nowMs: number): void;
  publicKey(dev: Id): Uint8Array | undefined;
}

export function createSqliteDeviceKeys(db: EncryptedDatabase): DeviceKeyStore {
  return {
    replaceAll(rows, nowMs) {
      for (const r of rows) {
        db.run(
          `INSERT INTO device(dev_id, sig_pk, revoked, created_at) VALUES (?,?,?,?)
           ON CONFLICT(dev_id) DO UPDATE SET revoked = excluded.revoked`,
          [idToBytes(r.id), r.sigPk, r.revoked ? 1n : 0n, BigInt(nowMs)],
        );
      }
    },
    publicKey(dev) {
      const v = db.value('SELECT sig_pk FROM device WHERE dev_id = ?', [idToBytes(dev)]);
      return v instanceof Uint8Array ? v : undefined;
    },
  };
}

/** Records when each Fold last finished a clean sync, for the status screen. */
export function createSqliteSyncMarks(db: EncryptedDatabase) {
  return {
    lastSyncedAt(fold: Id): number | undefined {
      const v = db.value('SELECT last_synced_at FROM fold WHERE fold_id = ?', [idToBytes(fold)]);
      return typeof v === 'bigint' ? Number(v) : undefined;
    },
    markSynced(fold: Id, atMs: number): void {
      db.run('UPDATE fold SET last_synced_at = ? WHERE fold_id = ?', [BigInt(atMs), idToBytes(fold)]);
    },
  };
}
