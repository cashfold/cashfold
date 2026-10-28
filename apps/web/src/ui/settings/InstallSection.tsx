'use client';

import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Text } from '../kit';
import type { StepsKind } from '../pwa/install-state';
import { useInstall } from '../pwa/useInstall';

const STEP_COUNT: Record<StepsKind, number> = { 'ios-safari': 3, 'ios-other': 3, 'mac-safari': 2 };

/**
 * Settings → Install (spec 009): installs the web app where the browser lets a button do it, and gives the steps where it does not. It says nothing
 * where installing is not possible, and it is never advertised anywhere else.
 */
export function InstallSection() {
  const { t } = useI18n();
  const { state, install } = useInstall();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('install.title')}</h1>
      <Text>{t('install.lede')}</Text>
      {state.kind === 'promptable' ? (
        <Button type="button" disabled={busy} data-testid="install-button" onClick={async () => { setBusy(true); try { await install(); } finally { setBusy(false); } }}>{t('install.button')}</Button>
      ) : null}
      {state.kind === 'steps' ? (
        <section aria-labelledby="install-steps">
          <h2 id="install-steps" className="text-lg font-semibold">{t('install.steps.heading')}</h2>
          <ol className="mt-2 list-decimal space-y-1 ps-6" data-testid="install-steps">
            {Array.from({ length: STEP_COUNT[state.steps] }, (_, i) => <li key={i}>{t(`install.steps.${state.steps}.${i + 1}`)}</li>)}
          </ol>
        </section>
      ) : null}
      {state.kind === 'installed-in-tab' ? <p role="status" data-testid="install-done">{t('install.done')}</p> : null}
    </div>
  );
}
