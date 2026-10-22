import { describe, expect, it } from 'vitest';
import { APP_ID, APP_NAME, APP_ORIGIN, RELEASE_PAGE_BASE, SOURCE_REPO_URL, UPDATE_PUBLIC_KEYS } from './identity';

// These values are frozen once a release exists: Electron derives the user-data folder from the app name, and the installers and the
// updater identify the app by its id. Changing either moves every user's data out of sight. If you must change one, plan a migration first.
const MOVES_DATA = 'Changing this moves every installed user\'s data folder out of sight (and breaks updates). Plan a migration before editing identity.json.';

describe('frozen identity', () => {
  it('keeps the app name', () => {
    expect(APP_NAME, MOVES_DATA).toBe('Cashfold');
  });

  it('keeps the app id', () => {
    expect(APP_ID, MOVES_DATA).toBe('org.cashfold.app');
  });

  it('serves the app from one origin', () => {
    expect(APP_ORIGIN).toBe('app://cashfold');
  });

  it('points at the project repository over https', () => {
    expect(SOURCE_REPO_URL).toBe('https://github.com/cashfold/cashfold');
    expect(RELEASE_PAGE_BASE).toBe('https://github.com/cashfold/cashfold/releases');
  });
});

describe('update public keys', () => {
  it('holds at most two raw Ed25519 public keys (one, or two while a key is rotated)', () => {
    expect(UPDATE_PUBLIC_KEYS.length).toBeLessThanOrEqual(2);
    for (const key of UPDATE_PUBLIC_KEYS) {
      expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(Buffer.from(key, 'base64')).toHaveLength(32);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(UPDATE_PUBLIC_KEYS).size).toBe(UPDATE_PUBLIC_KEYS.length);
  });
});
