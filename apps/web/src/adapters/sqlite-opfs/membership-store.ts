import { idToBytes, type MembershipEntry, type MembershipStore } from '@cashfold/core';
import { decodeEntry, encodeEntry, type PlainLogEntry } from '@cashfold/crypto';
import type { EncryptedDatabase } from './database';

/** The local copy of each Fold's membership log: the signed entries, in order, as the crypto package encodes them. */
export function createSqliteMembershipStore(db: EncryptedDatabase): MembershipStore {
  return {
    async list(fold) {
      return db.rows('SELECT entry FROM fold_log WHERE fold_id = ? ORDER BY idx', [idToBytes(fold)]).map((r) => decodeEntry(r[0] as Uint8Array) as MembershipEntry);
    },
    async append(fold, entry) {
      db.run('INSERT INTO fold_log(fold_id, idx, entry) VALUES (?,?,?)', [idToBytes(fold), BigInt(entry.idx), encodeEntry(entry as PlainLogEntry)]);
    },
    async clear(fold) {
      db.run('DELETE FROM fold_log WHERE fold_id = ?', [idToBytes(fold)]);
    },
  };
}
