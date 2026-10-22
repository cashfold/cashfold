'use client';

import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { OneTimeSecret } from './OneTimeSecret';
import { accountErrorText, type Reply } from './errors';
import { Button } from '../kit';

/** The Recovery Key (FR-009): a way back in when the password or the Secret Key is lost. Shown once, kept by the person. */
export function RecoverySection() {
  const { t } = useI18n();
  const core = useCore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [key, setKey] = useState<string | undefined>();
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (core.account?.registration !== 'done') return null;

  async function run(action: 'set' | 'remove', event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setRemoved(false);
    setBusy(true);
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<Reply<{ recoveryKeyText: string } | true>>(action === 'set' ? 'recovery.set' : 'recovery.remove', { password: bytes }));
      setPassword('');
      if (!result.ok) return setError(accountErrorText(t, result.error));
      if (result.value !== true) setKey(result.value.recoveryKeyText);
      else setRemoved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="recovery-heading" className="mt-8">
      <h2 id="recovery-heading" className="text-lg font-semibold">{t('account.recovery.title')}</h2>
      <p className="mt-1 text-muted">{t('account.recovery.lede')}</p>
      <form className="max-w-md" aria-busy={busy} onSubmit={(e) => void run('set', e)}>
        <TextField label={t('account.credentials.current')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>{t('account.recovery.set')}</Button>
          <Button outline type="button" disabled={busy || password === ''} onClick={(e) => void run('remove', e as never)}>{t('account.recovery.remove')}</Button>
        </div>
      </form>
      {removed ? <p role="status" className="mt-3">{t('account.recovery.removed')}</p> : null}
      {key !== undefined ? (
        <OneTimeSecret
          title={t('account.recovery.shown.title')} lede={t('account.recovery.shown.lede')} warning={t('account.recovery.shown.warning')} label={t('account.recovery.label')} text={key}
          testId="recovery-key" fileName="cashfold-recovery-key.txt" onDone={() => setKey(undefined)}
        />
      ) : null}
    </section>
  );
}
