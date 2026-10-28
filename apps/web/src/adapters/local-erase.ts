import { resetAccountTied, type CredentialStorePort, type DeviceSettingsPort, type LocalEraserPort, type QuickUnlockStorePort } from '@cashfold/core';
import type { SqliteRuntime } from './sqlite-opfs/runtime';

/**
 * Erases what this device holds for the account (spec 011): every database file in the pool, which also holds the attachment pieces, the sealed
 * credentials, the quick-unlock record, and what in the lock settings belongs to the account. The lock policy is the device's and stays.
 *
 * It needs no key and no open session: the pool belongs to Cashfold alone, and wiping it also truncates the slot files, so no stale ciphertext is
 * left behind. The caller has already closed the open database, which holds the slots. Safe to repeat.
 */
export function createLocalEraser(deps: {
  readonly runtime: () => Promise<SqliteRuntime>;
  readonly credentials: CredentialStorePort;
  readonly quickStore: QuickUnlockStorePort;
  readonly settings: DeviceSettingsPort;
}): LocalEraserPort {
  return {
    async eraseAll() {
      const runtime = await deps.runtime();
      await runtime.pool.wipeFiles();
      await deps.credentials.clear();
      await deps.quickStore.clear();
      await deps.settings.save(resetAccountTied(await deps.settings.load()));
    },
  };
}
