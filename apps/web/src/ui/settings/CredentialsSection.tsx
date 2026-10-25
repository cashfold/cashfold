'use client';

import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { downloadKit, printKit } from '../emergency-kit/actions';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { OneTimeSecret } from './OneTimeSecret';
import { accountErrorText, type Reply } from './errors';
import { Button } from '../kit';

type Changed = { secretKeyText?: string; otherDevicesSignedOut: true };

/** Changing the password and getting a new Secret Key (FR-008). Both ask for the current password and sign the other devices out. */
export function CredentialsSection() {
  const { t, locale, dir } = useI18n();
  const core = useCore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<'password' | 'key' | undefined>();
  const [newKey, setNewKey] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'password' | 'key'>('password');

  const registered = core.account?.registration === 'done';
  if (!registered) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setDone(undefined);
    if (mode === 'password' && next !== again) return setError(t('account.credentials.mismatch'));
    setBusy(true);
    try {
      const result = await withPasswordBytes(current, (password) =>
        mode === 'password'
          ? withPasswordBytes(next, (newPassword) => core.call<Reply<Changed>>('credentials.change', { password, newPassword }))
          : core.call<Reply<Changed>>('credentials.change', { password, rotateSecretKey: true }),
      );
      if (!result.ok) return setError(accountErrorText(t, result.error));
      setCurrent('');
      setNext('');
      setAgain('');
      if (result.value.secretKeyText !== undefined) setNewKey(result.value.secretKeyText);
      setDone(mode);
    } finally {
      setBusy(false);
    }
  }

  const kit = newKey === undefined || core.account === undefined ? undefined : { accountId: core.account.accountId, email: core.account.email, server: core.account.server, secretKeyText: newKey };

  return (
    <section aria-labelledby="credentials-heading" className="mt-8">
      <h2 id="credentials-heading" className="text-lg font-semibold">{t('account.credentials.title')}</h2>
      <p className="mt-1 text-muted">{t('account.credentials.lede')}</p>
      <div className="mt-3 flex gap-3" role="group" aria-label={t('account.credentials.choose')}>
        {mode === 'password' ? <Button type="button" aria-pressed onClick={() => setMode('password')}>{t('account.credentials.password')}</Button> : <Button outline type="button" aria-pressed={false} onClick={() => setMode('password')}>{t('account.credentials.password')}</Button>}
        {mode === 'key' ? <Button type="button" aria-pressed onClick={() => setMode('key')}>{t('account.credentials.secretKey')}</Button> : <Button outline type="button" aria-pressed={false} onClick={() => setMode('key')}>{t('account.credentials.secretKey')}</Button>}
      </div>
      <form onSubmit={submit} aria-busy={busy} className="max-w-md">
        <TextField label={t('account.credentials.current')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        {mode === 'password' ? (
          <>
            <TextField label={t('account.credentials.new')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
            <TextField label={t('account.credentials.again')} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">{t('account.credentials.keyLede')}</p>
        )}
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <Button className="mt-4" type="submit" disabled={busy}>{mode === 'password' ? t('account.credentials.changePassword') : t('account.credentials.newKey')}</Button>
      </form>
      {done === 'password' ? <p role="status" className="mt-3">{t('account.credentials.passwordChanged')}</p> : null}
      {done === 'key' && newKey === undefined ? <p role="status" className="mt-3">{t('account.credentials.keyChanged')}</p> : null}
      {newKey !== undefined && kit !== undefined ? (
        <OneTimeSecret
          title={t('account.newkey.title')} lede={t('account.newkey.lede')} warning={t('account.newkey.warning')} label={t('secretkey.label')} text={newKey} testId="new-secret-key"
          fileName="cashfold-secret-key.txt" onDone={() => setNewKey(undefined)}
          extra={(
            <>
              <Button outline type="button" onClick={() => downloadKit(kit, { t, locale, dir })}>{t('secretkey.download')}</Button>
              <Button outline type="button" onClick={() => printKit(kit, { t, locale, dir })}>{t('secretkey.print')}</Button>
            </>
          )}
        />
      ) : null}
    </section>
  );
}
