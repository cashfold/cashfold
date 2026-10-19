// When to remind a person to make an encrypted backup (ARCHITECTURE 8.1a, FR-072). Browsers may clear a site's storage when space is
// short. A signed-in person can always rebuild from the service, so for them it is a gentle suggestion and only when the browser has
// refused to keep the data. Someone whose data is only on this device has nothing else: the reminder is firm, comes back, and cannot
// be put off for good.

export type NagLevel = 'none' | 'gentle' | 'strong';

export interface NagInput {
  /** Whether the browser agreed to keep this site's storage, or undefined if it cannot say. */
  readonly persisted: boolean | undefined;
  /** The account is registered with a service, so everything is also held there. */
  readonly onService: boolean;
  /** There is something worth losing. */
  readonly hasData: boolean;
  readonly lastBackupAtMs: number;
  readonly dismissedAtMs: number;
  readonly nowMs: number;
}

const DAY = 24 * 60 * 60 * 1000;
export const STRONG_BACKUP_MAX_AGE_MS = 30 * DAY;
export const STRONG_SNOOZE_MS = 7 * DAY;
export const GENTLE_SNOOZE_MS = 90 * DAY;

export function decideBackupNag(i: NagInput): NagLevel {
  if (!i.hasData) return 'none';
  const sinceBackup = i.lastBackupAtMs === 0 ? Infinity : i.nowMs - i.lastBackupAtMs;
  const sinceDismissed = i.dismissedAtMs === 0 ? Infinity : i.nowMs - i.dismissedAtMs;
  if (!i.onService) {
    // Only here. A recent backup settles it for a while; a refusal to keep storage makes it urgent, but it still can be snoozed for a week.
    const stale = sinceBackup > STRONG_BACKUP_MAX_AGE_MS;
    return stale && sinceDismissed > STRONG_SNOOZE_MS ? 'strong' : 'none';
  }
  if (i.persisted === false && sinceBackup > STRONG_BACKUP_MAX_AGE_MS * 3 && sinceDismissed > GENTLE_SNOOZE_MS) return 'gentle';
  return 'none';
}
