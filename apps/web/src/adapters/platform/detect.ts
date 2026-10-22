import { BRIDGE_GLOBAL } from '@cashfold/platform/channels';

// Is this the desktop app? A check by shape only, with no schema library, so that code which has to run on every page load (the offline-worker
// registration) can ask without pulling the validation code into the first download. The validating wrapper is in ./index.ts.

const METHODS = ['state', 'check', 'download', 'install', 'openReleasePage', 'autoCheck', 'setAutoCheck', 'onChange'] as const;
const isFunction = (value: unknown): boolean => typeof value === 'function';

/** The bridge object when the host has something that looks like it, otherwise undefined. */
export function findRawBridge(host: object = globalThis): unknown {
  const raw = (host as Record<string, unknown>)[BRIDGE_GLOBAL];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as { about?: unknown; revealDataFolder?: unknown; updates?: unknown };
  const updates = candidate.updates as Record<string, unknown> | null | undefined;
  if (!isFunction(candidate.about) || !isFunction(candidate.revealDataFolder) || typeof updates !== 'object' || updates === null) return undefined;
  return METHODS.every((name) => isFunction(updates[name])) ? raw : undefined;
}

/** True in the desktop app, false in the web app. */
export const isDesktopApp = (host: object = globalThis): boolean => findRawBridge(host) !== undefined;
