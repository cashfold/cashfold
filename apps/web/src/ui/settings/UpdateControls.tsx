'use client';

import type { AboutInfo } from '@cashfold/platform';
import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Description, Label, Link, Progress, Switch, SwitchField, SwitchGroup, Text } from '../kit';
import { describeUpdate, restartAndUpdate } from './update-view';
import { useDesktopUpdates } from './useDesktopUpdates';

/**
 * The update section of the desktop app's About view. Updates are the person's call at every step: look, download, restart. A copy that
 * cannot update itself (deb, rpm, an unsigned Mac app) is told how to update by hand instead. Hidden in the web app.
 */
export function UpdateControls({ info }: { readonly info: AboutInfo }) {
  const { t } = useI18n();
  const core = useCore();
  const { bridge, state, setState } = useDesktopUpdates();
  const [auto, setAuto] = useState<boolean | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bridge === undefined) return;
    let live = true;
    void bridge.updates.autoCheck().then((on) => live && setAuto(on));
    return () => {
      live = false;
    };
  }, [bridge]);

  if (bridge === undefined) return null;
  const view = describeUpdate(state, info.packaging);
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch {
      /* the flow reports its own failures as states; a refused step needs no extra message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="update-heading" className="mt-10" data-testid="update-controls">
      <h2 id="update-heading" className="text-lg font-semibold">{t('settings.update.title')}</h2>
      <p role="status" aria-live="polite" className="mt-2" data-testid="update-message" data-update-state={state.kind}>{t(view.messageKey, view.params)}</p>
      {state.kind === 'downloading' ? (
        <Progress className="mt-3" value={state.percent} max={100} label={t('settings.update.downloading.label')} statusText={`${state.percent}%`} />
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        {view.actions.includes('check') ? (
          <Button outline type="button" disabled={busy} data-testid="update-check" onClick={() => void run(async () => setState(await bridge.updates.check()))}>{t('settings.update.check')}</Button>
        ) : null}
        {view.actions.includes('download') ? (
          <Button type="button" disabled={busy} data-testid="update-download" onClick={() => void run(async () => setState(await bridge.updates.download()))}>{t('settings.update.download')}</Button>
        ) : null}
        {view.actions.includes('notes') && state.kind === 'available' ? (
          <Link href={state.notesUrl} target="_blank" rel="noopener noreferrer" className="self-center underline">{t('settings.update.notes')}</Link>
        ) : null}
        {view.actions.includes('releasePage') ? (
          <Button type="button" disabled={busy} data-testid="update-release-page" onClick={() => void run(() => bridge.updates.openReleasePage())}>{t('settings.update.releasePage')}</Button>
        ) : null}
        {view.actions.includes('install') ? (
          <Button
            type="button"
            disabled={busy}
            data-testid="update-install"
            onClick={() =>
              void run(() =>
                restartAndUpdate({
                  lock: () => core.lock(),
                  locked: () =>
                    new Promise<void>((resolve) => {
                      const stop = core.subscribe((event) => {
                        if (event.type !== 'Locked') return;
                        stop();
                        resolve();
                      });
                    }),
                  install: () => bridge.updates.install(),
                }),
              )
            }
          >
            {t('settings.update.install')}
          </Button>
        ) : null}
      </div>
      <SwitchGroup className="mt-6">
        <SwitchField>
          <Label>{t('settings.update.auto')}</Label>
          <Description>{t('settings.update.auto.description')}</Description>
          <Switch
            checked={auto ?? true}
            disabled={auto === undefined}
            data-testid="update-auto"
            onChange={(on) => {
              setAuto(on);
              void bridge.updates.setAutoCheck(on).catch(() => setAuto(!on));
            }}
          />
        </SwitchField>
      </SwitchGroup>
      <Text className="mt-2">{t('settings.update.consent')}</Text>
    </section>
  );
}
