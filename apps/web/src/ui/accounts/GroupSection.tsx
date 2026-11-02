'use client';

import Link from 'next/link';
import { Fragment, useId, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Amount } from '../kit';
import { formatDate, localDateOfUtcSeconds } from '../ledger/dates';
import type { AccountSection } from './account-sections';

/** One group of accounts (or the accounts without a group): heading, exact subtotal (in the group's currency, or per currency when none is converted), actions, then the account list. */
export function GroupSectionView({ t, locale, section, actions, children }: {
  t: Translate; locale: string; section: AccountSection; actions?: ReactNode; children: ReactNode;
}) {
  const headingId = useId();
  const name = section.kind === 'group' ? section.group!.name : t('ledger.groups.ungrouped');
  const empty = section.accounts.length === 0;
  const converted = section.totals === 'unavailable' ? undefined : section.converted;
  return (
    <section className="mt-6" aria-labelledby={headingId} data-testid="account-section">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 *:min-w-0">
        <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold break-words">{name}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {empty ? null : (
            <p className="text-lg" data-testid="group-subtotal">
              <span className="sr-only">{t('ledger.groups.subtotal', { name })}: </span>
              {converted ? (
                converted.overflow && converted.subtotalMinor === null ? (
                  <span className="text-sm text-muted">{t('ledger.groups.tooLarge')}</span>
                ) : converted.subtotalMinor === null ? (
                  <span className="text-sm text-muted">{t('ledger.groups.noTotal', { currencies: converted.missing.join(', ') })}</span>
                ) : (
                  <span title={converted.ratesFrom === null ? undefined : t('ledger.groups.ratesFrom', { date: formatDate(localDateOfUtcSeconds(converted.ratesFrom), locale) })}>
                    <Amount minor={converted.subtotalMinor} currency={converted.currency} locale={locale} />
                  </span>
                )
              ) : section.totals === 'unavailable' || section.totals === undefined ? (
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
      {converted && converted.missing.length > 0 ? (
        <p role="status" className="mt-2 text-sm" data-testid="group-left-out">
          {t('ledger.groups.leftOut', { currencies: converted.missing.join(', ') })}{' '}
          <Link className="underline underline-offset-4" href="/settings/advanced/#adv-rates">{t('ledger.groups.enterRates')}</Link>
        </p>
      ) : null}
      {empty ? <p className="mt-2 text-muted">{t('ledger.groups.empty')}</p> : children}
    </section>
  );
}

export function GroupSection(props: Omit<Parameters<typeof GroupSectionView>[0], 't' | 'locale'>) {
  const { t, locale } = useI18n();
  return <GroupSectionView t={t} locale={locale} {...props} />;
}
