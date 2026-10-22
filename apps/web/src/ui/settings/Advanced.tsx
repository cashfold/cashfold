'use client';

import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { RateManager } from '../ledger/transfer/RateManager';
import { AboutSection } from './AboutSection';
import { DescriptionList, DescriptionDetails, DescriptionTerm, Text } from '../kit';

/** Settings → Advanced: things most people never change, each with a sentence on when to. */
export function Advanced() {
  const { t } = useI18n();
  const core = useCore();
  return (
    <LedgerFrame titleKey="settings.group.advanced">
      <section aria-labelledby="adv-server" className="mt-6">
        <h2 id="adv-server" className="text-lg font-semibold">{t('signup.server.label')}</h2>
        <Text>{t('settings.advanced.server.when')}</Text>
        {core.account ? (
          <DescriptionList className="mt-3">
            <DescriptionTerm>{t('signup.server.label')}</DescriptionTerm>
            <DescriptionDetails className="break-all">{core.account.server}</DescriptionDetails>
          </DescriptionList>
        ) : null}
      </section>
      <section aria-labelledby="adv-rates" className="mt-10">
        <h2 id="adv-rates" className="text-lg font-semibold">{t('settings.advanced.rates')}</h2>
        <Text>{t('settings.advanced.rates.when')}</Text>
        <RateManager />
      </section>
      <AboutSection />
    </LedgerFrame>
  );
}
