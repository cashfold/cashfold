import { DEFAULT_SETTINGS, parseSettings, type DeviceSettingsPort } from '@cashfold/core';
import { run, SETTINGS } from './idb';

/** Lock preferences. Not secret, but parsed defensively on every read: a damaged value falls back to the safe defaults. */
export function createIdbDeviceSettings(factory: IDBFactory = indexedDB): DeviceSettingsPort {
  return {
    async load() {
      try {
        return parseSettings(await run(factory, SETTINGS, 'readonly', (s) => s.get('current')));
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    async save(settings) {
      await run(factory, SETTINGS, 'readwrite', (s) => s.put(parseSettings(settings), 'current'));
    },
  };
}
