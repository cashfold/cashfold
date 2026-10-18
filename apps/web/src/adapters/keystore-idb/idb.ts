// One IndexedDB database holds the device's small, non-financial records: the sealed credentials and the lock settings.
const DB_NAME = 'cashfold-credentials';
export const CREDENTIALS = 'device';
export const SETTINGS = 'settings';

export function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [CREDENTIALS, SETTINGS]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function run<T>(factory: IDBFactory, store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
