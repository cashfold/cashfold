'use client';

import { Select } from '../kit';
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
      name="language" aria-label={t('language.label')} value={language} onChange={(e) => setLanguage(e.target.value as LanguageChoice)}
    >
      <option value="auto">{t('language.auto')}</option>
      {SELECTABLE_LOCALES.map((locale) => (
        <option key={locale} value={locale} lang={locale}>{LANGUAGE_NAMES[locale]}</option>
      ))}
    </Select>
  );
}
