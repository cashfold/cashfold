'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/I18nProvider';
import { SETTINGS_GROUPS } from '../shell/routes';

/** The list of settings groups, each with one line saying what is in it. No form controls (FR-032). */
export function SettingsIndex() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('settings.index.title')}</h1>
      <ul className="mt-4 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10">
        {SETTINGS_GROUPS.map((group) => (
          <li key={group.id}>
            <Link href={group.href} className="block px-4 py-3 hover:bg-zinc-950/[0.03] dark:hover:bg-white/5">
              <span className="font-medium">{t(group.labelKey)}</span>
              <span className="block text-sm text-zinc-600 dark:text-zinc-400">{t(group.descriptionKey)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
