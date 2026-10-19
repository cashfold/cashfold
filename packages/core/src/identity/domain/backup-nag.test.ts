import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decideBackupNag, GENTLE_SNOOZE_MS, STRONG_BACKUP_MAX_AGE_MS, STRONG_SNOOZE_MS, type NagInput } from './backup-nag';

const NOW = 1_800_000_000_000;
const base: NagInput = { persisted: true, onService: false, hasData: true, lastBackupAtMs: 0, dismissedAtMs: 0, nowMs: NOW };
const nag = (over: Partial<NagInput> = {}) => decideBackupNag({ ...base, ...over });

describe('the backup reminder (FR-072)', () => {
  it('says nothing when there is nothing to lose', () => {
    expect(nag({ hasData: false })).toBe('none');
    expect(nag({ hasData: false, persisted: false })).toBe('none');
  });

  it('is firm for data that lives only on this device and has never been backed up', () => {
    expect(nag()).toBe('strong');
    expect(nag({ persisted: false })).toBe('strong');
    expect(nag({ persisted: undefined })).toBe('strong');
  });

  it('is settled by a recent backup, and returns when the backup is old', () => {
    expect(nag({ lastBackupAtMs: NOW - 1000 })).toBe('none');
    expect(nag({ lastBackupAtMs: NOW - STRONG_BACKUP_MAX_AGE_MS + 1 })).toBe('none');
    expect(nag({ lastBackupAtMs: NOW - STRONG_BACKUP_MAX_AGE_MS - 1 })).toBe('strong');
  });

  it('can be put off for a week at a time, never for good', () => {
    expect(nag({ dismissedAtMs: NOW - 1000 })).toBe('none');
    expect(nag({ dismissedAtMs: NOW - STRONG_SNOOZE_MS + 1 })).toBe('none');
    expect(nag({ dismissedAtMs: NOW - STRONG_SNOOZE_MS - 1 })).toBe('strong');
  });

  it('is a gentle suggestion, and only when the browser would not keep the data, for someone whose data is also on the service', () => {
    expect(nag({ onService: true })).toBe('none');
    expect(nag({ onService: true, persisted: undefined })).toBe('none');
    expect(nag({ onService: true, persisted: false })).toBe('gentle');
    expect(nag({ onService: true, persisted: false, lastBackupAtMs: NOW - 1000 })).toBe('none');
    expect(nag({ onService: true, persisted: false, dismissedAtMs: NOW - GENTLE_SNOOZE_MS + 1 })).toBe('none');
    expect(nag({ onService: true, persisted: false, dismissedAtMs: NOW - GENTLE_SNOOZE_MS - 1 })).toBe('gentle');
  });

  it('property: a recent backup always silences it; with no data it never speaks; the level is one of three', () => {
    fc.assert(fc.property(
      fc.record({ persisted: fc.option(fc.boolean(), { nil: undefined }), onService: fc.boolean(), hasData: fc.boolean(), lastBackupAtMs: fc.nat(NOW), dismissedAtMs: fc.nat(NOW) }),
      (i) => {
        const level = decideBackupNag({ ...i, nowMs: NOW });
        expect(['none', 'gentle', 'strong']).toContain(level);
        if (!i.hasData) expect(level).toBe('none');
        if (i.lastBackupAtMs > NOW - 24 * 3600 * 1000 && i.lastBackupAtMs > 0) expect(level).toBe('none');
        if (level === 'strong') expect(i.onService).toBe(false);
      },
    ));
  });
});
