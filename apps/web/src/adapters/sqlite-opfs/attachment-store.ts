import { idFromBytes, idToBytes, type AttachmentStorePort, type Id } from '@cashfold/core';
import type { EncryptedDatabase } from './database';

/** This device's copy of the sealed pieces of attachments. Ciphertext only: the database is encrypted again around it. */
export interface SqliteAttachmentStore extends AttachmentStorePort {
  /** Drops every piece of a Fold (it was deleted, or this account left it). */
  clearFold(fold: Id): void;
}

export function createSqliteAttachmentStore(db: EncryptedDatabase): SqliteAttachmentStore {
  return {
    async put(fold, attachment, index, bytes, sent) {
      db.run('INSERT OR REPLACE INTO attachment_chunk(fold_id, att_id, idx, data, sent) VALUES (?,?,?,?,?)', [idToBytes(fold), idToBytes(attachment), BigInt(index), bytes, sent ? 1n : 0n]);
    },
    async get(fold, attachment, index) {
      const v = db.value('SELECT data FROM attachment_chunk WHERE fold_id = ? AND att_id = ? AND idx = ?', [idToBytes(fold), idToBytes(attachment), BigInt(index)]);
      return v instanceof Uint8Array ? v : undefined;
    },
    async pending() {
      return db.rows('SELECT fold_id, att_id, idx FROM attachment_chunk WHERE sent = 0 ORDER BY rowid').map((r) => ({
        fold: idFromBytes(r[0] as Uint8Array), attachment: idFromBytes(r[1] as Uint8Array), index: Number(r[2] as bigint),
      }));
    },
    async markSent(fold, attachment, index) {
      db.run('UPDATE attachment_chunk SET sent = 1 WHERE fold_id = ? AND att_id = ? AND idx = ?', [idToBytes(fold), idToBytes(attachment), BigInt(index)]);
    },
    async discard(fold, attachment) {
      db.run('DELETE FROM attachment_chunk WHERE fold_id = ? AND att_id = ?', [idToBytes(fold), idToBytes(attachment)]);
    },
    clearFold(fold) {
      db.run('DELETE FROM attachment_chunk WHERE fold_id = ?', [idToBytes(fold)]);
    },
  };
}
