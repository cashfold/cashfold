'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { UnlockForm } from '../ui/auth/UnlockForm';
import { useCore } from '../ui/core/CoreProvider';
import { useI18n } from '../ui/i18n/I18nProvider';

export default function Home() {
  const { t } = useI18n();
  const { phase } = useCore();
  const router = useRouter();
  useEffect(() => {
    if (phase === 'unlocked') router.replace('/overview/');
  }, [phase, router]);
  if (phase === 'locked') return <UnlockForm />;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('page.home.title')}</h1>
      <p className="mt-3 text-muted">{t('page.home.lede')}</p>
      <p className="mt-6" data-testid="phase" data-phase={phase}>
        {phase === 'no_account' ? <Link className="underline" href="/sign-up/">{t('gate.createAccount')}</Link> : null}
        {phase === 'unlocked' ? <Link className="underline" href="/overview/">{t('nav.overview')}</Link> : null}
      </p>
    </div>
  );
}
