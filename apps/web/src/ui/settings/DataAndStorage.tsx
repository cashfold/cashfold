'use client';

import { DataScreen } from '../data/DataScreen';
import { PaletteHistorySection } from './PaletteHistorySection';
import { StorageSection } from './StorageSection';

/** Settings → Data and storage: import, export, backup, and whether the browser keeps the data. */
export function DataAndStorage() {
  return (
    <div>
      <DataScreen />
      <StorageSection />
      <PaletteHistorySection />
    </div>
  );
}
