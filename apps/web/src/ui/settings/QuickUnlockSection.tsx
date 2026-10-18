'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { enrolDeviceCredential, platformAuthenticatorAvailable, readPrf } from '../auth/webauthn';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { sessionMarker } from '../core/session-marker';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

type Outcome = { ok: true } | { ok: false; error: { code: string; retryAfterMs?: number } };

const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

export function QuickUnlockSection({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const core = useCore();
  const [available, setAvailable] = useState<boolean | undefined>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => void platformAuthenticatorAvailable().then(setAvailable), []);

  async function turnOn(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const credential = await enrolDeviceCredential(navigator.credentials, { rpId: location.hostname, rng });
      if (typeof credential === 'string') return setError(t(credential === 'cancelled' ? 'quick.error.cancelled' : 'quick.error.unsupported'));
      const prfSalt = rng.bytes(32);
      const prfOutput = await readPrf(navigator.credentials, { credentialId: credential.credentialId, prfSalt, rpId: location.hostname, rng });
      if (typeof prfOutput === 'string') return setError(t(prfOutput === 'cancelled' ? 'quick.error.cancelled' : 'quick.error.unsupported'));
      const result = await withPasswordBytes(password, (bytes) =>
        core.call<Outcome>('quickUnlock.enable', { password: bytes, credentialId: credential.credentialId, prfSalt, prfOutput, sessionMarker: sessionMarker(true) }),
      );
      prfOutput.fill(0);
      setPassword('');
      if (result.ok) onChange();
      else if (result.error.code === 'too_many_attempts') setError(t('unlock.error.too_many_attempts', { seconds: Math.ceil((result.error.retryAfterMs ?? 0) / 1000) }));
      else setError(t('unlock.error.wrong_password'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="quick-heading" className="mt-8">
      <h2 id="quick-heading" className="text-lg font-semibold">{t('quick.title')}</h2>
      <p className="mt-1 text-muted">{t('quick.lede')}</p>
      {available === false ? <p className="mt-2">{t('quick.unavailable')}</p> : null}
      {available && enabled ? (
        <div className="mt-3">
          <p>{t('quick.on')}</p>
          <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={() => void core.call('quickUnlock.disable').then(onChange)}>{t('quick.turnOff')}</button>
        </div>
      ) : null}
      {available && !enabled ? (
        <form onSubmit={turnOn} className="max-w-md" aria-busy={busy}>
          <TextField label={t('unlock.password.label')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
          <button type="submit" className={`${buttonClass} mt-4`} disabled={busy}>{t('quick.turnOn')}</button>
        </form>
      ) : null}
    </section>
  );
}
