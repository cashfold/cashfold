import type { CredentialStorePort, DeviceCredentials } from '@cashfold/core';
import { CREDENTIALS, run } from './idb';

// Where a device keeps what it needs to be unlocked again. The Secret Key, the cached SRP-x and the device signing key are
// inside `sealed`, encrypted under a key that exists only while the password is being typed (the Local Vault Key). What is
// stored in the clear is routing information: ids, the service address and the email shown on the unlock screen.

const KEY = 'current';

export function createIdbCredentialStore(factory: IDBFactory = indexedDB): CredentialStorePort {
  return {
    async save(credentials) {
      await run(factory, CREDENTIALS, 'readwrite', (s) => s.put({ ...credentials }, KEY));
    },
    async load() {
      const value = (await run(factory, CREDENTIALS, 'readonly', (s) => s.get(KEY))) as DeviceCredentials | undefined;
      return value === undefined ? undefined : { ...value, sealed: Uint8Array.from(value.sealed) };
    },
    async clear() {
      await run(factory, CREDENTIALS, 'readwrite', (s) => s.delete(KEY));
    },
  };
}
