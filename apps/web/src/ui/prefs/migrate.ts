// Version migrations for the stored preferences (data-model §1 Lifecycle). Only version 1 exists today; a future version adds a step here
// and a fixture in migrate.test.ts. `migrate` never throws: an unknown shape gives the defaults.
import { DEFAULT_PREFS, type Prefs } from './schema';

export function migrate(prev: unknown): Prefs {
  if (typeof prev !== 'object' || prev === null) return structuredClone(DEFAULT_PREFS);
  const version = (prev as { v?: unknown }).v;
  if (version === 1) return prev as Prefs;
  return structuredClone(DEFAULT_PREFS);
}
