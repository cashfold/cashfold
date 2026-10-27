'use client';

import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { STATUS_MS, StatusRegion, type StatusItem } from '../shell/StatusProvider';
import { carriesFiles, isFileInput } from './drop-events';

/**
 * In both shells, in the desktop app: a file dropped anywhere never opens in the window (the default is always cancelled), and while the app is locked,
 * or before sign-in, the drop is ignored with a message. The unlocked shell's DropTarget does the work when there is a session.
 */
export default function DropGuard() {
  const core = useCore();
  const { t } = useI18n();
  const [shown, setShown] = useState<StatusItem | undefined>();
  const unlocked = core.phase === 'unlocked';

  useEffect(() => {
    const over = (event: DragEvent) => {
      if (carriesFiles(event) && !isFileInput(event.target)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event) || isFileInput(event.target)) return;
      event.preventDefault();
      if (!unlocked) setShown({ id: Date.now(), message: t('desktop.drop.locked') });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [unlocked, t]);

  useEffect(() => {
    if (shown === undefined) return;
    const timer = setTimeout(() => setShown(undefined), STATUS_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return shown === undefined ? null : <StatusRegion items={[shown]} dismissLabel={t('status.dismiss')} onDismiss={() => setShown(undefined)} />;
}
