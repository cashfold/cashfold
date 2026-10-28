import type { PendingEraseMarkerPort } from '@cashfold/core';
import { CREDENTIALS, run } from './idb';

// A note that a sign-out has started and not finished (spec 011). It sits in the credentials store under its own key, so the store needs no new
// version, and clearing the credentials never touches it. It holds a time and nothing about the account.

const KEY = 'pending-erase';

export function createIdbPendingErase(factory: IDBFactory = indexedDB): PendingEraseMarkerPort {
  return {
    async set() {
      await run(factory, CREDENTIALS, 'readwrite', (s) => s.put({ startedAtMs: Date.now() }, KEY));
    },
    async isSet() {
      return (await run(factory, CREDENTIALS, 'readonly', (s) => s.get(KEY))) !== undefined;
    },
    async clear() {
      await run(factory, CREDENTIALS, 'readwrite', (s) => s.delete(KEY));
    },
  };
}
