'use client';

import { DevicesScreen } from '../devices/DevicesScreen';
import { SyncSection } from './SyncSection';

/** Settings → Sync and devices: the devices list and the sync controls. */
export function SyncAndDevices() {
  return (
    <div>
      <DevicesScreen />
      <SyncSection />
    </div>
  );
}
