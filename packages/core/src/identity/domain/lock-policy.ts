export interface LockPolicy {
  /** Lock after this long without activity. Default 5 minutes. */
  readonly idleMs: number;
  /** Lock after the page has been hidden this long. Default 1 minute. */
  readonly hiddenGraceMs: number;
}

export const DEFAULT_LOCK_POLICY: LockPolicy = { idleMs: 5 * 60_000, hiddenGraceMs: 60_000 };
