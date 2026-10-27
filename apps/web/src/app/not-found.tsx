'use client';

import Link from 'next/link';
import { useI18n } from '../ui/i18n/I18nProvider';

/**
 * What an address that is not part of the app shows (spec 009, FR-005). The static export turns it into /404.html, which the offline worker serves for
 * an unknown address, so with no connection a person sees this and not the browser's error page.
 */
export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-xl space-y-4 py-10">
      <h1 className="text-2xl font-semibold">{t('notfound.title')}</h1>
      <p>{t('notfound.lede')}</p>
      <Link href="/" className="inline-block rounded-lg border border-zinc-950/10 px-4 py-2 font-medium dark:border-white/15">{t('notfound.back')}</Link>
    </div>
  );
}
