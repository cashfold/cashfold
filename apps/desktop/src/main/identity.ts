import identity from './identity.json' with { type: 'json' };

// The identity of the desktop app. The values live in identity.json so that the packaging configuration (electron-builder.config.mjs)
// reads the same file and cannot drift; scripts/check-desktop-config.mjs checks that it does.
// APP_NAME and APP_ID are frozen once a release exists (see identity.test.ts): the user-data folder and the updater depend on them.

export const APP_NAME: string = identity.name;
export const APP_ID: string = identity.appId;
/** The one origin the web export is served from. */
export const APP_ORIGIN: string = identity.origin;
/** Where the source of every released version lives (AGPL corresponding source; update downloads are pinned to it). */
export const SOURCE_REPO_URL: string = identity.sourceRepoUrl;
export const RELEASE_PAGE_BASE = `${identity.sourceRepoUrl}/releases`;
/**
 * Raw Ed25519 public keys (base64) that may sign updates: one, or two while a key is rotated (ADR-0010).
 * Empty in development and in test builds; a release configuration with an empty list is refused by check-desktop-config.
 */
export const UPDATE_PUBLIC_KEYS: readonly string[] = identity.updatePublicKeys;
