import { idFromBytes, idToBytes, type FoldDirectory, type FoldKeyPort, type FoldSummary, type Id, type Role } from '@cashfold/core';
import { createAesGcm, createHkdf, SecretBuf, type Rng } from '@cashfold/crypto';
import { encode } from '@cashfold/protocol/cbor';
import type { EncryptedDatabase } from './database';

const ROLE_CODE: Readonly<Record<Role, bigint>> = { owner: 1n, editor: 2n, viewer: 3n };
const ROLE_NAME: ReadonlyMap<bigint, Role> = new Map([[1n, 'owner'], [2n, 'editor'], [3n, 'viewer']]);

/** The Folds on this device, stored in the `fold` table. Removing a Fold cascades to every row that belongs to it. */
export function createSqliteFoldDirectory(db: EncryptedDatabase, nowMs: () => number = Date.now): FoldDirectory {
  const read = (r: (bigint | string | Uint8Array | null | number)[]): FoldSummary => ({
    id: idFromBytes(r[0] as Uint8Array), name: r[1] as string, baseCurrency: r[2] as string, epoch: Number(r[3]), role: ROLE_NAME.get(r[4] as bigint) ?? 'viewer',
  });
  const COLUMNS = 'fold_id, name, base_currency, epoch, role';
  return {
    async list() {
      return db.rows(`SELECT ${COLUMNS} FROM fold ORDER BY created_at, name`).map(read);
    },
    async get(fold) {
      const row = db.rows(`SELECT ${COLUMNS} FROM fold WHERE fold_id = ?`, [idToBytes(fold)])[0];
      return row === undefined ? undefined : read(row);
    },
    async add(f) {
      db.run(
        `INSERT INTO fold(fold_id, name, base_currency, epoch, role, created_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(fold_id) DO UPDATE SET name = excluded.name, base_currency = excluded.base_currency, epoch = excluded.epoch, role = excluded.role`,
        [idToBytes(f.id), f.name, f.baseCurrency, BigInt(f.epoch), ROLE_CODE[f.role], BigInt(nowMs())],
      );
    },
    async rename(fold, name) {
      db.run('UPDATE fold SET name = ? WHERE fold_id = ?', [name, idToBytes(fold)]);
    },
    async remove(fold) {
      db.run('DELETE FROM fold WHERE fold_id = ?', [idToBytes(fold)]);
    },
  };
}

export interface FoldKeyring extends FoldKeyPort {
  /** The epoch new ops are encrypted under, or undefined if this device holds no key for the Fold. */
  currentEpoch(fold: Id): Promise<number | undefined>;
  /** The Fold key for an epoch (unwrapped on first use and kept until `wipe`). */
  key(fold: Id, epoch: number): Promise<SecretBuf | undefined>;
  /** Wipes every unwrapped key. */
  wipe(): void;
}

const WRAP_LABEL = 'cashfold.foldkey.v1';

/**
 * Fold keys, stored in the `fold_key` table wrapped with AES-256-GCM under a key derived from the database key, so a
 * Fold key never sits in a database page in the clear (ARCH 8.2). Unwrapped keys live in memory until the session locks.
 */
export function createFoldKeyring(db: EncryptedDatabase, { databaseKey, rng }: { databaseKey: SecretBuf; rng: Rng }): FoldKeyring {
  const aead = createAesGcm();
  const hkdf = createHkdf();
  const cache = new Map<string, SecretBuf>();
  let wrapKey: Promise<SecretBuf> | undefined;
  const wrapper = () => (wrapKey ??= hkdf.derive(databaseKey, new Uint8Array(0), new TextEncoder().encode('cashfold.foldkey.wrap.v1'), 32));
  const aadFor = (fold: Id, epoch: number) => encode([WRAP_LABEL, idToBytes(fold), epoch]);

  return {
    async createFoldKey(fold) {
      const epoch = 1;
      const fk = SecretBuf.take(Uint8Array.from(rng.bytes(32)));
      const nonce = Uint8Array.from(rng.bytes(12));
      const sealed = await aead.seal(await wrapper(), nonce, fk.use((b) => b), aadFor(fold, epoch));
      db.run('INSERT INTO fold_key(fold_id, epoch, fk_wrapped) VALUES (?,?,?)', [idToBytes(fold), BigInt(epoch), Uint8Array.from([...nonce, ...sealed])]);
      cache.set(`${fold}:${epoch}`, fk);
      return epoch;
    },

    async dropFoldKeys(fold) {
      db.run('DELETE FROM fold_key WHERE fold_id = ?', [idToBytes(fold)]);
      for (const [k, v] of [...cache]) {
        if (k.startsWith(`${fold}:`)) {
          v.wipe();
          cache.delete(k);
        }
      }
    },

    async currentEpoch(fold) {
      const v = db.value('SELECT MAX(epoch) FROM fold_key WHERE fold_id = ?', [idToBytes(fold)]);
      return v === null || v === undefined ? undefined : Number(v);
    },

    async key(fold, epoch) {
      const cached = cache.get(`${fold}:${epoch}`);
      if (cached !== undefined) return cached;
      const wrapped = db.value('SELECT fk_wrapped FROM fold_key WHERE fold_id = ? AND epoch = ?', [idToBytes(fold), BigInt(epoch)]) as Uint8Array | null | undefined;
      if (wrapped === null || wrapped === undefined) return undefined;
      const fk = SecretBuf.take(await aead.open(await wrapper(), wrapped.slice(0, 12), wrapped.slice(12), aadFor(fold, epoch)));
      cache.set(`${fold}:${epoch}`, fk);
      return fk;
    },

    wipe() {
      cache.forEach((k) => k.wipe());
      cache.clear();
      void wrapper().then((w) => w.wipe());
      wrapKey = undefined;
    },
  };
}
