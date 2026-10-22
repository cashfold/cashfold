'use client';

import type { DeviceSettings } from '@cashfold/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';

import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../kit';

/** A quiet reminder to keep the Emergency Kit somewhere safe, until the user dismisses it. */
export function KitReminder() {
  const { t } = useI18n();
  const core = useCore();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (core.phase === 'unlocked') void core.call<DeviceSettings>('settings.get').then((s) => setShow(!s.kitReminderDismissed)).catch(() => undefined);
  }, [core]);
  if (!show || core.phase !== 'unlocked') return null;
  return (
    <aside aria-label={t('kit.reminder.label')} className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-950/10 bg-zinc-950/[0.03] p-4 dark:border-white/10 dark:bg-white/5">
      <p className="flex-1">{t('kit.reminder.text')} <Link className="underline" href="/settings/">{t('nav.settings')}</Link></p>
      <Button outline type="button" onClick={() => void core.call('settings.set', { kitReminderDismissed: true }).then(() => setShow(false))}>{t('kit.reminder.dismiss')}</Button>
    </aside>
  );
}
