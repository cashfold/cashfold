// Registers the offline worker in production builds and tells the app when an update is waiting.

import { isDesktopApp } from '../adapters/platform/detect';

export const UPDATE_READY_EVENT = 'cashfold:update-ready';

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
  // The desktop app serves its files from the app itself: nothing to cache, and the worker's update flow must not compete with the app's own updater.
  if (isDesktopApp()) return;
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  const announce = () => window.dispatchEvent(new CustomEvent(UPDATE_READY_EVENT, { detail: registration }));
  if (registration.waiting && navigator.serviceWorker.controller) announce();
  registration.addEventListener('updatefound', () => {
    const next = registration.installing;
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed' && navigator.serviceWorker.controller) announce();
    });
  });
}

/** Activates the waiting worker and reloads once it takes over. Call after the user accepts the update. */
export function applyUpdate(registration: ServiceWorkerRegistration): void {
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
