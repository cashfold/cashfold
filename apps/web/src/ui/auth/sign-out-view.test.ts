import { describe, expect, it } from 'vitest';
import { signOutView, type SignOutInput } from './sign-out-view';

const base: SignOutInput = { kind: 'service', locked: false, email: 'Alice@Example.com', typedEmail: '', pending: 0, online: true, syncFailed: false, acceptLoss: false, lastBackupAtMs: 0, working: false };
const view = (over: Partial<SignOutInput> = {}) => signOutView({ ...base, ...over });

describe('the sign-out confirmation for an account that is on a service (FR-005, FR-006)', () => {
  it('says what is erased and what is not, and how to come back, and nothing about a backup or a typed address', () => {
    const v = view();
    expect(v.first).toBe('service');
    expect(v.backup).toEqual({ show: 'none', hasBackup: false, lastBackupAtMs: 0 });
    expect(v.needsEmail).toBe(false);
    expect(v.canConfirm).toBe(true);
  });

  it('puts Cancel first in focus, whatever the state', () => {
    expect(view().cancelFocused).toBe(true);
    expect(view({ pending: 4, online: false }).cancelFocused).toBe(true);
    expect(view({ working: true }).cancelFocused).toBe(true);
  });

  it('shows nothing about syncing when everything has reached the service', () => {
    expect(view({ pending: 0 }).sync).toBeUndefined();
  });

  it('shows how many changes have not reached the service, with a way to sync them first', () => {
    expect(view({ pending: 3 }).sync).toEqual({ count: 3, canSyncNow: true, offline: false });
    expect(view({ pending: 3, online: false }).sync?.canSyncNow).toBe(true); // pressing it is what tries the service again
    expect(view({ pending: 3 }).canConfirm).toBe(true);
  });

  it('needs the extra tick to continue when the service cannot be reached and changes would be lost', () => {
    const offline = view({ pending: 3, online: false });
    expect(offline.sync).toEqual({ count: 3, canSyncNow: true, offline: true });
    expect(offline.needsAcceptLoss).toBe(true);
    expect(offline.canConfirm).toBe(false);
    expect(view({ pending: 3, online: false, acceptLoss: true }).canConfirm).toBe(true);
  });

  it('treats a final sync that did not finish like an unreachable service: the changes would be lost, so the tick is needed', () => {
    const v = view({ pending: 2, online: true, syncFailed: true });
    expect(v.sync).toEqual({ count: 2, canSyncNow: true, offline: true });
    expect(v.needsAcceptLoss).toBe(true);
    expect(v.canConfirm).toBe(false);
    expect(view({ pending: 2, online: true, syncFailed: true, acceptLoss: true }).canConfirm).toBe(true);
  });

  it('does not ask for the tick when nothing would be lost, even offline', () => {
    const v = view({ pending: 0, online: false });
    expect(v.needsAcceptLoss).toBe(false);
    expect(v.canConfirm).toBe(true);
  });

  it('disables the confirm button while it is working', () => {
    expect(view({ working: true }).canConfirm).toBe(false);
  });
});

describe('the sign-out confirmation for an account that exists only on this device (FR-007)', () => {
  const local = (over: Partial<SignOutInput> = {}) => view({ kind: 'local', ...over });

  it('says first that this is the only copy, and offers a backup first', () => {
    const v = local();
    expect(v.first).toBe('local');
    expect(v.backup.show).toBe('button');
  });

  it('reports whether a backup was made, and when', () => {
    expect(local({ lastBackupAtMs: 0 }).backup).toEqual({ show: 'button', hasBackup: false, lastBackupAtMs: 0 });
    expect(local({ lastBackupAtMs: 1_700_000_000_000 }).backup).toEqual({ show: 'button', hasBackup: true, lastBackupAtMs: 1_700_000_000_000 });
  });

  it('keeps the confirm button disabled until the account email is typed, with or without a backup', () => {
    expect(local().canConfirm).toBe(false);
    expect(local({ lastBackupAtMs: 1_700_000_000_000 }).canConfirm).toBe(false);
    expect(local({ typedEmail: 'someone@else.com' }).canConfirm).toBe(false);
    expect(local({ typedEmail: 'alice@example.com' }).canConfirm).toBe(true);
    expect(local({ typedEmail: '  ALICE@example.COM ', lastBackupAtMs: 1_700_000_000_000 }).canConfirm).toBe(true);
    expect(local({ typedEmail: 'alice@example.com', working: true }).canConfirm).toBe(false);
  });

  it('has no sync section and no tick for lost changes, even with changes counted and the service out of reach', () => {
    const v = local({ pending: 3, online: false, typedEmail: 'alice@example.com' });
    expect(v.sync).toBeUndefined();
    expect(v.needsAcceptLoss).toBe(false);
    expect(v.canConfirm).toBe(true);
  });
});

describe('the sign-out confirmation on the lock screen (FR-014)', () => {
  const locked = (over: Partial<SignOutInput> = {}) => view({ locked: true, ...over });

  it('needs the typed email for every kind of account, and never a sync section', () => {
    for (const kind of ['service', 'local'] as const) {
      expect(locked({ kind }).needsEmail).toBe(true);
      expect(locked({ kind }).canConfirm).toBe(false);
      expect(locked({ kind, typedEmail: 'alice@example.com' }).canConfirm).toBe(true);
      expect(locked({ kind, pending: 5, online: false }).sync).toBeUndefined();
    }
  });

  it('names the account and says this copy will be erased, for an account on a service', () => {
    expect(locked({ kind: 'service' }).first).toBe('service');
  });

  it('puts the only-copy warning first for an account with no service, and replaces the backup button with the unlock-first hint', () => {
    const v = locked({ kind: 'local' });
    expect(v.first).toBe('local');
    expect(v.backup.show).toBe('hint');
  });
});
