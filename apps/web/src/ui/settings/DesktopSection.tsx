'use client';

import type { Capabilities, DesktopSettings, SettingsUpdate } from '@cashfold/platform';
import { useState } from 'react';
import { useDesktop } from '../desktop/DesktopSettingsProvider';
import { useI18n } from '../i18n/I18nProvider';
import { Description, Label, Radio, RadioField, RadioGroup, Switch, SwitchField, SwitchGroup, Text } from '../kit';

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
  /** Resolves with the shell's answer, which says whether start at login could be applied. */
  readonly update: (change: SettingsUpdate) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [loginFailed, setLoginFailed] = useState(false);
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

      {capabilities?.loginItem === false ? null : (
        <SwitchGroup>
          <SwitchField>
            <Label>{t('settings.desktop.startAtLogin')}</Label>
            <Description>{t('settings.desktop.startAtLogin.description')}</Description>
            <Switch
              checked={settings.startAtLogin}
              data-testid="desktop-start-at-login"
              onChange={(on) => {
                setLoginFailed(false);
                void update({ startAtLogin: on }).then((applied) => {
                  // The choice is kept whatever the system said; this says whether the system took it.
                  if ((applied as { startAtLogin?: boolean } | undefined)?.startAtLogin === false) setLoginFailed(true);
                });
              }}
            />
          </SwitchField>
          {loginFailed ? <Text role="alert" data-testid="desktop-start-at-login-failed">{t('settings.desktop.startAtLogin.failed')}</Text> : null}
        </SwitchGroup>
      )}

      <section aria-labelledby="desktop-close">
        <h2 id="desktop-close" className="text-lg font-semibold">{t('settings.desktop.close.title')}</h2>
        <Text>{t('settings.desktop.close.description')}</Text>
        {capabilities?.statusItem === true ? (
          <RadioGroup className="mt-2" value={settings.closeBehavior} aria-label={t('settings.desktop.close.title')} onChange={(value) => void update({ closeBehavior: value as DesktopSettings['closeBehavior'] })}>
            <RadioField><Radio value="quit" data-testid="desktop-close-quit" /><Label>{t('settings.desktop.close.quit')}</Label></RadioField>
            <RadioField><Radio value="background" data-testid="desktop-close-background" /><Label>{t('settings.desktop.close.background')}</Label></RadioField>
          </RadioGroup>
        ) : (
          <Text className="mt-2" data-testid="desktop-close-unavailable">{t('settings.desktop.close.unavailable')}</Text>
        )}
        <Text className="mt-2">{t('settings.desktop.reminders.note')}</Text>
      </section>

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
