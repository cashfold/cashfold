'use client';

import { parseAddDeviceLink } from '@cashfold/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { ServerAddress } from '../settings/ServerAddress';
import { Button, Checkbox, CheckboxField, Label } from '../kit';

type Result = { ok: true } | { ok: false; error: { code: string; retryAfterS?: number } };

const ERROR_KEYS: Readonly<Record<string, string>> = {
  invalid_email: 'adddevice.error.invalid_email',
  invalid_server: 'signup.error.invalid_server',
  invalid_secret_key: 'adddevice.error.invalid_secret_key',
  wrong_credentials: 'adddevice.error.wrong_credentials',
  offline: 'adddevice.error.offline',
  rate_limited: 'adddevice.error.rate_limited',
  kdf_below_floor: 'adddevice.error.kdf_below_floor',
  device_removed: 'adddevice.error.device_removed',
  already_has_account: 'adddevice.error.already_has_account',
};

/**
 * Adds this device to an existing account (FR-004). The add-device link carries the address, the service and the Secret Key
 * in its fragment; the fragment is read once and removed from the address bar and the history before anything is shown.
 */
export function AddDeviceScreen() {
  const { t } = useI18n();
  const core = useCore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [server, setServer] = useState(process.env['NEXT_PUBLIC_DEFAULT_SERVER'] ?? '');
  const [secretKey, setSecretKey] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fromLink, setFromLink] = useState(false);

  useEffect(() => {
    if (location.hash.length > 1) {
      const link = parseAddDeviceLink(location.hash);
      if (link.email) setEmail(link.email);
      if (link.server) setServer(link.server);
      if (link.secretKeyText) setSecretKey(link.secretKeyText);
      setFromLink(true);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<Result>('account.signIn', { email, server, secretKeyText: secretKey, password: bytes }));
      if (result.ok) {
        setPassword('');
        setSecretKey('');
        await core.markUnlocked();
        router.replace('/overview/');
        return;
      }
      const key = ERROR_KEYS[result.error.code];
      setError(key === undefined ? t('adddevice.error.generic') : t(key));
    } catch {
      setError(t('adddevice.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (core.phase === 'locked' || core.phase === 'unlocked') {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{t('page.addDevice.title')}</h1>
        <p className="mt-3">{t('adddevice.alreadyHasAccount')}</p>
        <p className="mt-3"><Link className="underline" href="/settings/sync/">{t('adddevice.goDevices')}</Link></p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('page.addDevice.title')}</h1>
      {core.removed ? <p role="status" className="mt-3 rounded-ui border border-border-strong p-3">{t('adddevice.removedNotice')}</p> : null}
      <p className="mt-3 text-muted">{fromLink ? t('adddevice.lede.link') : t('adddevice.lede')}</p>
      <form onSubmit={submit} aria-busy={busy}>
        <TextField label={t('signup.email.label')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <ServerAddress value={server} onChange={setServer} />
        <TextField
          label={t('adddevice.secretKey.label')} hint={t('adddevice.secretKey.hint')} type={reveal ? 'text' : 'password'} autoComplete="off" required spellCheck={false}
          value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
        />
        <TextField label={t('unlock.password.label')} type={reveal ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <CheckboxField className="mt-3"><Checkbox checked={reveal} onChange={(checked) => setReveal(checked)} /><Label>{t('adddevice.reveal')}</Label></CheckboxField>
        {error ? <p role="alert" className="mt-4 text-danger">{error}</p> : null}
        <Button className="mt-6" type="submit" disabled={busy}>{busy ? t('adddevice.working') : t('adddevice.submit')}</Button>
      </form>
      <p className="mt-6"><Link className="underline" href="/recover/">{t('adddevice.lostAccess')}</Link></p>
    </div>
  );
}
