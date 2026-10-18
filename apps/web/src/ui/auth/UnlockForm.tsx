'use client';

import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField, buttonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

type UnlockResult = { ok: true } | { ok: false; error: { code: string; retryAfterMs?: number } };

export function UnlockForm() {
  const { t } = useI18n();
  const core = useCore();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<UnlockResult>('unlock', { password: bytes }));
      if (result.ok) {
        setPassword('');
        await core.markUnlocked();
      } else if (result.error.code === 'too_many_attempts') {
        setError(t('unlock.error.too_many_attempts', { seconds: Math.ceil((result.error.retryAfterMs ?? 0) / 1000) }));
      } else {
        setError(result.error.code === 'wrong_password' ? t('unlock.error.wrong_password') : t('unlock.error.generic'));
      }
    } catch {
      setError(t('unlock.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t('unlock.title')}</h1>
      {core.account ? <p className="mt-3 text-muted">{t('unlock.account', { email: core.account.email })}</p> : null}
      <form onSubmit={submit} aria-busy={busy}>
        <TextField label={t('unlock.password.label')} type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        <button type="submit" className={`${buttonClass} mt-6`} disabled={busy}>{busy ? t('unlock.working') : t('unlock.submit')}</button>
      </form>
    </main>
  );
}
