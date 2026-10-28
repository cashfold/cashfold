'use client';

import type { ClockNotice, FoldSyncStatus, NeedsAttentionItem } from '@cashfold/core';
import { useCallback, useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';

export type Connection = 'idle' | 'connecting' | 'online' | 'offline' | 'needs_password' | 'removed' | 'not_registered';

export interface SyncView {
  readonly available: boolean;
  readonly connection: Connection;
  readonly overall: 'synced' | 'syncing' | 'offline' | 'error';
  readonly folds: readonly FoldSyncStatus[];
  readonly attention: readonly NeedsAttentionItem[];
  readonly clock: readonly ClockNotice[];
  readonly registration: 'pending' | 'done' | 'local';
  readonly server: string | undefined;
}

const POLL_MS = 15_000;

/** The worker's sync status, kept fresh: on its own events, on a timer, and when the network returns. */
export function useSyncStatus(): { status: SyncView | undefined; refresh: () => Promise<void>; syncNow: () => Promise<void> } {
  const core = useCore();
  const [status, setStatus] = useState<SyncView | undefined>();

  const refresh = useCallback(async () => {
    if (core.phase !== 'unlocked') return;
    try {
      setStatus(await core.call<SyncView>('sync.status'));
    } catch {
      // A locked or restarting worker simply has no status.
    }
  }, [core]);

  useEffect(() => {
    void refresh();
    const off = core.subscribe((e) => {
      if (e.type === 'SyncChanged' || e.type === 'RemoteChanged') void refresh();
    });
    const timer = setInterval(() => void refresh(), POLL_MS);
    const online = () => void core.call('sync.now').then(refresh).catch(() => undefined);
    window.addEventListener('online', online);
    return () => {
      off();
      clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, [core, core.epoch, refresh]);

  const syncNow = useCallback(async () => {
    await core.call('sync.now').catch(() => undefined);
    await refresh();
  }, [core, refresh]);

  return { status, refresh, syncNow };
}
