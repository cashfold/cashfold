// Registers the offline worker in production builds and tells the app about new versions (spec 009).
//
// A new worker installs and waits (the worker never takes over on its own). The page learns of it here, the person chooses, and `applyUpdate` lets it
// take over. Every other window then learns that another one switched, so none keeps running the old files.

import { isDesktopApp } from '../adapters/platform/detect';
import type { UpdateEvent } from './update-state';

/** Kept for code that listens for the DOM event; the page's own hook uses `onUpdateEvent`. */
export const UPDATE_READY_EVENT = 'cashfold:update-ready';

/** How often a window that stays open looks for a new version. The browser itself only looks when a page loads. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type Listener = (event: UpdateEvent) => void;
const listeners = new Set<Listener>();
const emit = (event: UpdateEvent): void => {
  for (const listener of [...listeners]) listener(event);
};

/** Hears what the worker flow finds out: a version is waiting, an install failed, the controlling worker changed. */
export function onUpdateEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

let current: ServiceWorkerRegistration | undefined;
let ownSwitch = false;

/** The version that waits, for telling one from the next. Read from the manifest the server now has; a failed read is not a reason to hide the update. */
async function versionOfNew(): Promise<string> {
  try {
    const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
    return res.ok ? String(((await res.json()) as { version?: unknown }).version ?? 'new') : 'new';
  } catch {
    return 'new';
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
  // The desktop app serves its files from the app itself: nothing to cache, and the worker's update flow must not compete with the app's own updater.
  if (isDesktopApp()) return;
  const container = navigator.serviceWorker;
  const registration = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  current = registration;
  // A page that had no controller is only being taken over for the first time: that is not an update.
  let controlled = container.controller !== null;

  const announce = (): void => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(UPDATE_READY_EVENT, { detail: registration }));
    void versionOfNew().then((version) => emit({ type: 'waiting-found', version }));
  };
  if (registration.waiting && controlled) announce();
  registration.addEventListener('updatefound', () => {
    const next = registration.installing;
    let installed = false;
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed') {
        installed = true;
        if (controlled) announce();
      } else if (next.state === 'redundant' && !installed && controlled) emit({ type: 'install-failed' });
    });
  });

  container.addEventListener?.('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    const own = ownSwitch;
    ownSwitch = false;
    emit({ type: 'controller-changed', own });
    if (own) location.reload();
  });

  // The browser looks for a new worker only when a page loads, and an installed window may stay open for days.
  const check = (): void => void registration.update().catch(() => undefined);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  if (typeof window !== 'undefined') window.addEventListener('online', check);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

/** Lets the waiting worker take over; this window reloads once when it does. Call after the person chose to update and nothing is unsaved. */
export function applyUpdate(): void {
  ownSwitch = true;
  current?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
