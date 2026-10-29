'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';

/** What replaces the sharing controls while the account is kept only on this device (spec 010, FR-007b). The controls point at it with `aria-describedby`. */
export function RelayNeededView({ t, id }: { t: Translate; id: string }) {
  return (
    <p id={id} className="text-sm text-muted" data-testid="relay-needed">
      {t('sharing.relayNeeded')} <Link className="underline" href="/settings/sync/">{t('sharing.relayNeeded.link')}</Link>
    </p>
  );
}

export function RelayNeeded({ id = 'relay-needed' }: { id?: string }) {
  const { t } = useI18n();
  return <RelayNeededView t={t} id={id} />;
}
