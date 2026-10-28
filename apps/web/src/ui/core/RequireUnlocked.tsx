'use client';

import type { ReactNode } from 'react';
import { SignedOutChoicesLazy } from '../auth/SignedOutChoicesLazy';
import { UnlockForm } from '../auth/UnlockForm';
import { useI18n } from '../i18n/I18nProvider';
import { useCore } from './CoreProvider';

/** Shows its children only when the app is unlocked; otherwise the right way in. Never renders financial content while locked. */
export function RequireUnlocked({ children, titleKey }: { children: ReactNode; titleKey: string }) {
  const { phase } = useCore();
  const { t } = useI18n();
  if (phase === 'unlocked') return <>{children}</>;
  if (phase === 'locked') return <UnlockForm />;
  if (phase === 'no_account') {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        <p className="mt-3">{t('gate.noAccount')}</p>
        <SignedOutChoicesLazy />
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="mt-3" role={phase === 'failed' ? 'alert' : 'status'}>{phase === 'failed' ? t('gate.failed') : t('loading')}</p>
    </div>
  );
}
