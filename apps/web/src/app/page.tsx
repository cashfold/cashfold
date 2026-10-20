'use client';

import Link from 'next/link';
import { UnlockForm } from '../ui/auth/UnlockForm';
import { useCore } from '../ui/core/CoreProvider';
import { useI18n } from '../ui/i18n/I18nProvider';

export default function Home() {
  const { t } = useI18n();
  const { phase } = useCore();
  if (phase === 'locked') return <UnlockForm />;
  return (
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t('page.home.title')}</h1>
      <p className="mt-3 text-muted">{t('page.home.lede')}</p>
      <p className="mt-6" data-testid="phase" data-phase={phase}>
        {phase === 'no_account' ? <Link className="underline" href="/sign-up/">{t('gate.createAccount')}</Link> : null}
        {phase === 'unlocked' ? <Link className="underline" href="/folds/">{t('nav.folds')}</Link> : null}
      </p>
    </main>
  );
}
