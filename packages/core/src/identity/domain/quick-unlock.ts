import type { DeviceSettings } from './device-settings';

// When may a device unlock without typing the password? (FR-006, ARCH 5.2)
// Quick unlock stands in for the password only while the situation is the one the user left: same browser session,
// recently locked, and no sign of someone guessing. Everything else falls back to the password.

export const MAX_QUICK_FAILURES = 3;

export interface QuickUnlockRecord {
  readonly credentialId: Uint8Array;
  /** When the app last locked. */
  readonly lockedAtMs: number;
  /** Random token also kept in sessionStorage, which a browser restart clears. */
  readonly sessionMarker: string;
  /** Failed quick unlocks since the last password unlock. */
  readonly failures: number;
}

export type QuickUnlockDenied = 'disabled' | 'not_enrolled' | 'browser_restarted' | 'idle_too_long' | 'too_many_failures';
export type QuickUnlockDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: QuickUnlockDenied };

export function quickUnlockDecision(input: {
  settings: DeviceSettings;
  record: QuickUnlockRecord | undefined;
  nowMs: number;
  /** The marker found in this browser session's storage, if any. */
  sessionMarker: string | undefined;
}): QuickUnlockDecision {
  const { settings, record, nowMs, sessionMarker } = input;
  const deny = (reason: QuickUnlockDenied): QuickUnlockDecision => ({ allowed: false, reason });
  if (!settings.quickUnlock.enabled) return deny('disabled');
  if (record === undefined) return deny('not_enrolled');
  if (sessionMarker === undefined || sessionMarker !== record.sessionMarker) return deny('browser_restarted');
  const idleMs = nowMs - record.lockedAtMs;
  if (idleMs < 0 || idleMs > settings.quickUnlock.maxIdleMinutes * 60_000) return deny('idle_too_long');
  if (record.failures >= MAX_QUICK_FAILURES) return deny('too_many_failures');
  return { allowed: true };
}
