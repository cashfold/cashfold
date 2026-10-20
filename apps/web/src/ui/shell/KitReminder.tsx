'use client';

import type { DeviceSettings } from '@cashfold/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

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
    <aside aria-label={t('kit.reminder.label')} className="mb-4 flex flex-wrap items-center gap-3 rounded-ui border border-border-strong bg-surface p-3">
      <p className="flex-1">{t('kit.reminder.text')} <Link className="underline" href="/settings/">{t('nav.settings')}</Link></p>
      <button type="button" className={secondaryButtonClass} onClick={() => void core.call('settings.set', { kitReminderDismissed: true }).then(() => setShow(false))}>{t('kit.reminder.dismiss')}</button>
    </aside>
  );
}
