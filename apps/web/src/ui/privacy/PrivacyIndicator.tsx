'use client';

import { useI18n } from '../i18n/I18nProvider';
import { EyeSlashIcon, SidebarItem, SidebarLabel } from '../kit';
import { usePrivacy } from './usePrivacy';

/** Shown in the sidebar while Privacy mode is on, in words as well as an icon; activating it turns the mode off (spec 016, FR-011). Nothing while it is off. */
export function PrivacyIndicator() {
  const { t } = useI18n();
  const { on, toggle } = usePrivacy();
  if (!on) return null;
  return (
    <SidebarItem onClick={toggle} aria-pressed="true" title={t('privacy.indicator.hint')} data-testid="privacy-indicator">
      <EyeSlashIcon data-slot="icon" aria-hidden="true" />
      <SidebarLabel>{t('privacy.indicator.on')}</SidebarLabel>
    </SidebarItem>
  );
}
