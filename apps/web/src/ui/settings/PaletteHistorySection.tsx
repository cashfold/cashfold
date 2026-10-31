'use client';

import { useState } from 'react';
import type { Translate } from '../i18n/i18n';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../kit';
import { paletteHistory } from '../palette/history';

/** Settings → Data and storage: forgetting what the command palette remembers on this device (spec 015, FR-012). It says what it does and what it leaves alone. */
export function PaletteHistorySectionView({ t, cleared, onClear }: { t: Translate; cleared: boolean; onClear: () => void }) {
  return (
    <section aria-labelledby="palette-history-heading" className="mt-8">
      <h2 id="palette-history-heading" className="text-lg font-semibold">{t('palette.history.heading')}</h2>
      <p className="mt-1 max-w-prose text-muted">{t('palette.history.description')}</p>
      <Button outline className="mt-3" type="button" onClick={onClear} data-testid="palette-history-clear">{t('palette.history.clear')}</Button>
      <p role="status" className="mt-1 text-sm text-muted">{cleared ? t('palette.history.cleared') : ''}</p>
    </section>
  );
}

export function PaletteHistorySection() {
  const { t } = useI18n();
  const [cleared, setCleared] = useState(false);
  return (
    <PaletteHistorySectionView
      t={t}
      cleared={cleared}
      onClear={() => {
        paletteHistory.clear();
        setCleared(true);
      }}
    />
  );
}
