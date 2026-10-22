'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { formatError } from '../errors/catalogue';
import { Button } from '../kit';
import { useI18n } from '../i18n/I18nProvider';
import { detectBrowserSupport, type SupportResult } from './detect';

/** Renders the app only in a browser that has what it needs; otherwise explains what is missing. */
export function SupportGate({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<SupportResult | null>(null);
  useEffect(() => setResult(detectBrowserSupport()), []);

  if (result === null) return null;
  if (result.supported) return <>{children}</>;
  const first = result.missing[0] ?? 'opfs';
  return (
    <main id="main" className="mx-auto max-w-prose p-6">
      <h1 className="text-2xl font-semibold">{t('support.title')}</h1>
      <p className="mt-3">{t('support.detail')}</p>
      <p className="mt-3 text-danger" role="alert">{formatError({ kind: 'UnsupportedBrowser', feature: first }, locale)}</p>
      <Button className="mt-4" type="button" onClick={() => location.reload()}>
        {t('support.reload')}
      </Button>
    </main>
  );
}
