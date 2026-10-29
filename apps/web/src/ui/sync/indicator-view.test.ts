import { describe, expect, it } from 'vitest';
import { indicatorView } from './indicator-view';
import type { SyncView } from './useSyncStatus';

const base: SyncView = { available: true, connection: 'online', overall: 'synced', folds: [], attention: [], clock: [], registration: 'done', server: 'https://relay.example.com' };
const view = (over: Partial<SyncView>) => indicatorView({ ...base, ...over });

describe('the header sync indicator for an account kept only on this device (FR-006)', () => {
  it.each([
    ['not registered', { connection: 'not_registered', overall: 'synced' }],
    ['idle', { connection: 'idle', overall: 'synced' }],
    ['offline', { connection: 'offline', overall: 'offline' }],
    ['in error', { connection: 'online', overall: 'error' }],
    ['with something needing attention', { attention: [{ kind: 'x' } as never], overall: 'error' }],
  ] as const)('says "Local only", in a neutral tone and with no attention, however the engine reads: %s', (_name, over) => {
    expect(view({ registration: 'local', server: '', ...over })).toEqual({ textKey: 'sync.state.local_only', tone: 'neutral', state: 'local', attention: false });
  });

  it('does not say "Local only" for an account that is only waiting to register', () => {
    expect(view({ registration: 'pending', connection: 'not_registered' })).toMatchObject({ textKey: 'sync.state.not_registered', state: 'not_registered' });
  });
});

describe('the header sync indicator for an account with a service (unchanged)', () => {
  it('reads as it always did', () => {
    expect(view({})).toEqual({ textKey: 'sync.state.synced', tone: 'success', state: 'synced', attention: false });
    expect(view({ overall: 'syncing' })).toMatchObject({ textKey: 'sync.state.syncing', tone: 'success' });
    expect(view({ connection: 'offline', overall: 'offline' })).toMatchObject({ textKey: 'sync.state.offline', tone: 'neutral', state: 'offline' });
    expect(view({ overall: 'error' })).toMatchObject({ textKey: 'sync.state.error', tone: 'warning' });
    expect(view({ connection: 'needs_password' })).toMatchObject({ textKey: 'sync.state.needs_password', state: 'needs_password' });
    expect(view({ connection: 'removed' })).toMatchObject({ textKey: 'sync.state.removed', state: 'removed' });
    expect(view({ attention: [{ kind: 'x' } as never] })).toMatchObject({ tone: 'warning', attention: true });
  });
});
