'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Notice } from '../kit';
import { prefsStore, usePrefs } from '../prefs/usePrefs';

/** A one-time hint of at most two sentences (FR-038). It never blocks input, can be dismissed, and once dismissed does not come back. */
export function Hint({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  const dismissed = usePrefs((p) => p.hints.dismissed.includes(id));
  if (dismissed) return null;
  return (
    <Notice
      {...(className === undefined ? {} : { className })} data-testid={`hint-${id}`}
      action={<Button plain onClick={() => prefsStore.update((p) => (p.hints.dismissed.includes(id) ? p : { ...p, hints: { dismissed: [...p.hints.dismissed, id].slice(-32) } }))}>{t('hint.dismiss')}</Button>}
    >
      {children}
    </Notice>
  );
}
