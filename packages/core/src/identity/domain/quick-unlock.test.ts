import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type DeviceSettings } from './device-settings';
import { MAX_QUICK_FAILURES, quickUnlockDecision, type QuickUnlockRecord } from './quick-unlock';

// FR-006: quick unlock with device biometrics, but the full password is required again after a browser restart,
// after repeated biometric failure, and after a configurable inactivity period.

const record: QuickUnlockRecord = { credentialId: new Uint8Array([1, 2]), lockedAtMs: 1_000_000, sessionMarker: 'tab-session-1', failures: 0 };
const on: DeviceSettings = { ...DEFAULT_SETTINGS, quickUnlock: { enabled: true, maxIdleMinutes: 30 } };
const decide = (over: Partial<Parameters<typeof quickUnlockDecision>[0]> = {}) =>
  quickUnlockDecision({ settings: on, record, nowMs: 1_000_000 + 60_000, sessionMarker: 'tab-session-1', ...over });

describe('quickUnlockDecision', () => {
  it('allows it shortly after locking in the same browser session', () => {
    expect(decide()).toEqual({ allowed: true });
  });

  it('is unavailable when the user has not turned it on, or nothing was enrolled', () => {
    expect(decide({ settings: DEFAULT_SETTINGS })).toEqual({ allowed: false, reason: 'disabled' });
    expect(decide({ record: undefined })).toEqual({ allowed: false, reason: 'not_enrolled' });
  });

  it('demands the password after a browser restart (the session marker is gone or different)', () => {
    expect(decide({ sessionMarker: undefined })).toEqual({ allowed: false, reason: 'browser_restarted' });
    expect(decide({ sessionMarker: 'another-session' })).toEqual({ allowed: false, reason: 'browser_restarted' });
  });

  it('demands the password after the inactivity period', () => {
    const justInside = 1_000_000 + 30 * 60_000;
    expect(decide({ nowMs: justInside })).toEqual({ allowed: true });
    expect(decide({ nowMs: justInside + 1 })).toEqual({ allowed: false, reason: 'idle_too_long' });
  });

  it('demands the password after repeated failures', () => {
    expect(decide({ record: { ...record, failures: MAX_QUICK_FAILURES - 1 } })).toEqual({ allowed: true });
    expect(decide({ record: { ...record, failures: MAX_QUICK_FAILURES } })).toEqual({ allowed: false, reason: 'too_many_failures' });
  });

  it('follows the configured inactivity period', () => {
    const short: DeviceSettings = { ...on, quickUnlock: { enabled: true, maxIdleMinutes: 1 } };
    expect(decide({ settings: short, nowMs: 1_000_000 + 61_000 })).toEqual({ allowed: false, reason: 'idle_too_long' });
  });

  it('treats a clock that moved backwards as too long ago rather than trusting it', () => {
    expect(decide({ nowMs: 1_000_000 - 5000 })).toEqual({ allowed: false, reason: 'idle_too_long' });
  });

  it('lists the reasons in a fixed order of importance when several apply', () => {
    expect(decide({ settings: DEFAULT_SETTINGS, record: undefined, sessionMarker: undefined })).toEqual({ allowed: false, reason: 'disabled' });
    expect(decide({ sessionMarker: undefined, nowMs: 9e12, record: { ...record, failures: 9 } })).toEqual({ allowed: false, reason: 'browser_restarted' });
  });
});
