'use client';

import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { EmailSection } from './EmailSection';
import { ServerAddress } from './ServerAddress';
import { Button } from '../kit';

type Result = { ok: true } | { ok: false; error: { code: string } };

const ERROR_KEYS: Readonly<Record<string, string>> = {
  wrong_password: 'unlock.error.wrong_password',
  offline: 'adddevice.error.offline',
  email_taken: 'syncenable.error.email_taken',
  invite_required: 'syncenable.error.invite_required',
  rate_limited: 'adddevice.error.rate_limited',
  invalid_server: 'signup.error.invalid_server',
  rejected: 'syncenable.error.rejected',
};

/** Turns on sync for an account made offline (T200), and holds the email settings that go with having a service. */
export function SyncSection() {
  const { t } = useI18n();
  const core = useCore();
  const { status, refresh } = useSyncStatus();
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (status === undefined || !status.available) return null;

  async function enable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await withPasswordBytes(password, (bytes) =>
        core.call<Result>('sync.enable', { password: bytes, ...(server.trim() !== '' && { server }), ...(invite.trim() !== '' && { inviteCode: invite.trim() }) }),
      );
      setPassword('');
      if (r.ok) {
        await core.refresh();
        await refresh();
      } else setError(t(ERROR_KEYS[r.error.code] ?? 'syncenable.error.generic'));
    } catch {
      setError(t('syncenable.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sync-settings-heading" className="mt-8">
      <h2 id="sync-settings-heading" className="text-lg font-semibold">{t('syncenable.title')}</h2>
      {status.registration === 'pending' ? (
        <form onSubmit={enable} className="max-w-md" aria-busy={busy}>
          <p className="mt-1 text-muted">{t('syncenable.lede')}</p>
          <ServerAddress value={server} onChange={setServer} />
          <TextField label={t('unlock.password.label')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label={t('syncenable.invite.label')} hint={t('syncenable.invite.hint')} autoComplete="off" value={invite} onChange={(e) => setInvite(e.target.value)} />
          {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
          <Button className="mt-4" type="submit" disabled={busy}>{busy ? t('adddevice.working') : t('syncenable.submit')}</Button>
        </form>
      ) : (
        <>
          <p className="mt-1 text-muted">{t('syncenable.done')}</p>
          <EmailSection />
        </>
      )}
    </section>
  );
}
