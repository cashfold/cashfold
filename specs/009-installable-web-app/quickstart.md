# Quickstart: validating the installable web app

Prerequisites: dependencies installed (see the project notes for the pnpm flags); `pnpm --filter @cashfold/web build` (the service worker exists only in a production build); `E2E_REUSE` unset so the e2e server serves the fresh build.

1. **Unit tests**: `pnpm --filter @cashfold/web test` (install state, update state, unsaved input, install capture, manifest contract, worker core). Expected: green.
2. **Playwright** (Chromium and Firefox): `pnpm test:e2e --project=chromium --project=firefox e2e/pwa-offline.spec.ts e2e/pwa-update.spec.ts e2e/pwa-install.spec.ts e2e/offline-reload.spec.ts`. Expected: the notice appears for a new worker, typed text survives, a second tab restarts, an interrupted update keeps the old version, an unknown address offline shows the app's own 404, the install section shows only when useful, axe is clean in both themes.
3. **By hand, per browser** (record version and result in the table below):
   - Chrome or Edge on desktop: Settings → Install → Install; opens in its own window; right-click the icon: shortcuts; dark system theme: no white first frame.
   - Chrome on Android: install; the adaptive icon fills its shape; the splash screen colour (research R6); long-press shortcuts.
   - Safari on iPhone or iPad: the steps are correct; Add to Home Screen; opens standalone.
   - Safari on Mac: the steps; Add to Dock.
   - Firefox on desktop: no install section; offline and update still work.
   - Offline: turn the network off, reopen the installed app, open each section.
   - Update: deploy a changed build, open the app, wait for the notice (or return to the window), type in the add sheet, press Update: the switch is refused until saved.
4. **Persistent storage**: in a browser that grants it and one that refuses, check Settings → Data and storage.
5. **Desktop app**: run it; no install group, no update notice from the web flow.

Automated results (2026-10-27, macOS host): Chromium and Firefox pass `pwa-install`, `pwa-update`, `pwa-offline` (Chromium) and `offline-reload`; the desktop app shows no Install group. The browser's own install event is simulated in these tests; a real install, Safari's steps and the Android splash are for the table below.

| Browser | Version | Install | Offline | Update | Notes |
|---|---|---|---|---|---|
| Chrome desktop | | | | | |
| Edge desktop | | | | | |
| Chrome Android | | | | | |
| Safari iOS | | | | | |
| Safari macOS | | | | | |
| Firefox desktop | | | | | |
