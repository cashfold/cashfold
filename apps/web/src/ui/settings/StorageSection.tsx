'use client';

import type { DeviceSettings } from '@cashfold/core';
import { useCallback, useEffect, useState } from 'react';
import { readPersistence, requestPersistence, type PersistenceState } from '../../adapters/storage-persistence';
import { useCore } from '../core/CoreProvider';

import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../kit';

const size = (bytes: number, locale: string): string => {
  const n = BigInt(Math.trunc(bytes));
  const mb = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return n < 1024n * 1024n ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number((n + 1023n) / 1024n))} KB` : n < 1024n ** 3n ? `${mb.format(Number((n * 10n) / (1024n * 1024n)) / 10)} MB` : `${mb.format(Number((n * 10n) / 1024n ** 3n) / 10)} GB`;
};

/** Whether the browser will keep this app's data, how much room it uses, and when the last backup was made (FR-072). */
export function StorageSection() {
  const { t, locale } = useI18n();
  const core = useCore();
  const [state, setState] = useState<PersistenceState | undefined>();
  const [lastBackup, setLastBackup] = useState(0);
  const [asked, setAsked] = useState(false);

  const load = useCallback(async () => {
    setState(await readPersistence());
    setLastBackup((await core.call<DeviceSettings>('settings.get')).lastBackupAtMs);
  }, [core]);
  useEffect(() => void load(), [load]);

  if (state === undefined) return null;
  return (
    <section aria-labelledby="storage-heading" className="mt-8">
      <h2 id="storage-heading" className="text-lg font-semibold">{t('storage.settings.title')}</h2>
      <p className="mt-1" data-testid="storage-state">{state.persisted === true ? t('storage.settings.kept') : state.persisted === false ? t('storage.settings.notKept') : t('storage.settings.unknown')}</p>
      {state.usageBytes !== undefined && state.quotaBytes !== undefined ? <p className="text-muted">{t('storage.settings.use', { used: size(state.usageBytes, locale), quota: size(state.quotaBytes, locale) })}</p> : null}
      <p className="text-muted">{lastBackup === 0 ? t('storage.settings.noBackup') : t('storage.settings.lastBackup', { when: new Date(lastBackup).toLocaleDateString(locale) })}</p>
      {state.persisted !== true ? (
        <div className="mt-3">
          <Button outline type="button" onClick={() => void requestPersistence().then((s) => (setState(s), setAsked(true)))}>{t('storage.settings.ask')}</Button>
          <p role="status" className="mt-1 text-sm text-muted">{asked ? t('storage.settings.asked') : ''}</p>
        </div>
      ) : null}
    </section>
  );
}
