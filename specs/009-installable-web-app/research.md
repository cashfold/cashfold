# Research: Installable Web App (PWA)

Facts about browsers are from general knowledge and are marked **verify** where I could not confirm them for the versions in use; the quickstart records the result of each.

## R0. Audit: what exists

| Part | State | Evidence |
|---|---|---|
| Manifest | Exists, thin | `public/manifest.webmanifest`: name, short_name, start_url `/`, scope `/`, standalone, one background (`#ffffff`) and one theme (`#047857`) colour, four icons including maskable. Missing: `id`, `description`, `lang`, `dir`, `categories`, `shortcuts`, `display_override`, dark colours. |
| Theme colour in the page | Exists | `layout.tsx` `viewport.themeColor` with light and dark media queries. |
| Worker | Exists, sound | `service-worker.ts`: precache of the hashed export with a SHA-256 check, all-or-nothing install, cache-first for known files, stale caches deleted on activate, `clients.claim()`, waits for a `SKIP_WAITING` message. |
| Offline fallback | Exists | `lookupKey` serves `/<dir>/index.html` for a navigation, else `/404.html` (present in the export). |
| Registration | Exists | `register.ts`: registers in production, not in the desktop app; announces a waiting worker through `cashfold:update-ready`; `applyUpdate` posts `SKIP_WAITING` and reloads on `controllerchange`. |
| Update UI (web) | **Missing** | Nothing listens for `cashfold:update-ready`; `applyUpdate` is never called. `shell/UpdateNotice.tsx` is the desktop updater's notice and returns null without the desktop bridge. |
| Install UI | **Missing** | No `beforeinstallprompt`, `appinstalled` or `display-mode` code anywhere. |
| Offline tests | Exist | `e2e/offline-reload.spec.ts`: reload, navigate, new tab, shell-only, hashes. Not covered: an unknown address, a direct address of each section, an update, an interrupted update. |
| Persistent storage | Exists | `adapters/storage-persistence.ts`, `StorageNotice`, `StorageSection`. |
| CSP | Fits | `worker-src 'self'`, `manifest-src 'self'`, `script-src 'self'`; nothing needs loosening. |

Gaps to plan: the update flow, the install flow, the manifest, the extra offline tests, a re-request of persistent storage after install.

## R1. Installing

- **Decision**: a pure state machine with five states: `installed`, `promptable` (the browser handed us a deferred install event), `steps` (installable only by hand, with the kind of steps), `unavailable`, and `unknown` (before the first answer). Inputs: the captured `beforeinstallprompt` event, `appinstalled`, the `display-mode: standalone` media query, `navigator.standalone`, and a small platform check.
- **Capture**: `beforeinstallprompt` fires once, early, and only in Chromium browsers (Chrome, Edge, Samsung Internet; **verify** versions). A listener must exist before the page's code is ready, so `install-capture.ts` registers it as the first import of the providers, keeps the event, and calls `preventDefault()` so the browser shows nothing by itself (FR-003). `prompt()` is called only from the Install button.
- **Steps** where the event never comes: Safari on iPhone and iPad (Share, Add to Home Screen; iPadOS reports a Mac user agent, so it is told apart by touch points), Safari on Mac 17 and later (File, Add to Dock; **verify** the menu wording), and Chrome or Edge on iOS (same share-sheet path since iOS 16.4; **verify**). Firefox on desktop: `unavailable`. Anything else that is not promptable after 2 seconds with no event: `unavailable` (a later event still moves it to `promptable`). The page of the group waits for the state to be known, for at most those 2 seconds, so a direct visit does not leave too early.
- **Hidden** in the desktop app (`useDesktop().isDesktop`), when running as an installed app, and when `unavailable` (FR-002). After an install is accepted in a browser tab, the section confirms it in one line until the tab closes (clarified 2026-10-27). A declined prompt is not remembered: the event is consumed once by Chromium, so after a decline the section shows the browser's own menu hint until the next visit gives a new event (spec scenario 6; **verify** the re-fire behaviour).
- **Alternatives**: a banner or a toast to advertise install (rejected: FR-003); `navigator.getInstalledRelatedApps` (rejected: Chromium-only, needs a manifest `related_applications` entry and adds nothing here).

## R2. Where the install section lives

- **Decision**: a new Settings group `install`, shown only when the machine is not `unavailable`/`installed` and not in the desktop app, next to the existing conditional `desktop` group (`routes.ts`). Not on the Overview and not in the sidebar.
- **Rationale**: the same pattern as the desktop group; no new navigation concept; nothing appears unprompted.

## R3. Updates

- **Current behaviour**: a new worker installs and waits (no `skipWaiting` on install, good); `register.ts` announces it; a page that accepts posts `SKIP_WAITING`, the worker activates, deletes old caches and claims all clients, the accepting tab reloads on `controllerchange`.
- **Problems**:
  1. No UI (R0).
  2. An installed window may never navigate, and the browser checks for a new worker only on navigation (and at most daily). Add `registration.update()` on `visibilitychange` to visible, on `online`, and hourly (`updateViaCache: 'none'` is already set).
  3. Other tabs: after activation they are claimed by a worker whose cache lacks the old build's files, and the server no longer has them, so a lazy chunk in an old tab can fail. Every tab must leave the old version. A tab that did not ask for the switch shows "Cashfold was updated. Restart to continue" and restarts by itself once it holds no unsaved input; a locked app has none (FR-008).
  4. Unsaved input must survive (R4).
  5. A failed install leaves the old worker (already so). The page must also not lose its notice state: `update failed` clears silently and a retry happens at the next check (FR-009).
