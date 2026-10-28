import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, resetAccountTied, toLockPolicy, type DeviceSettings } from './device-settings';

describe('device settings (FR-006, FR-007)', () => {
  it('start with the documented defaults: 5 minutes idle, 1 minute hidden, quick unlock off', () => {
    expect(DEFAULT_SETTINGS).toEqual({ autoLockMinutes: 5, hiddenGraceSeconds: 60, quickUnlock: { enabled: false, maxIdleMinutes: 30 }, kitReminderDismissed: false, lastBackupAtMs: 0, backupNagDismissedAtMs: 0 });
  });

  it('turn into the lock controller policy in milliseconds', () => {
    expect(toLockPolicy(DEFAULT_SETTINGS)).toEqual({ idleMs: 5 * 60_000, hiddenGraceMs: 60_000 });
    expect(toLockPolicy({ ...DEFAULT_SETTINGS, autoLockMinutes: 1, hiddenGraceSeconds: 0 })).toEqual({ idleMs: 60_000, hiddenGraceMs: 0 });
  });

  describe('parseSettings accepts whatever was stored and always returns something safe', () => {
    it('keeps valid values', () => {
      const s: DeviceSettings = { autoLockMinutes: 15, hiddenGraceSeconds: 30, quickUnlock: { enabled: true, maxIdleMinutes: 10 }, kitReminderDismissed: true, lastBackupAtMs: 1_800_000_000_000, backupNagDismissedAtMs: 1_800_000_100_000 };
      expect(parseSettings(s)).toEqual(s);
    });

    it('falls back to defaults for missing, wrong-typed or garbage input', () => {
      for (const bad of [undefined, null, 'x', 5, [], {}, { autoLockMinutes: 'soon' }, { quickUnlock: 'yes' }]) expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
    });

    it('keeps the backup times as whole non-negative times, and ignores anything else', () => {
      expect(parseSettings({ lastBackupAtMs: -5, backupNagDismissedAtMs: 'yesterday' })).toMatchObject({ lastBackupAtMs: 0, backupNagDismissedAtMs: 0 });
      expect(parseSettings({ lastBackupAtMs: 1.9e12 + 0.5 }).lastBackupAtMs).toBe(1.9e12);
      expect(parseSettings({ lastBackupAtMs: Number.NaN }).lastBackupAtMs).toBe(0);
    });

    it('clamps out-of-range numbers so a bad value can never disable locking', () => {
      expect(parseSettings({ autoLockMinutes: 0 }).autoLockMinutes).toBe(1);
      expect(parseSettings({ autoLockMinutes: -5 }).autoLockMinutes).toBe(1);
      expect(parseSettings({ autoLockMinutes: 100000 }).autoLockMinutes).toBe(60);
      expect(parseSettings({ autoLockMinutes: 7.9 }).autoLockMinutes).toBe(7);
      expect(parseSettings({ hiddenGraceSeconds: -1 }).hiddenGraceSeconds).toBe(0);
      expect(parseSettings({ hiddenGraceSeconds: 99999 }).hiddenGraceSeconds).toBe(600);
      expect(parseSettings({ quickUnlock: { enabled: true, maxIdleMinutes: 0 } }).quickUnlock.maxIdleMinutes).toBe(1);
      expect(parseSettings({ autoLockMinutes: Number.NaN }).autoLockMinutes).toBe(5);
      expect(parseSettings({ autoLockMinutes: Number.POSITIVE_INFINITY }).autoLockMinutes).toBe(5);
    });

    it('property: the lock policy is always finite and within the allowed bounds', () => {
      fc.assert(fc.property(fc.anything(), (input) => {
        const policy = toLockPolicy(parseSettings(input));
        expect(policy.idleMs).toBeGreaterThanOrEqual(60_000);
        expect(policy.idleMs).toBeLessThanOrEqual(60 * 60_000);
        expect(policy.hiddenGraceMs).toBeGreaterThanOrEqual(0);
        expect(policy.hiddenGraceMs).toBeLessThanOrEqual(600_000);
      }));
    });

    it('ignores unknown fields instead of carrying them along', () => {
      expect(Object.keys(parseSettings({ autoLockMinutes: 5, evil: 'x' })).sort()).toEqual(['autoLockMinutes', 'backupNagDismissedAtMs', 'hiddenGraceSeconds', 'kitReminderDismissed', 'lastBackupAtMs', 'quickUnlock']);
    });
  });
});

describe('what stays when an account is signed out (spec 011)', () => {
  const mine: DeviceSettings = {
    autoLockMinutes: 15, hiddenGraceSeconds: 120, quickUnlock: { enabled: true, maxIdleMinutes: 90 },
    kitReminderDismissed: true, lastBackupAtMs: 1_700_000_000_000, backupNagDismissedAtMs: 1_700_000_100_000,
  };

  it('forgets what belongs to the account: quick unlock being on, the kit reminder, and the backup history', () => {
    const r = resetAccountTied(mine);
    expect(r.quickUnlock.enabled).toBe(false);
    expect(r.kitReminderDismissed).toBe(false);
    expect(r.lastBackupAtMs).toBe(0);
    expect(r.backupNagDismissedAtMs).toBe(0);
  });

  it('keeps what belongs to the device: the lock policy', () => {
    const r = resetAccountTied(mine);
    expect(r.autoLockMinutes).toBe(15);
    expect(r.hiddenGraceSeconds).toBe(120);
    expect(r.quickUnlock.maxIdleMinutes).toBe(90);
  });

  it('is the defaults for everything it resets, and does not change its input', () => {
    const before = JSON.stringify(mine);
    const r = resetAccountTied(mine);
    expect(r).toEqual({ ...DEFAULT_SETTINGS, autoLockMinutes: 15, hiddenGraceSeconds: 120, quickUnlock: { enabled: false, maxIdleMinutes: 90 } });
    expect(JSON.stringify(mine)).toBe(before);
  });
});

