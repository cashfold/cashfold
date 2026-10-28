'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { sessionMarker } from '../core/session-marker';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../kit';
import { SignOutDialogLazy } from './SignOutDialogLazy';

type UnlockResult = { ok: true } | { ok: false; error: { code: string; retryAfterMs?: number } };

export function UnlockForm() {
  const { t } = useI18n();
  const core = useCore();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [quick, setQuick] = useState<{ credentialId: Uint8Array; prfSalt: Uint8Array } | undefined>();
  const [different, setDifferent] = useState(false);

  useEffect(() => {
    void core
      .call<{ allowed: boolean; credentialId?: Uint8Array; prfSalt?: Uint8Array }>('quickUnlock.status', { sessionMarker: sessionMarker() })
      .then((s) => setQuick(s.allowed && s.credentialId && s.prfSalt ? { credentialId: s.credentialId, prfSalt: s.prfSalt } : undefined))
      .catch(() => setQuick(undefined));
  }, [core, core.epoch]);

  async function unlockQuick() {
    if (!quick) return;
    setError(undefined);
    setBusy(true);
    try {
      // Loaded when quick unlock is used: the unlock form is carried by every page, and the passkey code is only needed here.
      const { readPrf } = await import('./webauthn');
      const prf = await readPrf(navigator.credentials, { ...quick, rpId: location.hostname, rng: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) } });
      if (typeof prf === 'string') return setError(prf === 'cancelled' ? undefined : t('quick.failed'));
      const result = await core.call<UnlockResult>('quickUnlock.unlock', { prfOutput: prf, sessionMarker: sessionMarker() });
      prf.fill(0);
      if (result.ok) await core.markUnlocked();
      else setError(t('quick.failed'));
    } finally {
      setBusy(false);
    }
  }

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
    <div>
      <h1 className="text-2xl font-semibold">{t('unlock.title')}</h1>
      {core.account ? <p className="mt-3 text-muted">{t('unlock.account', { email: core.account.email })}</p> : null}
      <form onSubmit={submit} aria-busy={busy}>
        <TextField label={t('unlock.password.label')} type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        <Button className="mt-6" type="submit" disabled={busy}>{busy ? t('unlock.working') : t('unlock.submit')}</Button>
      </form>
      {quick ? <Button outline className="mt-4" type="button" disabled={busy} onClick={() => void unlockQuick()}>{t('quick.button')}</Button> : null}
      {/* The way out for a person who does not have the password (spec 011, FR-014): it needs the account's own email address, not the password. */}
      {core.account ? (
        <>
          <p className="mt-6"><Button plain type="button" onClick={() => setDifferent(true)}>{t('signout.different')}</Button></p>
          <SignOutDialogLazy open={different} onClose={() => setDifferent(false)} email={core.account.email} kind={core.account.registration === 'done' ? 'service' : 'local'} locked />
        </>
      ) : null}
    </div>
  );
}
