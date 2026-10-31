'use client';

import { useState } from 'react';
import { allowAmounts, amountsAllowed } from '../../adapters/notifications/browser';
import { useI18n } from '../i18n/I18nProvider';
import { Description, Label, Switch, SwitchField, SwitchGroup } from '../kit';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { effectiveNotificationDetails } from './notification-details';
import { usePrivacy } from './usePrivacy';

const selectDetails = (p: { notificationDetails: 'auto' | 'on' | 'off' }) => p.notificationDetails;

/**
 * Settings → Appearance → Privacy (spec 016): the Privacy mode switch, with a plain description of what it hides and what it leaves alone. Both choices on
 * this page belong to this device: they are in the interface preferences, never synced, and signing out keeps them.
 */
export function PrivacySection() {
  const { t } = useI18n();
  const { on, toggle } = usePrivacy();
  const choice = usePrefs(selectDetails);
  // The older show-amounts choice is its own device flag; it is the second level under details.
  const [amounts, setAmounts] = useState(amountsAllowed());
  const details = effectiveNotificationDetails(choice, amounts);
  return (
    <section aria-labelledby="privacy-heading" className="space-y-6">
      <h2 id="privacy-heading" className="text-lg font-semibold">{t('privacy.heading')}</h2>
      <SwitchGroup>
        <SwitchField>
          <Label>{t('privacy.mode.title')}</Label>
          <Description>{t('privacy.mode.description')}</Description>
          <Switch checked={on} onChange={() => toggle()} data-testid="privacy-mode-switch" />
        </SwitchField>
      </SwitchGroup>
      <SwitchGroup>
        <SwitchField>
          <Label>{t('privacy.notify.details')}</Label>
          <Description>{t('privacy.notify.details.hint')}</Description>
          <Switch checked={details} onChange={(checked) => prefsStore.update((p) => ({ ...p, notificationDetails: checked ? 'on' : 'off' }))} data-testid="notify-details-switch" />
        </SwitchField>
        {details ? (
          <SwitchField>
            <Label>{t('privacy.notify.amounts')}</Label>
            <Description>{t('schedules.notify.amounts.hint')}</Description>
            <Switch checked={amounts} onChange={(checked) => { setAmounts(checked); allowAmounts(checked); }} data-testid="notify-amounts-switch" />
          </SwitchField>
        ) : null}
      </SwitchGroup>
    </section>
  );
}
