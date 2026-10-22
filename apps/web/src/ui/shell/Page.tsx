'use client';

import { RequireUnlocked } from '../core/RequireUnlocked';
import { useI18n } from '../i18n/I18nProvider';

/** Placeholder body for routes whose screens arrive with their user story. Needs an unlocked app. */
export function Page({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <RequireUnlocked titleKey={titleKey}>
      <div>
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        <p className="mt-3 text-muted">{t('page.soon')}</p>
      </div>
    </RequireUnlocked>
  );
}
