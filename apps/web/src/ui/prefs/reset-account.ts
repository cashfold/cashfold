import { DEFAULT_PREFS, type Prefs } from './schema';

/**
 * What the interface preferences keep when an account is signed out (spec 011). Language, theme and the layout choices belong to the device. The
 * recents are keyed by the old account's Fold ids and the hidden Getting started card is about that account, so the next account starts without them.
 */
export function resetAccountPrefs(prefs: Prefs): Prefs {
  return { ...prefs, recents: DEFAULT_PREFS.recents, firstRun: DEFAULT_PREFS.firstRun };
}
