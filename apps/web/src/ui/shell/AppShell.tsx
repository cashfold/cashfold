'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCore } from '../core/CoreProvider';
import { buttonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { SyncIndicator } from '../sync/SyncIndicator';
import { PrivacyCover } from './PrivacyCover';

const NAV = [
  ['/dashboard/', 'nav.dashboard'],
  ['/accounts/', 'nav.accounts'],
  ['/transactions/', 'nav.transactions'],
  ['/transfers/', 'nav.transfers'],
  ['/categories/', 'nav.categories'],
  ['/folds/', 'nav.folds'],
  ['/devices/', 'nav.devices'],
  ['/settings/', 'nav.settings'],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const core = useCore();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded-ui focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary">
        {t('skip.main')}
      </a>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border-strong bg-surface px-4 py-3">
        <Link href="/" className="text-lg font-semibold">{t('app.name')}</Link>
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {NAV.map(([href, key]) => (
              <li key={href}>
                <Link href={href} className="underline-offset-4 hover:underline">{t(key)}</Link>
              </li>
            ))}
          </ul>
        </nav>
        {core.phase === 'unlocked' ? <SyncIndicator /> : null}
        {core.phase === 'unlocked' ? (
          <button type="button" className={`${buttonClass} ms-auto`} onClick={() => core.lock()}>{t('lock.button')}</button>
        ) : null}
      </header>
      {core.covered ? <PrivacyCover /> : null}
      <div className="mx-auto max-w-4xl p-4" inert={core.covered}>{children}</div>
    </>
  );
}