- **State machine** (`update-state.ts`): `idle`, `ready` (a worker is waiting), `dismissed` (for this version, this page life), `applying`, `failed`, `restarting-elsewhere` (another tab switched). Events: waiting-found, dismiss, apply, controller-changed, install-failed.
- **How to test without a second deploy**: a Playwright route override serves `/sw.js` with the baked version string changed. The new worker then installs (same files, same hashes), waits, and the whole flow runs on the real worker. An interrupted update is the same override with one file's URL answered with a 500.
- **Test harness (spike T002, result)**: a Playwright `route` override of `/sw.js` does **not** work: the browser fetches the worker script for an update outside what Playwright intercepts (`context.route` saw 0 requests, also with `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`). What works: a small Node server in front of the app (`e2e/fixtures/versioned-server.ts`) that serves everything unchanged except that the baked version in `/sw.js` and `/precache-manifest.json` can be changed, one path can answer 500, and one path can be held back. The test starts it on port 3300 and uses it as `baseURL`; a pretend new version then installs (same files, same hashes) and waits (`registration.waiting`), on Chromium. The interrupted-update cases use `failPath` and `holdPath`.
- **Alternatives**: `skipWaiting` on install (rejected: switches without the person's choice and mixes versions); a Workbox-style library (rejected: new dependency, and the hashed precache already exists).

## R4. Not losing unsaved input

- **Decision**: `unsaved-input.ts` reports whether any `input`, `textarea` or `select` on the page differs from its default value (`value !== defaultValue`, `checked !== defaultChecked`, selected option changed), plus the add sheet's own dirty flag, which already exists. A check, not a registry.
- **Rationale**: every form gets the protection without each registering; it errs on the side of waiting. The cost is a small scan only when an update is ready and when the person presses Update.
- **Behaviour**: Update pressed with unsaved input shows "Save or discard what you are typing, then update" and does not switch; the notice stays. The automatic restart of a secondary tab waits until the scan is clean.
- **Alternatives**: a registry every form joins (rejected: easy to forget a form); `beforeunload` prompts (rejected: browsers show their own wording, in the wrong language, and the app is locked or idle most of the time).

## R5. Offline

- The precache and `lookupKey` already satisfy FR-004 for known addresses. New tests prove: an unknown address while offline gets `/404.html` (FR-005); each of the five sections and each Settings group opens by direct address while offline; an interrupted update leaves the old version working.
- **Result (T026, T027)**: `lookupKey` needed no change: every section and every settings group opens offline by its own address, and an unknown address is answered with `/404.html`. The gap was that this page was Next's bare default, with no way back and no translation. `src/app/not-found.tsx` now shows "Page not found" with a link back, in all three languages (`notfound.*`).
- Sync waiting text exists in the sync indicator; the test checks that it says so while offline (FR-006).

## R6. Manifest

- **Decision**: add `id` (`/`), `description`, `lang` (`en`), `dir` (`auto`), `categories` (`finance`), `display_override` (`standalone`), `orientation` (`any`), and `shortcuts` for New transaction (`/transactions/?new=expense`), Overview, Transactions, Accounts, Plan and Settings. Shortcut URLs carry no data and go through the lock like any address: the app asks for the password and returns to the address after unlock (the existing flow, covered by `ux-shell.spec.ts`).
- **Names of shortcuts** are in one language only (a manifest has one `lang`; per-locale members exist but are not widely honoured; **verify**), so they stay in English, like the app's title (spec 004, FR-008).
- **Screenshots** (for richer install UI in Chromium) are left out: they would have to be kept in step with the design and are not needed for installability.
- **Colours**: the browser UI takes `theme-color` from the page (already light and dark). The manifest's `background_color` is one value and is used for the splash screen before any page code runs. A dark user would see a white splash. Options: a dark value (a light user then sees a dark splash), or a neutral. **Spike**: check whether the targeted Chromium versions honour a dark variant of the manifest colours (**verify**); if not, choose the neutral of the two that the existing light theme tolerates and record the limit in the quickstart. SC-006 is therefore measured on the first frame of the page, which the theme bootstrap already sets, not on the OS splash.
- **Maskable icon** exists. Checked on the file (T031): the "C" sits inside the central 45% of the 512 px square, well within the 80% safe zone that every Android adaptive shape keeps, so no shape crops it. Not yet seen on an Android device (quickstart row).
- **Dark manifest colours (T030)**: not verified. No change is made: `background_color` stays the light value, and the start-up colour limit is recorded in `docs/pwa.md` and the quickstart. The spike (does a Chromium version honour a dark variant?) needs a device or a Chromium of the right version and is left open in `tasks.md`.

## R7. Persistent storage

- Existing code requests persistence and reports refusal. Add: request again on `appinstalled` (Chromium grants it to installed apps more readily; **verify**), and an e2e on the wording for granted and refused (FR-012). No new storage.

## R8. Desktop app

- `register.ts` already skips the worker in the desktop app; the install section, the web update notice and the install capture are all inert there through `useDesktop().isDesktop` and the existing `isDesktopApp()`.

## R9. CI

- Lighthouse installability is not run in CI; it is a manual step in the quickstart (T040).
- Add the three e2e files to the existing Playwright run (Chromium and Firefox; WebKit is skipped for service workers as today). A Lighthouse installability check is useful but adds a tool and minutes; recorded as optional and left to the quickstart (run by hand) unless the budget allows.
