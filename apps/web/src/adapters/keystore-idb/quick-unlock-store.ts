import type { QuickUnlockStorePort, StoredQuickUnlock } from '@cashfold/core';
import { QUICK, run } from './idb';

const KEY = 'current';

/** The quick-unlock enrolment: a credential id, a PRF salt and a wrapped key blob. Useless without the authenticator. */
export function createIdbQuickUnlockStore(factory: IDBFactory = indexedDB): QuickUnlockStorePort {
  const copy = (r: StoredQuickUnlock): StoredQuickUnlock => ({ ...r, credentialId: Uint8Array.from(r.credentialId), prfSalt: Uint8Array.from(r.prfSalt), blob: Uint8Array.from(r.blob) });
  return {
    async load() {
      const value = (await run(factory, QUICK, 'readonly', (s) => s.get(KEY))) as StoredQuickUnlock | undefined;
      return value === undefined ? undefined : copy(value);
    },
    async save(record) {
      await run(factory, QUICK, 'readwrite', (s) => s.put(copy(record), KEY));
    },
    async clear() {
      await run(factory, QUICK, 'readwrite', (s) => s.delete(KEY));
    },
  };
}
