'use client';

import { Select, SelectOption } from '../kit';
import { LANGUAGE_NAMES, SELECTABLE_LOCALES, type LanguageChoice } from './i18n';
import { useI18n } from './I18nProvider';

/**
 * The language choice as a select. Each language is written in its own language, so it can be found from a screen the person cannot read; only
 * "Automatic" is translated. Changing it applies at once and keeps the page and anything typed.
 */
export function LanguagePicker({ id, className }: { id?: string; className?: string }) {
  const { t, language, setLanguage } = useI18n();
  return (
    <Select
      {...(id === undefined ? {} : { id })} {...(className === undefined ? {} : { className })}
      aria-label={t('language.label')} value={language} onChange={(choice: LanguageChoice) => setLanguage(choice)}
    >
      <SelectOption value="auto">{t('language.auto')}</SelectOption>
      {SELECTABLE_LOCALES.map((locale) => (
        <SelectOption key={locale} value={locale}>{LANGUAGE_NAMES[locale]}</SelectOption>
      ))}
    </Select>
  );
}
