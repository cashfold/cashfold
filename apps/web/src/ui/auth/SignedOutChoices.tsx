'use client';

import Link from 'next/link';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Button } from '../kit';

/** The three ways in on a device with no account (spec 011, FR-010). It names nothing of the account that was here before. */
export function SignedOutChoicesView({ t, notice, onDismissNotice }: { t: Translate; notice: { readonly deviceStillListed: boolean } | undefined; onDismissNotice: () => void }) {
  return (
    <section aria-labelledby="signed-out-heading" className="mt-6">
      <h2 id="signed-out-heading" className="text-lg font-semibold">{t('signedout.title')}</h2>
      {notice?.deviceStillListed === true ? (
        <div role="status" className="mt-3 max-w-prose" data-testid="signout-listed">
          <p>{t('signout.listed')}</p>
          <Button plain className="mt-1" type="button" onClick={onDismissNotice}>{t('ledger.close')}</Button>
        </div>
      ) : null}
      <ul className="mt-3 grid gap-2">
        <li><Link className="underline" href="/sign-up/">{t('signedout.create')}</Link></li>
        <li><Link className="underline" href="/add/">{t('signedout.signin')}</Link></li>
        <li><Link className="underline" href="/recover/">{t('signedout.recover')}</Link></li>
      </ul>
    </section>
  );
}

export function SignedOutChoices() {
  const { t } = useI18n();
  const core = useCore();
  return <SignedOutChoicesView t={t} notice={core.signedOutNotice} onDismissNotice={core.dismissSignedOutNotice} />;
}
