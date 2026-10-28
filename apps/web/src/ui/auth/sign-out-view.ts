// What the sign-out confirmation shows and when its confirm button is on (spec 011). Pure, so the rules are tested without a screen; the dialog only draws them.

export interface SignOutInput {
  /** `service`: the account is registered with a service and also lives elsewhere. `local`: this device holds the only copy (local-only, or never registered). */
  readonly kind: 'service' | 'local';
  /** The lock screen's "Use a different account": no password, no database, so no backup and no sync. */
  readonly locked: boolean;
  /** The account's email address, as stored. */
  readonly email: string;
  readonly typedEmail: string;
  /** Changes that have not reached the service. */
  readonly pending: number;
  readonly online: boolean;
  /** A final sync was tried because the service was reachable, and the changes still have not reached it. */
  readonly syncFailed: boolean;
  /** The extra tick that accepts losing those changes. */
  readonly acceptLoss: boolean;
  readonly lastBackupAtMs: number;
  readonly working: boolean;
}

export interface SignOutView {
  /** Which opening statement leads: what is erased and what is not, or that this is the only copy. */
  readonly first: 'service' | 'local';
  readonly sync: { readonly count: number; readonly canSyncNow: boolean; readonly offline: boolean } | undefined;
  /** `button`: make a backup first. `hint`: you cannot while locked, unlock first. `none`: not needed, the account is elsewhere too. */
  readonly backup: { readonly show: 'button' | 'hint' | 'none'; readonly hasBackup: boolean; readonly lastBackupAtMs: number };
  readonly needsEmail: boolean;
  readonly needsAcceptLoss: boolean;
  readonly canConfirm: boolean;
  /** Cancel always has the focus when the confirmation opens. */
  readonly cancelFocused: true;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function signOutView(input: SignOutInput): SignOutView {
  const local = input.kind === 'local';
  // Only an unlocked account on a service has anything to sync; changes on this device are lost only if they have not reached it.
  const syncable = !local && !input.locked && input.pending > 0;
  // Sync now is always on: asking the service again is exactly what reconnects it, so it is offered even while the service is out of reach.
  const sync = syncable ? { count: input.pending, canSyncNow: true, offline: !input.online || input.syncFailed } : undefined;
  const needsAcceptLoss = sync?.offline === true;
  const needsEmail = local || input.locked;
  const emailOk = !needsEmail || same(input.typedEmail, input.email);
  const hasBackup = input.lastBackupAtMs > 0;
  return {
    first: input.kind,
    sync,
    backup: { show: !local ? 'none' : input.locked ? 'hint' : 'button', hasBackup, lastBackupAtMs: input.lastBackupAtMs },
    needsEmail,
    needsAcceptLoss,
    canConfirm: !input.working && emailOk && (!needsAcceptLoss || input.acceptLoss),
    cancelFocused: true,
  };
}
