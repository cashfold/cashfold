'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useCore } from '../core/CoreProvider';
import { Button, Notice } from '../kit';
import { useDesktopUpdates } from '../settings/useDesktopUpdates';

/**
 * A quiet, dismissible note in the desktop app when a new version is available or ready. It is not a dialog and does not take focus; it
 * points to Settings, where the choices are. Only for a version the person has not dismissed yet. Never shown in the web app.
 * Settings need an account, so before sign-in (no account yet, or locked) the note offers the release page instead of a link that would lead nowhere.
 */
export function UpdateNotice() {
  const { t } = useI18n();
  const core = useCore();
  const { bridge, state } = useDesktopUpdates();
  const [dismissed, setDismissed] = useState<string | undefined>();
  if (bridge === undefined || (state.kind !== 'available' && state.kind !== 'ready')) return null;
  if (dismissed === state.version) return null;
  return (
    <Notice
      className="mb-4"
      data-testid="update-notice"
      title={state.kind === 'ready' ? t('shell.update.ready', { version: state.version }) : t('shell.update.available', { version: state.version })}
      dismissLabel={t('shell.update.dismiss')}
      onDismiss={() => setDismissed(state.version)}
      action={
        core.phase === 'unlocked' ? (
          <Link className="underline" href="/settings/advanced/">{t('shell.update.details')}</Link>
        ) : (
          <Button plain type="button" data-testid="update-notice-release-page" onClick={() => void bridge.updates.openReleasePage().catch(() => undefined)}>{t('settings.update.releasePage')}</Button>
        )
      }
    />
  );
}
