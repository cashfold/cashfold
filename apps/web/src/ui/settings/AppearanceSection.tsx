'use client';

import { lazy, Suspense, useState } from 'react';
import { LanguagePicker } from '../i18n/LanguagePicker';
import { useI18n } from '../i18n/I18nProvider';
import { Button, ConfirmDialog, Description, Field, Fieldset, Label, Legend, Radio, RadioField, RadioGroup, Switch, SwitchField, SwitchGroup } from '../kit';
import { optionalFieldsOf } from '../prefs/fields';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useStatus } from '../shell/StatusProvider';
import { PALETTE, colorOf, type PrimaryChoice } from '../theme/palette';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeChoice } from '../theme/resolve-theme';

// The privacy settings are their own chunk, so they are not part of the JavaScript every page loads up front.
const PrivacySection = lazy(() => import('../privacy/PrivacySection').then((module) => ({ default: module.PrivacySection })));

/** Settings → Appearance: the theme, which optional fields the add form shows by default, and a reset of the device's interface settings. */
export function AppearanceSection() {
  const { t } = useI18n();
  const { choice, setChoice, primary, setPrimary, resolved } = useTheme();
  const optional = usePrefs((p) => p.optionalFields);
  const [resetting, setResetting] = useState(false);
  const status = useStatus();
  const fields = optionalFieldsOf('transaction');

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">{t('settings.group.appearance')}</h1>

      <Field>
        <Label>{t('language.label')}</Label>
        <Description>{t('settings.appearance.language.description')}</Description>
        <LanguagePicker className="mt-3 max-w-xs" />
      </Field>

      <Suspense fallback={null}><PrivacySection /></Suspense>

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
        <Legend>{t('settings.appearance.primary')}</Legend>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('settings.appearance.primary.description')}</p>
        <RadioGroup value={primary} onChange={(v) => setPrimary(v as PrimaryChoice)} className="mt-3">
          {PALETTE.map((c) => (
            <RadioField key={c.id}>
              <Radio value={c.id} />
              <Label>
                <span aria-hidden className="me-2 inline-block size-3 rounded-full align-middle ring-1 ring-(--border-strong)" ref={(el) => { if (el) el.style.backgroundColor = colorOf(c.id)[resolved].primary; }} />
                {t(`settings.appearance.primary.${c.id}`)}
                {c.id === 'emerald' ? <span className="ms-1 text-(--text-muted)">({t('settings.appearance.primary.default')})</span> : null}
              </Label>
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
