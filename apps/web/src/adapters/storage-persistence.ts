// Asking the browser to keep this site's storage (ARCHITECTURE 8.1a, FR-072). Browsers may clear a site's data when space runs short unless
// it is "persistent"; whether they agree is up to them, and some decide from how the site is used. The app asks once it is unlocked, says so
// when the answer is no, and reminds people to make a backup (decideBackupNag).

export interface StorageLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

export interface PersistenceState {
  /** The browser can answer at all. */
  readonly supported: boolean;
  /** True: it will keep the data. False: it may clear it. Undefined: it cannot say. */
  readonly persisted: boolean | undefined;
  readonly usageBytes: number | undefined;
  readonly quotaBytes: number | undefined;
}

const UNKNOWN: PersistenceState = { supported: false, persisted: undefined, usageBytes: undefined, quotaBytes: undefined };

async function estimate(storage: StorageLike): Promise<Pick<PersistenceState, 'usageBytes' | 'quotaBytes'>> {
  try {
    const e = (await storage.estimate?.()) ?? {};
    return { usageBytes: typeof e.usage === 'number' ? e.usage : undefined, quotaBytes: typeof e.quota === 'number' ? e.quota : undefined };
  } catch {
    return { usageBytes: undefined, quotaBytes: undefined };
  }
}

/** The current state, without asking for anything. */
export async function readPersistence(storage: StorageLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage): Promise<PersistenceState> {
  if (storage?.persisted === undefined) return UNKNOWN;
  try {
    return { supported: true, persisted: await storage.persisted(), ...(await estimate(storage)) };
  } catch {
    return UNKNOWN;
  }
}

/**
 * Asks the browser to keep the data, unless it already does, and reports what it said. A browser that throws or does not know the
 * request is reported as "cannot say", which the reminder treats like "may clear it".
 */
export async function requestPersistence(storage: StorageLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage): Promise<PersistenceState> {
  if (storage?.persisted === undefined || storage.persist === undefined) return storage === undefined ? UNKNOWN : { ...(await readPersistence(storage)), persisted: undefined };
  try {
    let persisted = await storage.persisted();
    if (!persisted) persisted = await storage.persist();
    return { supported: true, persisted, ...(await estimate(storage)) };
  } catch {
    return UNKNOWN;
  }
}
