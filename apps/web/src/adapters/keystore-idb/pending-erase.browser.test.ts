import type { DeviceCredentials, Id } from '@cashfold/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIdbCredentialStore } from './credential-store';
import { createIdbPendingErase } from './pending-erase';

describe('IndexedDB pending-erase marker (spec 011)', () => {
  const marker = createIdbPendingErase();
  const credentials = createIdbCredentialStore();
  beforeEach(async () => {
    await marker.clear();
    await credentials.clear();
  });

  it('is not set at first, is set after set, and is not set after clear', async () => {
    expect(await marker.isSet()).toBe(false);
    await marker.set();
    expect(await marker.isSet()).toBe(true);
    await marker.clear();
    expect(await marker.isSet()).toBe(false);
  });

  it('can be set twice and cleared when it was never set', async () => {
    await marker.set();
    await marker.set();
    expect(await marker.isSet()).toBe(true);
    await marker.clear();
    await marker.clear();
    expect(await marker.isSet()).toBe(false);
  });

  it('lives beside the credentials without touching them: clearing one leaves the other', async () => {
    const creds: DeviceCredentials = { deviceId: '00000000-0000-4000-8000-000000000001' as Id, accountId: 'XRG88A', email: 'alice@example.com', server: '', registration: 'local', sealed: Uint8Array.from([1, 2]) };
    await credentials.save(creds);
    await marker.set();
    await credentials.clear();
    expect(await marker.isSet()).toBe(true);
    await credentials.save(creds);
    await marker.clear();
    expect(await credentials.load()).toEqual(creds);
  });

  it('holds nothing about the account', async () => {
    await marker.set();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('cashfold-credentials', 3);
      open.onsuccess = () => {
        const get = open.result.transaction('device').objectStore('device').get('pending-erase');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
      open.onerror = () => reject(open.error);
    });
    expect(Object.keys(raw as object)).toEqual(['startedAtMs']);
  });
});
