'use client';

import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';

/** Placeholder body for routes whose screens arrive with their user story. */
export function Page({ titleKey, lede }: { titleKey: string; lede?: string }) {
  const { t } = useI18n();
  const core = useCore();
  return (
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="mt-3 text-muted">{lede ? t(lede) : t('page.soon')}</p>
      <p className="mt-3 text-muted" data-testid="phase">{core.phase}</p>
    </main>
  );
}
