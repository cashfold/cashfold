'use client';

import type { DeviceSettings } from '@cashfold/core';
import { useEffect, useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { useDesktop } from '../desktop/DesktopSettingsProvider';
import { accountDetailsView } from './account-details';
import { SignOutSection } from './SignOutSection';
import { downloadKit, printKit, type KitSource } from '../emergency-kit/actions';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { AccountSection } from './AccountSection';
import { CredentialsSection } from './CredentialsSection';
import { QuickUnlockSection } from './QuickUnlockSection';
import { RecoverySection } from './RecoverySection';
import { Button, Select } from '../kit';

const IDLE_MINUTES = [1, 2, 5, 10, 15, 30, 60];
const HIDDEN_SECONDS = [0, 15, 30, 60, 120, 300];

type KitResult = { ok: true; value: KitSource } | { ok: false; error: { code: string; retryAfterMs?: number } };

export function ProfileSecurity() {
  const { t, locale, dir } = useI18n();
  const core = useCore();
  const details = core.account === undefined ? undefined : accountDetailsView(core.account);
  // The desktop app locks a hidden window at the idle time (ADR-0012), so the hidden-window time does not apply there.
  const { isDesktop } = useDesktop();
  const [settings, setSettings] = useState<DeviceSettings | undefined>();
  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState('');
  const [kit, setKit] = useState<KitSource | undefined>();
  const [kitError, setKitError] = useState<string | undefined>();

  const reload = () => void core.call<DeviceSettings>('settings.get').then(setSettings);
  useEffect(reload, [core]);

  async function change(patch: Partial<DeviceSettings>) {
    setSettings(await core.call<DeviceSettings>('settings.set', patch));
    setSaved(true);
  }

  async function exportKit(event: FormEvent) {
    event.preventDefault();
    setKitError(undefined);
    const result = await withPasswordBytes(password, (bytes) => core.call<KitResult>('emergencyKit.export', { password: bytes }));
    setPassword('');
    if (result.ok) setKit(result.value);
    else if (result.error.code === 'too_many_attempts') setKitError(t('unlock.error.too_many_attempts', { seconds: Math.ceil((result.error.retryAfterMs ?? 0) / 1000) }));
    else setKitError(t('unlock.error.wrong_password'));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('settings.group.profile')}</h1>

      <section aria-labelledby="lock-heading" className="mt-6">
        <h2 id="lock-heading" className="text-lg font-semibold">{t('settings.lock.title')}</h2>
        <p className="mt-1 text-muted">{t('settings.lock.lede')}</p>
        {settings ? (
          <div className="mt-3 grid max-w-md gap-4">
            <label className="block">
              <span className="mb-3 block font-medium">{t('settings.lock.idle')}</span>
              <Select value={settings.autoLockMinutes} onChange={(e) => void change({ autoLockMinutes: Number(e.target.value) })}>
                {IDLE_MINUTES.map((m) => <option key={m} value={m}>{t('settings.lock.minutes', { minutes: m })}</option>)}
              </Select>
            </label>
            {isDesktop ? null : (
              <label className="block">
                <span className="mb-3 block font-medium">{t('settings.lock.hidden')}</span>
                <Select value={settings.hiddenGraceSeconds} onChange={(e) => void change({ hiddenGraceSeconds: Number(e.target.value) })}>
                  {HIDDEN_SECONDS.map((s) => <option key={s} value={s}>{s === 0 ? t('settings.lock.immediately') : t('settings.lock.seconds', { seconds: s })}</option>)}
                </Select>
              </label>
            )}
            <p role="status" className="text-sm text-muted">{saved ? t('settings.saved') : ''}</p>
          </div>
        ) : null}
      </section>

      {settings ? <QuickUnlockSection enabled={settings.quickUnlock.enabled} onChange={reload} /> : null}

      <CredentialsSection />

      <RecoverySection />

      <SignOutSection />

      <section aria-labelledby="account-heading" className="mt-8">
        <h2 id="account-heading" className="text-lg font-semibold">{t('settings.account.title')}</h2>
        {core.account && details ? (
          <dl className="mt-2 grid max-w-md grid-cols-1 gap-x-4 gap-y-0 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1">
            <dt className="font-medium">{t('signup.email.label')}</dt><dd className="break-all max-sm:mb-2">{core.account.email}</dd>
            {details.showAddress ? <><dt className="font-medium">{t('signup.server.label')}</dt><dd className="break-all max-sm:mb-2">{core.account.server}</dd></> : null}
            <dt className="font-medium">{t('settings.account.registration')}</dt><dd className="max-sm:mb-2">{t(details.registrationKey)}</dd>
          </dl>
        ) : null}
      </section>

      <section aria-labelledby="kit-heading" className="mt-8">
        <h2 id="kit-heading" className="text-lg font-semibold">{t('settings.kit.title')}</h2>
        <p className="mt-1 text-muted">{t('settings.kit.lede')}</p>
        {kit ? (
          <div className="mt-3 flex flex-wrap gap-3">
            <Button outline type="button" onClick={() => downloadKit(kit, { t, locale, dir })}>{t('secretkey.download')}</Button>
            <Button outline type="button" onClick={() => printKit(kit, { t, locale, dir })}>{t('secretkey.print')}</Button>
            <Button outline type="button" onClick={() => setKit(undefined)}>{t('settings.kit.done')}</Button>
          </div>
        ) : (
          <form onSubmit={exportKit} className="max-w-md">
            <TextField label={t('unlock.password.label')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={kitError} />
            <Button className="mt-4" type="submit" >{t('settings.kit.show')}</Button>
          </form>
        )}
      </section>

      <AccountSection />
    </div>
  );
}
