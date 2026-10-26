'use client';

import type { Capabilities, DesktopSettings, SettingsUpdate } from '@cashfold/platform';
import { useDesktop } from '../desktop/DesktopSettingsProvider';
import { useI18n } from '../i18n/I18nProvider';
import { Description, Label, Switch, SwitchField, SwitchGroup, Text } from '../kit';

/** Settings → Desktop: how the desktop app behaves on this computer. Only reachable in the desktop app. */
export function DesktopSection() {
  const { isDesktop, settings, capabilities, update } = useDesktop();
  return isDesktop ? <DesktopSectionBody settings={settings} capabilities={capabilities} update={update} /> : null;
}

export function DesktopSectionBody({
  settings,
  capabilities,
  update,
}: {
  readonly settings: DesktopSettings;
  readonly capabilities: Capabilities | undefined;
  readonly update: (change: SettingsUpdate) => Promise<unknown>;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">{t('settings.group.desktop')}</h1>

      <SwitchGroup>
        <SwitchField>
          <Label>{t('settings.desktop.hideOnBlur')}</Label>
          <Description>{t('settings.desktop.hideOnBlur.description')}</Description>
          <Switch checked={settings.hideOnBlur} data-testid="desktop-hide-on-blur" onChange={(on) => void update({ hideOnBlur: on })} />
        </SwitchField>
      </SwitchGroup>

      <section aria-labelledby="desktop-locks">
        <h2 id="desktop-locks" className="text-lg font-semibold">{t('settings.desktop.locks.title')}</h2>
        <Text>{t('settings.desktop.locks.description')}</Text>
        <ul className="mt-2 list-disc ps-6" data-testid="desktop-lock-events">
          {(capabilities?.lockEvents ?? []).map((reason) => (
            <li key={reason}>{t(`settings.desktop.locks.${reason}`)}</li>
          ))}
        </ul>
        <Text className="mt-2">{t('settings.desktop.locks.idle')}</Text>
      </section>
    </div>
  );
}
