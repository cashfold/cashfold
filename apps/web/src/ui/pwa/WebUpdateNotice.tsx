'use client';

import { useI18n } from '../i18n/I18nProvider';
import { Button, Notice } from '../kit';
import { useDesktop } from '../desktop/useDesktop';
import { useUpdate } from './useUpdate';

/**
 * A quiet, dismissible note when a new version of the web app is ready (spec 009). Not a dialog, and it takes no focus. The person chooses when to
 * switch; the switch never happens over unsaved input. Never shown in the desktop app, which has its own updater and notice.
 */
export function WebUpdateNotice() {
  const { t } = useI18n();
  const { isDesktop } = useDesktop();
  const { state, update, dismiss } = useUpdate();
  if (isDesktop) return null;
  if (state.kind === 'restarting-elsewhere') return <Notice className="mb-4" data-testid="web-update-notice" title={t('update.elsewhere')} />;
  if (state.kind === 'applying') return <Notice className="mb-4" data-testid="web-update-notice" title={t('update.applying')} />;
  if (state.kind !== 'ready' && state.kind !== 'blocked') return null;
  return (
    <Notice
      className="mb-4"
      data-testid="web-update-notice"
      title={t('update.ready')}
      dismissLabel={t('update.dismiss')}
      onDismiss={dismiss}
      action={<Button plain type="button" data-testid="web-update-apply" onClick={update}>{t('update.apply')}</Button>}
    >
      {state.kind === 'blocked' ? t('update.blocked') : null}
    </Notice>
  );
}
