import type { LockPolicy } from './lock-policy';

// Per-device preferences that govern locking (FR-006, FR-007). They live on the device, not in a Fold, and are not secret.
// Anything read back from storage is parsed defensively: a damaged or hostile value can never switch locking off.

export interface DeviceSettings {
  /** Lock after this many minutes without activity. 1 to 60. */
  readonly autoLockMinutes: number;
  /** Lock after the window has been hidden this many seconds. 0 to 600. */
  readonly hiddenGraceSeconds: number;
  readonly quickUnlock: {
    readonly enabled: boolean;
    /** Quick unlock works only if the app was locked for less than this many minutes; after that, the password. 1 to 1440. */
    readonly maxIdleMinutes: number;
  };
  /** The Emergency Kit reminder was dismissed. */
  readonly kitReminderDismissed: boolean;
  /** When this device last made an encrypted backup (ms since 1970), or 0 for never. */
  readonly lastBackupAtMs: number;
  /** When the person last put off the backup reminder, or 0. */
  readonly backupNagDismissedAtMs: number;
}

export const DEFAULT_SETTINGS: DeviceSettings = {
  autoLockMinutes: 5,
  hiddenGraceSeconds: 60,
  quickUnlock: { enabled: false, maxIdleMinutes: 30 },
  kitReminderDismissed: false,
  lastBackupAtMs: 0,
  backupNagDismissedAtMs: 0,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

const MAX_TIME = 8_640_000_000_000_000; // the largest time a JavaScript Date holds
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseSettings(input: unknown): DeviceSettings {
  if (!isRecord(input)) return DEFAULT_SETTINGS;
  const quick = isRecord(input['quickUnlock']) ? input['quickUnlock'] : {};
  return {
    autoLockMinutes: clampInt(input['autoLockMinutes'], 1, 60, DEFAULT_SETTINGS.autoLockMinutes),
    hiddenGraceSeconds: clampInt(input['hiddenGraceSeconds'], 0, 600, DEFAULT_SETTINGS.hiddenGraceSeconds),
    quickUnlock: {
      enabled: quick['enabled'] === true,
      maxIdleMinutes: clampInt(quick['maxIdleMinutes'], 1, 1440, DEFAULT_SETTINGS.quickUnlock.maxIdleMinutes),
    },
    kitReminderDismissed: input['kitReminderDismissed'] === true,
    lastBackupAtMs: clampInt(input['lastBackupAtMs'], 0, MAX_TIME, 0),
    backupNagDismissedAtMs: clampInt(input['backupNagDismissedAtMs'], 0, MAX_TIME, 0),
  };
}

export function toLockPolicy(settings: DeviceSettings): LockPolicy {
  return { idleMs: settings.autoLockMinutes * 60_000, hiddenGraceMs: settings.hiddenGraceSeconds * 1000 };
}
