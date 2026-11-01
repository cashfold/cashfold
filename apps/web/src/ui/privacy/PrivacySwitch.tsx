'use client';

import { useI18n } from '../i18n/I18nProvider';
import { EyeIcon, EyeSlashIcon, Field, Label, NavbarItem, Switch } from '../kit';
import { usePrivacy } from './usePrivacy';

/** The state in words, so a person and a screen reader get the same sentence from either form of the control (spec 017, FR-003). */
function usePrivacySwitch() {
  const { t } = useI18n();
  const { on, toggle } = usePrivacy();
  const Icon = on ? EyeSlashIcon : EyeIcon;
  return { on, toggle, Icon, text: t(on ? 'privacy.switch.on' : 'privacy.switch.off') };
}

/** The sidebar footer row: an icon, the name and a switch, in the sidebar and in the drawer. It holds no state of its own: the switch shows the preference and flips it (spec 017, FR-001). */
export function PrivacySidebarItem() {
  const { t } = useI18n();
  const { on, toggle, Icon } = usePrivacySwitch();
  return (
    <Field className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 sm:py-2 [&>[data-slot=control]]:mt-0!">
      <Icon className="size-6 shrink-0 fill-zinc-500 sm:size-5 dark:fill-zinc-400" aria-hidden="true" />
      <Label className="min-w-0 flex-1 truncate font-medium">{t('privacy.switch.label')}</Label>
      <Switch checked={on} onChange={toggle} data-testid="privacy-switch" />
    </Field>
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
