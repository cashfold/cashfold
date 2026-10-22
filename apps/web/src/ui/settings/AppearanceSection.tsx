'use client';

import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, ConfirmDialog, Description, Field, Fieldset, Label, Legend, Radio, RadioField, RadioGroup, Switch, SwitchField, SwitchGroup } from '../kit';
import { optionalFieldsOf } from '../prefs/fields';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useStatus } from '../shell/StatusProvider';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeChoice } from '../theme/resolve-theme';

/** Settings → Appearance: the theme, which optional fields the add form shows by default, and a reset of the device's interface settings. */
export function AppearanceSection() {
  const { t } = useI18n();
  const { choice, setChoice } = useTheme();
  const optional = usePrefs((p) => p.optionalFields);
  const [resetting, setResetting] = useState(false);
  const status = useStatus();
  const fields = optionalFieldsOf('transaction');

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">{t('settings.group.appearance')}</h1>

      <Fieldset>
        <Legend>{t('settings.appearance.theme')}</Legend>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('settings.appearance.theme.description')}</p>
        <RadioGroup value={choice} onChange={(v) => setChoice(v as ThemeChoice)} className="mt-3">
          {(['light', 'dark', 'system'] as const).map((value) => (
            <RadioField key={value}>
              <Radio value={value} />
              <Label>{t(`settings.appearance.theme.${value}`)}</Label>
            </RadioField>
          ))}
        </RadioGroup>
      </Fieldset>

      <Fieldset>
        <Legend>{t('settings.appearance.fields')}</Legend>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('settings.appearance.fields.description')}</p>
        <SwitchGroup className="mt-3">
          {fields.map((f) => (
            <SwitchField key={f.id}>
              <Label>{t(`field.${f.id}`)}</Label>
              <Switch checked={optional[f.id] ?? f.defaultVisible} onChange={(on) => prefsStore.update((p) => ({ ...p, optionalFields: { ...p.optionalFields, [f.id]: on } }))} />
            </SwitchField>
          ))}
        </SwitchGroup>
      </Fieldset>

      <Field>
        <Label>{t('settings.appearance.reset')}</Label>
        <Description>{t('settings.appearance.reset.description')}</Description>
        <Button outline className="mt-3" onClick={() => setResetting(true)}>{t('settings.appearance.reset')}</Button>
      </Field>
      <ConfirmDialog
        open={resetting} title={t('settings.appearance.reset')} body={t('settings.appearance.reset.description')} confirmLabel={t('settings.appearance.reset.confirm')} cancelLabel={t('ledger.cancel')}
        onCancel={() => setResetting(false)} onConfirm={() => { prefsStore.reset(); setResetting(false); status.notify('status.saved'); }}
      />
    </div>
  );
}
