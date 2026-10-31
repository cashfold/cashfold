'use client';

import { useI18n } from '../i18n/I18nProvider';
import { EyeIcon, EyeSlashIcon, NavbarItem, SidebarItem, SidebarLabel } from '../kit';
import { usePrivacy } from './usePrivacy';

/** The state in words, so a person and a screen reader get the same sentence from either form of the control (spec 017, FR-003). */
function usePrivacySwitch() {
  const { t } = useI18n();
  const { on, toggle } = usePrivacy();
  const Icon = on ? EyeSlashIcon : EyeIcon;
  return { on, toggle, Icon, text: t(on ? 'privacy.switch.on' : 'privacy.switch.off') };
}

/** The sidebar footer item, in both states, in the sidebar and in the drawer. It holds no state of its own: it shows the preference and flips it (spec 017, FR-001). */
export function PrivacySidebarItem() {
  const { on, toggle, Icon, text } = usePrivacySwitch();
  return (
    <SidebarItem onClick={toggle} aria-pressed={on} data-testid="privacy-switch">
      <Icon data-slot="icon" aria-hidden="true" />
      <SidebarLabel>{text}</SidebarLabel>
    </SidebarItem>
  );
}

/** The icon-only copy for the narrow-window top bar, so the mode is one tap away without opening the drawer. */
export function PrivacyTopbarItem() {
  const { on, toggle, Icon, text } = usePrivacySwitch();
  return (
    <NavbarItem onClick={toggle} aria-pressed={on} aria-label={text} className="min-h-11 min-w-11 justify-center" data-testid="privacy-switch-topbar">
      <Icon aria-hidden="true" />
    </NavbarItem>
  );
}
