import type { DeviceCredentials, Id } from '@cashfold/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIdbCredentialStore } from './credential-store';

const creds = (over: Partial<DeviceCredentials> = {}): DeviceCredentials => ({
  deviceId: '00000000-0000-4000-8000-000000000001' as Id, accountId: 'XRG88A', email: 'alice@example.com', server: 'https://relay.example.com',
  registration: 'pending', sealed: Uint8Array.from([1, 2, 3, 250, 251]), ...over,
});

describe('IndexedDB credential store', () => {
  const store = createIdbCredentialStore();
  beforeEach(async () => store.clear());

  it('is empty before anything is saved', async () => {
    expect(await store.load()).toBeUndefined();
  });

  it('round-trips the credentials including the sealed bytes', async () => {
    await store.save(creds());
    expect(await store.load()).toEqual(creds());
  });

  it('replaces earlier credentials and can be cleared', async () => {
    await store.save(creds());
    await store.save(creds({ registration: 'done', sealed: Uint8Array.from([9]) }));
    expect(await store.load()).toMatchObject({ registration: 'done', sealed: Uint8Array.from([9]) });
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it('stores the sealed blob as given and nothing that looks like a secret', async () => {
    await store.save(creds());
    const raw = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('cashfold-credentials');
      open.onsuccess = () => {
        const get = open.result.transaction('device').objectStore('device').get('current');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
    });
    expect(Object.keys(raw as object).sort()).toEqual(['accountId', 'deviceId', 'email', 'registration', 'sealed', 'server']);
  });
});
