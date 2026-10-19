'use client';

import type { DeviceSettings } from '@cashfold/core';
import { useEffect, useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { downloadKit, printKit, type KitSource } from '../emergency-kit/actions';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { QuickUnlockSection } from './QuickUnlockSection';
import { SyncSection } from './SyncSection';

const IDLE_MINUTES = [1, 2, 5, 10, 15, 30, 60];
const HIDDEN_SECONDS = [0, 15, 30, 60, 120, 300];

type KitResult = { ok: true; value: KitSource } | { ok: false; error: { code: string; retryAfterMs?: number } };

export function SettingsScreen() {
  const { t } = useI18n();
  const core = useCore();
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
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t('page.settings.title')}</h1>

      <section aria-labelledby="lock-heading" className="mt-6">
        <h2 id="lock-heading" className="text-lg font-semibold">{t('settings.lock.title')}</h2>
        <p className="mt-1 text-muted">{t('settings.lock.lede')}</p>
        {settings ? (
          <div className="mt-3 grid max-w-md gap-4">
            <label className="block">
              <span className="block font-medium">{t('settings.lock.idle')}</span>
              <select className="mt-1 rounded-ui border border-border-strong bg-bg px-3 py-2" value={settings.autoLockMinutes} onChange={(e) => void change({ autoLockMinutes: Number(e.target.value) })}>
                {IDLE_MINUTES.map((m) => <option key={m} value={m}>{t('settings.lock.minutes', { minutes: m })}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block font-medium">{t('settings.lock.hidden')}</span>
              <select className="mt-1 rounded-ui border border-border-strong bg-bg px-3 py-2" value={settings.hiddenGraceSeconds} onChange={(e) => void change({ hiddenGraceSeconds: Number(e.target.value) })}>
                {HIDDEN_SECONDS.map((s) => <option key={s} value={s}>{s === 0 ? t('settings.lock.immediately') : t('settings.lock.seconds', { seconds: s })}</option>)}
              </select>
            </label>
            <p role="status" className="text-sm text-muted">{saved ? t('settings.saved') : ''}</p>
          </div>
        ) : null}
      </section>

      {settings ? <QuickUnlockSection enabled={settings.quickUnlock.enabled} onChange={reload} /> : null}

      <SyncSection />

      <section aria-labelledby="account-heading" className="mt-8">
        <h2 id="account-heading" className="text-lg font-semibold">{t('settings.account.title')}</h2>
        {core.account ? (
          <dl className="mt-2 grid max-w-md grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="font-medium">{t('signup.email.label')}</dt><dd className="break-all">{core.account.email}</dd>
            <dt className="font-medium">{t('signup.server.label')}</dt><dd className="break-all">{core.account.server}</dd>
            <dt className="font-medium">{t('settings.account.registration')}</dt><dd>{core.account.registration === 'done' ? t('settings.account.registered') : t('settings.account.pending')}</dd>
          </dl>
        ) : null}
      </section>

      <section aria-labelledby="kit-heading" className="mt-8">
        <h2 id="kit-heading" className="text-lg font-semibold">{t('settings.kit.title')}</h2>
        <p className="mt-1 text-muted">{t('settings.kit.lede')}</p>
        {kit ? (
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={secondaryButtonClass} onClick={() => downloadKit(kit)}>{t('secretkey.download')}</button>
            <button type="button" className={secondaryButtonClass} onClick={() => printKit(kit)}>{t('secretkey.print')}</button>
            <button type="button" className={secondaryButtonClass} onClick={() => setKit(undefined)}>{t('settings.kit.done')}</button>
          </div>
        ) : (
          <form onSubmit={exportKit} className="max-w-md">
            <TextField label={t('unlock.password.label')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={kitError} />
            <button type="submit" className={`${buttonClass} mt-4`}>{t('settings.kit.show')}</button>
          </form>
        )}
      </section>
    </main>
  );
}
