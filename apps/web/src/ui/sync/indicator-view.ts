import type { SyncView } from './useSyncStatus';

export interface IndicatorView {
  /** The message key for the one line in the header. */
  readonly textKey: string;
  readonly tone: 'success' | 'warning' | 'neutral';
  /** The value of `data-sync-state`, for tests and styling. */
  readonly state: string;
  /** Whether to add the "needs attention" suffix. */
  readonly attention: boolean;
}

/**
 * What the header's sync line says. An account kept only on this device (spec 010) is not offline, not in error and not waiting: it has
 * chosen not to sync, so it reads "Local only" in a neutral tone whatever the sync engine reports, and never asks for attention.
 */
export function indicatorView(status: SyncView): IndicatorView {
  if (status.registration === 'local') return { textKey: 'sync.state.local_only', tone: 'neutral', state: 'local', attention: false };
  const attention = status.attention.length + status.clock.length > 0;
  let textKey: string;
  if (status.connection === 'not_registered') textKey = 'sync.state.not_registered';
  else if (status.connection === 'needs_password') textKey = 'sync.state.needs_password';
  else if (status.connection === 'removed') textKey = 'sync.state.removed';
  else if (status.overall === 'syncing' || status.connection === 'connecting') textKey = 'sync.state.syncing';
  else if (status.overall === 'offline' || status.connection === 'offline') textKey = 'sync.state.offline';
  else if (status.overall === 'error') textKey = 'sync.state.error';
  else textKey = 'sync.state.synced';
  const tone = attention || status.overall === 'error' ? 'warning' : status.overall === 'offline' || status.connection === 'offline' ? 'neutral' : 'success';
  return { textKey, tone, state: status.connection === 'online' ? status.overall : status.connection, attention };
}
