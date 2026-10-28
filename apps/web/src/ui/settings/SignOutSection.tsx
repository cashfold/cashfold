'use client';

import { useEffect, useState } from 'react';
import { SignOutDialogLazy } from '../auth/SignOutDialogLazy';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Button } from '../kit';

/** Settings → Profile and security: leaving the account on this device (spec 011, FR-001). It says what it is not, because Lock and Delete are next to it. */
export function SignOutSectionView({ t, onOpen }: { t: Translate; onOpen: () => void }) {
  return (
    <section aria-labelledby="signout-heading" className="mt-8">
      <h2 id="signout-heading" className="text-lg font-semibold">{t('signout.title')}</h2>
      <p className="mt-1 max-w-prose text-muted">{t('signout.lede')}</p>
      <Button outline className="mt-3" type="button" onClick={onOpen}>{t('signout.open')}</Button>
    </section>
  );
}

export function SignOutSection() {
  const { t } = useI18n();
  const core = useCore();
  const [open, setOpen] = useState(false);
  // Coming back from the backup page with `#sign-out` reopens the confirmation, as it was left (FR-008).
  useEffect(() => {
    if (window.location.hash === '#sign-out') setOpen(true);
  }, []);
  if (core.account === undefined) return null;
  return (
    <>
      <SignOutSectionView t={t} onOpen={() => setOpen(true)} />
      <SignOutDialogLazy open={open} onClose={() => setOpen(false)} email={core.account.email} kind={core.account.registration === 'done' ? 'service' : 'local'} locked={false} />
    </>
  );
}
