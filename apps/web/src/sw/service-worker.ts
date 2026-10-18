/// <reference lib="webworker" />
import { cacheName, lookupKey, precache, staleCaches, type Manifest } from './core';

// Offline app shell. Precaches the hashed static export, serves it cache-first, and handles nothing else:
// no API traffic, no other origins, no user data (R-22). The manifest is baked in at build time.

declare const __MANIFEST__: Manifest;
declare const self: ServiceWorkerGlobalScope;

const manifest = __MANIFEST__;
const CACHE = cacheName(manifest);

self.addEventListener('install', (event) => {
  // A failed install leaves the previous worker in charge: the new version never activates half-cached.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await precache(manifest, cache, (url) => fetch(url, { cache: 'reload' }));
      } catch (e) {
        await caches.delete(CACHE);
        throw e;
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of staleCaches(await caches.keys(), CACHE)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

// The page asks for activation only after telling the user an update is ready.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const key = lookupKey(manifest, url, request.mode === 'navigate');
  if (key === undefined) return;
  event.respondWith(
    (async () => {
      const hit = await (await caches.open(CACHE)).match(key);
      return hit ?? fetch(request);
    })(),
  );
});
