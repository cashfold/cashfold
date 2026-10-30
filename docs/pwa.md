# The web app as an installed app (PWA)

Spec: [specs/009-installable-web-app](../specs/009-installable-web-app/spec.md). This page is for people who change the code. For the desktop app (Electron), which is separate, see [desktop.md](desktop.md).

## What the web app is

A static export that a worker (`apps/web/src/sw`) keeps on the device, so the app opens and works with no connection. A manifest (`apps/web/public/manifest.webmanifest`) lets browsers install it in its own window. The worker serves only the app's own hashed files: no API traffic, no other origin and no user data.

## Rules

- **Nothing about installing appears unasked.** The only place is Settings → Install, listed only when the browser can install on request (Chromium) or by steps (Safari on iPhone, iPad and Mac). It is not listed in the desktop app, in an installed window, or where installing is impossible. No banner, toast or reminder.
- **A new version waits for the person.** The worker installs it and waits (`registration.waiting`); the page shows a quiet notice; the person presses Update. The worker never takes over by itself.
- **Update never loses typed input.** Pressing Update with anything unsaved on the page (a field that differs from its default; passwords, search terms, buttons and file choosers do not count) is refused until it is saved or discarded.
- **Every window leaves the old version.** After one window switches, the others show "Cashfold was updated" and restart by themselves as soon as they hold no unsaved input. A restart asks for the password, as any restart does.
- **A failed update changes nothing.** The new worker installs all files, checks each against its SHA-256, and only then stores them. If anything fails, the old version keeps working and the next check tries again.
- **Nothing is stored, synced or sent by installing, updating or uninstalling.** After install the app asks the browser again to keep its data, and Settings → Data and storage says what the browser answered.

## Where it lives

| What                                                             | File                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Offline worker (serve known files, wait to be told to take over) | `apps/web/src/sw/service-worker.ts`, `core.ts`                                              |
| Registration, update checks, window-to-window signalling         | `apps/web/src/sw/register.ts`                                                               |
| Update state machine                                             | `apps/web/src/sw/update-state.ts`                                                           |
| Unsaved-input scan                                               | `apps/web/src/ui/pwa/unsaved-input.ts`                                                      |
| Update hook and notice                                           | `apps/web/src/ui/pwa/useUpdate.ts`, `WebUpdateNotice.tsx`                                   |
| Install event capture (imported first by `app/providers.tsx`)    | `apps/web/src/ui/pwa/install-capture.ts`, `page-capture.ts`                                 |
| Install state and the steps per browser                          | `apps/web/src/ui/pwa/install-state.ts`, `useInstall.ts`                                     |
| Settings → Install                                               | `apps/web/src/ui/settings/InstallSection.tsx`, `apps/web/src/app/settings/install/page.tsx` |

## How it is tested

- Unit tests for each state machine and the manifest (`manifest.test.ts`).
- Playwright: `e2e/pwa-install.spec.ts` (the browser's install event is simulated), `e2e/pwa-update.spec.ts`, `e2e/pwa-offline.spec.ts`, `e2e/offline-reload.spec.ts`.
- The update tests pretend a new version was deployed with `e2e/fixtures/versioned-server.ts`, a small server in front of the app that changes the version baked into `/sw.js`. A Playwright `route` override does not work for this: the browser fetches the worker script for an update outside what Playwright intercepts.
- Real installs, Safari's steps and the Android splash screen are checked by hand: see the quickstart of the spec.

## Known limits

- **Start-up colour.** The system's start-up screen before the app loads uses one colour from the manifest. A dark-theme person may see it light on systems that cannot follow the theme; the app's own first screen is always in the right theme.
- **Primary colour and the icon.** Settings → Appearance lets a person pick one of ten colours; the tab icon, the touch icon, the browser's address-bar colour and the manifest the page links follow it (`apps/web/src/ui/theme/mirror-icon.ts`, files made by `pnpm gen:assets` in `public/icons/<colour>/` and `public/manifests/<colour>.webmanifest`). An app that is already installed keeps the icon it was installed with: the system decides that, so the setting says so. The manifest stays same-origin, so the Content-Security-Policy is unchanged.
- **Firefox on a computer** cannot install web apps; offline and update still work.
- **Chromium decides** when it fires the install event, and may wait after a decline. The Install section appears when it does.
- Showing a count of waiting entries on the icon, and opening files and links from outside, are not part of this feature (the desktop app has them).
