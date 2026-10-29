'use client';

import { Fragment, useId, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Amount } from '../kit';
import type { AccountSection } from './account-sections';

/** One group of accounts (or the accounts without a group): heading, exact subtotal per currency, actions, then the account list. */
export function GroupSectionView({ t, locale, section, actions, children }: {
  t: Translate; locale: string; section: AccountSection; actions?: ReactNode; children: ReactNode;
}) {
  const headingId = useId();
  const name = section.kind === 'group' ? section.group!.name : t('ledger.groups.ungrouped');
  const empty = section.accounts.length === 0;
  return (
    <section className="mt-6" aria-labelledby={headingId} data-testid="account-section">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 *:min-w-0">
        <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold break-words">{name}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {empty ? null : (
            <p className="text-lg" data-testid="group-subtotal">
              <span className="sr-only">{t('ledger.groups.subtotal', { name })}: </span>
              {section.totals === 'unavailable' || section.totals === undefined ? (
                <span className="text-sm text-muted">{t('ledger.groups.subtotalUnavailable')}</span>
              ) : (
                section.totals.map((total, i) => (
                  <Fragment key={total.currency}>
                    {i > 0 ? <span aria-hidden="true"> · </span> : null}
                    {i > 0 ? <span className="sr-only">, </span> : null}
                    <Amount minor={total.minor} currency={total.currency} locale={locale} />
                  </Fragment>
                ))
              )}
            </p>
          )}
          {section.kind === 'group' ? actions : null}
        </div>
      </div>
      {empty ? <p className="mt-2 text-muted">{t('ledger.groups.empty')}</p> : children}
    </section>
  );
}

export function GroupSection(props: Omit<Parameters<typeof GroupSectionView>[0], 't' | 'locale'>) {
  const { t, locale } = useI18n();
  return <GroupSectionView t={t} locale={locale} {...props} />;
}
