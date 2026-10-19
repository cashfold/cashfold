import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import { createSyncStatus, syncAttention } from './status';
import type { SyncReport } from './sync-client';

const report = (over: Partial<SyncReport> = {}): SyncReport => ({ pushed: 0, pulled: 0, applied: 0, duplicates: 0, quarantined: 0, ignored: 0, head: 0n, rejectedOps: [], ...over });
const A = id(1);
const B = id(2);

describe('sync status', () => {
  it('moves through syncing to synced and remembers when', () => {
    const s = createSyncStatus();
    s.begin(A);
    expect(s.folds()[0]).toMatchObject({ state: 'syncing', lastSyncedAtMs: undefined });
    s.finish(A, report(), 5_000, 0);
    expect(s.folds()[0]).toEqual({ fold: A, state: 'synced', lastSyncedAtMs: 5_000, pendingOps: 0, failure: undefined });
  });

  it('shows offline for a network failure and error for anything else, keeping the last good time', () => {
    const s = createSyncStatus();
    s.finish(A, report(), 1_000, 0);
    s.begin(A);
    s.finish(A, report({ failure: 'offline' }), 2_000, 3);
    expect(s.folds()[0]).toMatchObject({ state: 'offline', lastSyncedAtMs: 1_000, pendingOps: 3, failure: 'offline' });
    s.finish(A, report({ failure: 'gap' }), 3_000, 3);
    expect(s.folds()[0]).toMatchObject({ state: 'error', lastSyncedAtMs: 1_000 });
  });

  it('reports the worst state across Folds', () => {
    const s = createSyncStatus();
    expect(s.overall()).toBe('synced');
    s.finish(A, report(), 1, 0);
    s.finish(B, report({ failure: 'offline' }), 1, 1);
    expect(s.overall()).toBe('offline');
    s.begin(A);
    expect(s.overall()).toBe('syncing');
    s.finish(A, report({ failure: 'rejected' }), 2, 1);
    expect(s.overall()).toBe('error');
  });

  it('tells listeners about every change and stops after unsubscribe', () => {
    const s = createSyncStatus();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.begin(A);
    s.finish(A, report(), 1, 0);
    off();
    s.begin(A);
    expect(n).toBe(2);
  });

  it('lists refused changes and a relay gap as things to look at, without content', () => {
    const items = syncAttention(report({ failure: 'gap', rejectedOps: [{ op: id(9), reason: 'too_large' }] }));
    expect(items).toEqual([
      { kind: 'rejected_change', ref: id(9), messageKey: 'attention.rejected.too_large' },
      { kind: 'relay_gap', messageKey: 'attention.relay_gap' },
    ]);
    expect(syncAttention(report())).toEqual([]);
  });
});
