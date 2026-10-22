'use client';

import { useI18n } from '../i18n/I18nProvider';

/** Opaque cover shown whenever the window is hidden or unfocused, so no financial content shows in app switchers or screenshots (FR-007). */
export function PrivacyCover() {
  const { t } = useI18n();
  return (
    <div role="alert" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6 text-center dark:bg-zinc-950" data-testid="privacy-cover">
      <p className="text-xl font-semibold">{t('cover.title')}</p>
      <p className="mt-2 max-w-prose text-zinc-600 dark:text-zinc-400">{t('cover.detail')}</p>
    </div>
  );
}
