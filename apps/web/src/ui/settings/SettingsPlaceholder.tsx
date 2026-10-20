'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/I18nProvider';

// Interim page for a settings group whose content arrives with its user story (Appearance with US1/US5, Advanced with US7).
export function SettingsPlaceholder({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">{t('page.soon')}</p>
      <p className="mt-3"><Link className="underline" href="/settings/">{t('nav.settings')}</Link></p>
    </div>
  );
}
