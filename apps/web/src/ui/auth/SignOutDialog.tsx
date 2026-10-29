'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Checkbox, CheckboxField, Dialog, DialogActions, DialogBody, DialogTitle, Label, Text } from '../kit';
import { useSyncStatus } from '../sync/useSyncStatus';
import { signOutView } from './sign-out-view';

type Outcome = { ok: true; value: { deviceStillListed: boolean } } | { ok: false; error: { code: string } };

/**
 * The one confirmation for leaving the account on this device (spec 011). It is used from Settings (unlocked) and from the lock screen ("Use a different
 * account"). What it shows and when its button is on are decided by `signOutView`; this only draws them and makes the call.
 */
export interface SignOutDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly email: string;
  readonly kind: 'service' | 'local';
  readonly locked: boolean;
}

export function SignOutDialog({ open, onClose, email, kind, locked }: SignOutDialogProps) {
  const { t, locale } = useI18n();
  const core = useCore();
  const router = useRouter();
  const { status, syncNow, refresh } = useSyncStatus();
  const [typedEmail, setTypedEmail] = useState('');
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [lastBackupAtMs, setLastBackupAtMs] = useState(0);
  const [working, setWorking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // What the confirmation says about backups comes from the device, so ask when it opens (only an unlocked app can answer).
  useEffect(() => {
    if (!open || locked || kind !== 'local') return;
    let live = true;
    core.call<{ lastBackupAtMs: number }>('storage.status').then((s) => live && setLastBackupAtMs(s.lastBackupAtMs), () => undefined);
    return () => {
      live = false;
    };
  }, [open, locked, kind, core]);

  // The count shown is read now, not whatever the last poll saw.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (open) return;
    setTypedEmail('');
    setAcceptLoss(false);
    setSyncFailed(false);
    setError(undefined);
  }, [open]);

  const pending = locked || kind === 'local' ? 0 : (status?.folds ?? []).reduce((n, f) => n + f.pendingOps, 0);
  const online = status?.connection === 'online';
  const view = signOutView({ kind, locked, email, typedEmail, pending, online, syncFailed, acceptLoss, lastBackupAtMs, working });

  async function confirm() {
    setWorking(true);
    setError(undefined);
    try {
      // An account on a service sends what has not reached it before anything is erased, whatever the count shown says (it can be a few seconds old).
      // If that does not finish, the person is treated as having an unreachable service: told how many would be lost, and asked to tick before going on.
      // Someone who has already ticked to lose them is not made to wait.
      if (kind === 'service' && !locked && !(view.needsAcceptLoss && acceptLoss)) {
        await syncNow();
        const fresh = await core.call<{ folds: ReadonlyArray<{ pendingOps: number }> }>('sync.status');
        if (fresh.folds.reduce((n, f) => n + f.pendingOps, 0) > 0) {
          setSyncFailed(true);
          return;
        }
      }
      const result = await core.call<Outcome>(locked ? 'account.signOutLocked' : 'account.signOut', locked ? { email: typedEmail } : undefined);
      if (result.ok) {
        if (result.value.deviceStillListed) core.showSignedOutNotice({ deviceStillListed: true });
      } else if (result.error.code === 'wrong_email') {
        setError(t('signout.error.wrong_email'));
        return;
      } else if (result.error.code !== 'no_account') {
        setError(t('signout.error.generic'));
        return;
      }
      onClose();
      router.replace('/');
    } catch {
      setError(t('signout.error.generic'));
    } finally {
      setWorking(false);
    }
  }

  async function syncFirst() {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  }

  const date = (ms: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));

  return (
    <Dialog open={open} onClose={onClose} size="lg" placement="sheet">
      <DialogTitle>{t(locked ? 'signout.different' : 'signout.dialog.title')}</DialogTitle>
      <DialogBody>
        {locked ? <Text>{t('signout.different.lede', { email })}</Text> : null}
        {view.first === 'local' ? (
          <Text className={locked ? 'mt-2 font-medium' : 'font-medium'} data-testid="signout-only-copy">{t('signout.local.only')}</Text>
        ) : (
          <>
            <Text className={locked ? 'mt-2' : ''}>{t('signout.service.erases')}</Text>
            <Text className="mt-2">{t('signout.service.back')}</Text>
          </>
        )}

        {view.backup.show === 'button' ? (
          <div className="mt-3" data-testid="signout-backup">
            <Text>{view.backup.hasBackup ? t('signout.local.lastBackup', { date: date(view.backup.lastBackupAtMs) }) : t('signout.local.noBackup')}</Text>
            <Link className="mt-1 inline-block underline" href="/settings/data/?then=sign-out">{t('signout.local.backup')}</Link>
          </div>
        ) : null}
        {view.backup.show === 'hint' ? <Text className="mt-3" data-testid="signout-lock-hint">{t('signout.lock.hint')}</Text> : null}

        {view.sync ? (
          <div className="mt-3" data-testid="signout-pending">
            <Text role="status">{t('signout.pending', { count: view.sync.count })}</Text>
            {view.sync.offline ? <Text className="mt-1">{t('signout.pending.offline')}</Text> : null}
            <Button outline className="mt-2" type="button" disabled={!view.sync.canSyncNow || syncing || working} onClick={() => void syncFirst()}>{t('signout.pending.sync')}</Button>
            {view.needsAcceptLoss ? (
              <CheckboxField className="mt-3"><Checkbox checked={acceptLoss} onChange={(checked) => setAcceptLoss(checked)} /><Label>{t('signout.pending.accept')}</Label></CheckboxField>
            ) : null}
          </div>
        ) : null}

        {view.needsEmail ? <TextField label={t('signout.email.label', { email })} autoComplete="off" value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} {...(error === undefined ? {} : { error })} /> : null}
        {!view.needsEmail && error !== undefined ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      </DialogBody>
      <DialogActions>
        <Button outline type="button" data-autofocus onClick={onClose}>{t('ledger.cancel')}</Button>
        <Button type="button" disabled={!view.canConfirm} onClick={() => void confirm()}>{working ? t('signout.working') : t('signout.confirm')}</Button>
      </DialogActions>
    </Dialog>
  );
}
