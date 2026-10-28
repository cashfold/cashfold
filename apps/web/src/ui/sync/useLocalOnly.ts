'use client';

import { useSyncStatus } from './useSyncStatus';

/** Whether this account is kept only on this device (spec 010): `undefined` until the status is known. */
export function useLocalOnly(): boolean | undefined {
  const { status } = useSyncStatus();
  return status === undefined ? undefined : status.registration === 'local';
}
