'use client';

import { DevicesScreen } from '../devices/DevicesScreen';
import { useI18n } from '../i18n/I18nProvider';
import { useLocalOnly } from '../sync/useLocalOnly';
import { SyncSection } from './SyncSection';

/**
 * Settings → Sync and devices: the devices list and the sync controls. An account kept only on this device (spec 010) has no devices to list
 * and nothing to sync, so it gets the explanation and the way to connect, and no "offline" or empty lists that would read as a fault.
 */
export function SyncAndDevices() {
  const { t } = useI18n();
  const local = useLocalOnly();
  if (local === undefined || local) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{t('page.devices.title')}</h1>
        {local ? <SyncSection /> : null}
      </div>
    );
  }
  return (
    <div>
      <DevicesScreen />
      <SyncSection />
    </div>
  );
}
