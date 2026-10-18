import type { CredentialStorePort, DeviceCredentials } from '@cashfold/core';

// Where a device keeps what it needs to be unlocked again. The Secret Key, the cached SRP-x and the device signing key are
// inside `sealed`, encrypted under a key that exists only while the password is being typed (the Local Vault Key). What is
// stored in the clear is routing information: ids, the service address and the email shown on the unlock screen.

const DB_NAME = 'cashfold-credentials';
const STORE = 'device';
const KEY = 'current';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(factory: IDBFactory, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function createIdbCredentialStore(factory: IDBFactory = indexedDB): CredentialStorePort {
  return {
    async save(credentials) {
      await run(factory, 'readwrite', (s) => s.put({ ...credentials }, KEY));
    },
    async load() {
      const value = (await run(factory, 'readonly', (s) => s.get(KEY))) as DeviceCredentials | undefined;
      return value === undefined ? undefined : { ...value, sealed: Uint8Array.from(value.sealed) };
    },
    async clear() {
      await run(factory, 'readwrite', (s) => s.delete(KEY));
    },
  };
}
