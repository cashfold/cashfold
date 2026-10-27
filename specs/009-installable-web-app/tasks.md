---

description: "Task list for the installable web app (PWA)"
---

# Tasks: Installable Web App (PWA)

**Input**: Design documents from `/specs/009-installable-web-app/`

**Prerequisites**: plan.md, spec.md (with its Clarifications), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The spec requires proof for its offline and update claims (FR-015), and the constitution requires test-first work and Playwright coverage for each P1 story.

**Organization**: Grouped by user story. All paths are in `apps/web` unless they start with `e2e/`, `docs/` or `specs/`.

Message keys (all in `apps/web/src/ui/i18n/messages/{en,uk,pl}.json`; parity is enforced by `src/ui/i18n/catalogue-complete.test.ts`, and the "no browser word in desktop" test in `src/ui/i18n/i18n.test.ts` applies to any message that says "browser"):
- Install: `settings.group.install`, `settings.group.install.description`, `install.title`, `install.lede`, `install.button`, `install.done`, `install.steps.ios-safari.1` to `.3`, `install.steps.ios-other.1` to `.3`, `install.steps.mac-safari.1` and `.2`.
- Update: `update.ready`, `update.apply`, `update.dismiss`, `update.blocked`, `update.applying`, `update.elsewhere`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 install, US2 update, US3 offline, US4 app feel, US5 storage

## Phase 1: Setup

- [X] T001 Read `src/sw/service-worker.ts`, `src/sw/register.ts`, `src/sw/core.ts`, `public/manifest.webmanifest`, `src/ui/shell/routes.ts`, `src/ui/shell/AppShell.tsx`, `src/app/providers.tsx`, `src/ui/settings/SettingsIndex.tsx`, `src/app/settings/desktop/page.tsx` and `e2e/offline-reload.spec.ts`; confirm the audit in `research.md` R0 still matches (in particular that nothing listens for `cashfold:update-ready`), and note any difference at the end of R0 before coding.
- [X] T002 Spike the update test harness before writing US2: in a throwaway Playwright test against the production build, serve `/sw.js` with the baked version string changed (a `page.route` override of the response text), confirm the new worker installs (same files, same hashes), waits, and that `registration.waiting` appears; write the working recipe at the end of `research.md` R3 so T024 can use it. If it does not work, record the reason and the alternative (build a second version into a temporary folder and serve both).

## Phase 2: Foundational (blocks US1, US2 and US5)

**Goal**: a single place that knows how the app is running.

- [X] T003 [P] Write failing tests in `src/ui/pwa/display-mode.test.ts`: `isInstalledWindow()` is true when `matchMedia('(display-mode: standalone)')` matches or `navigator.standalone === true`, false otherwise, and false (not a throw) when `matchMedia` is missing.
- [X] T004 Implement `isInstalledWindow(env)` in `src/ui/pwa/display-mode.ts`, taking `window`-like input so it tests without a browser; make T003 pass.

**Checkpoint**: the rest can start.

## Phase 3: User Story 1 - Install Cashfold like an app (Priority: P1)

**Goal**: an "Install Cashfold" Settings group that appears only when it helps and installs or explains.

**Independent Test**: in Chromium the group shows an Install button (the install event is simulated in the test); in a browser without the event and not installable it is not listed; in the desktop app and in an installed window it is not listed.

- [X] T005 [P] [US1] Write failing tests in `src/ui/pwa/install-state.test.ts` for the pure machine of `data-model.md` "InstallState": `unknown -> promptable | steps | installed | unavailable`; `promptable -> installed` on accept or `appinstalled`; `promptable -> unavailable` after a decline until a new event arrives; `* -> installed` when `isInstalledWindow()` is true; `installed-in-tab` when `appinstalled` fires while the tab is open; the deferred event is used at most once; `steps` has `kind` `ios-safari`, `ios-other` or `mac-safari` (iPadOS is told apart from Mac by touch points; Chrome and Edge on iOS are `ios-other`); Firefox on desktop is `unavailable`; the desktop app is `unavailable`; and `unknown -> unavailable` happens when the state is still unknown after 2 seconds (fake timers), but a later `beforeinstallprompt` still moves it to `promptable`.
- [X] T006 [P] [US1] Write failing tests in `src/ui/pwa/install-capture.test.ts`: the capture module registers its `beforeinstallprompt` listener when imported, calls `preventDefault()` so the browser shows nothing by itself (FR-003), keeps the event, exposes `prompt()` which calls the event's `prompt()` only when asked and then clears the event, and forwards `appinstalled`.
- [X] T007 [US1] Implement `src/ui/pwa/install-state.ts` (the pure machine, no browser globals) and make T005 pass. Constraint from `data-model.md`, quoted: "the deferred event is used at most once; `prompt()` is called only from a person's press."
- [X] T008 [US1] Implement `src/ui/pwa/install-capture.ts` (module-level listener and a tiny subscribe/get store) and make T006 pass.
- [X] T009 [US1] Import `install-capture` as the first import of `src/app/providers.tsx` so the listener exists before the page's code runs, and add `src/ui/pwa/useInstall.ts` (a hook over the capture store, `isInstalledWindow`, `useDesktop().isDesktop` and a small platform check) that returns the current `InstallState`.
- [X] T010 [P] [US1] Add the install messages (keys in the list above) in English, Ukrainian and Polish to `src/ui/i18n/messages/en.json`, `uk.json`, `pl.json`. The steps must name the real controls: iPhone and iPad "Share, Add to Home Screen, Add"; Mac Safari "File, Add to Dock". Do not use the word "browser" without a `.desktop` variant (the group is never shown in the desktop app, so no variant is needed, but keep the wording neutral).
- [X] T011 [US1] Create `src/ui/settings/InstallSection.tsx` per `contracts/install-section.md`: for `promptable` a title, one sentence and an **Install** button that calls the captured prompt; for `steps` an ordered list for `kind` and no button; for `installed-in-tab` one line saying it is installed. Heading, button and list use the kit; passes axe in both themes.
- [X] T012 [US1] Add the group: in `src/ui/shell/routes.ts` add `'install'` to `SettingsGroupId` and `INSTALL_SETTINGS_GROUP` (like `DESKTOP_SETTINGS_GROUP`), keep it out of `SETTINGS_GROUPS` (the seven groups everyone sees) but include `/settings/install/` in `ROUTES` (it renders its own screen, so `routes.test.ts` expects it there), and create `src/app/settings/install/page.tsx` modelled on `src/app/settings/desktop/page.tsx` (it waits while the state is `unknown`, for at most 2 seconds, so a direct visit does not leave before the browser's install event arrives, and then replaces to `/settings/` when the state is `installed`, `unavailable` or the desktop app; the wait is tested); list the group in `src/ui/settings/SettingsIndex.tsx` only when the state is `promptable`, `steps` or `installed-in-tab` and not in the desktop app. Update `src/ui/shell/routes.test.ts` for the new group.
- [X] T013 [US1] Add `e2e/pwa-install.spec.ts` (Chromium and Firefox): with a simulated `beforeinstallprompt` event the group is listed and the button calls the prompt; with no event the group is not listed; nothing about installing appears on any other screen without opening Settings (no banner, no toast); axe is clean in the light and dark themes at narrow width; installing takes 3 steps or fewer from Settings (open Settings, open the Install group, press Install; SC-001); and with the app open in a normal tab after `appinstalled`, the group shows the one-line confirmation while a second page in standalone display mode does not list the group (the "installed and also open in a tab" edge case).
- [X] T014 [US1] Add a desktop check to `apps/desktop/e2e/native-feel.spec.ts`: the Settings index does not list "Install Cashfold" in the desktop app.

**Checkpoint**: US1 works alone.

## Phase 4: User Story 2 - Updating safely, at the person's choice (Priority: P1)

**Goal**: the quiet notice, the choice, no lost input, every window leaves the old version.

**Independent Test**: serve `/sw.js` with another baked version; the notice appears, typed text survives, Update is refused until saved, other tabs restart by themselves, an interrupted update leaves the old version working.

- [X] T015 [P] [US2] Write failing tests in `src/sw/update-state.test.ts` for the machine of `data-model.md` "UpdateState" (`idle`, `ready` with `version`, `dismissed`, `blocked`, `applying`, `restarting-elsewhere`, `failed`) and events `waiting-found`, `dismiss`, `apply`, `unsaved-found`, `unsaved-cleared`, `controller-changed(own)`, `install-failed`. Rules, quoted: "`dismiss` is per version and per page life; `controller-changed` with `own = false` always leads to `restarting-elsewhere`; `apply` never reloads while the unsaved-input check reports input."
- [X] T016 [P] [US2] Write failing tests in `src/ui/pwa/unsaved-input.test.ts`: true when any `input`, `textarea` or `select` has `value !== defaultValue`, `checked !== defaultChecked` or a changed selected option; false for a pristine form, for an empty page and for read-only elements; and false for a `type=password` field, so a person typing their password into the unlock form never delays the restart of a locked window. This scan also covers the add sheet, whose dirty flag in `src/ui/transactions/AddSheet.tsx` is a private ref and needs no separate wiring.
- [X] T017 [P] [US2] Extend `src/sw/register.test.ts` for the new behaviour of `registerServiceWorker`: `registration.update()` is called on `visibilitychange` to visible, on `online`, and every 60 minutes (fake timers); errors from `update()` are ignored; `controllerchange` reports `own: true` only for a switch this tab asked for and `own: false` otherwise; a tab that never had a controller does nothing; the desktop app still registers nothing.
- [X] T018 [US2] Implement `src/sw/update-state.ts` and make T015 pass.
- [X] T019 [US2] Implement `src/ui/pwa/unsaved-input.ts` (pure function over a `Document`; it ignores `type=password` fields) and make T016 pass.
- [X] T020 [US2] Update `src/sw/register.ts` per `contracts/update-messages.md`: the periodic and on-return update check, a typed hook for the page (`onUpdateEvent(listener)` replacing the global DOM event as the primary channel, keeping `cashfold:update-ready` for compatibility), `applyUpdate` marks the switch as its own before posting `SKIP_WAITING`, and reports `install-failed` when a new worker becomes `redundant` before it was installed; make T017 pass. Do not change what `service-worker.ts` caches or serves.
- [X] T021 [P] [US2] Add the update messages (keys in the list above) in English, Ukrainian and Polish to `src/ui/i18n/messages/{en,uk,pl}.json`. Do not use the word "browser" in these messages (the notice is never shown in the desktop app, but the "no browser word" test would then require a `.desktop` text). "Cashfold was updated. Restart to continue." is `update.elsewhere`; `update.blocked` is "Save or discard what you are typing, then update."
- [X] T022 [US2] Create `src/ui/pwa/useUpdate.ts` (the hook over `update-state`, `register.ts` events and `unsaved-input`, re-checking the scan on `input` events and every second while `blocked` or `restarting-elsewhere`) and `src/ui/pwa/WebUpdateNotice.tsx` (a quiet, dismissible kit `Notice`, no focus steal, Update and Dismiss buttons, the right text per state, restarts a `restarting-elsewhere` tab by itself once the scan is clean). It renders nothing in the desktop app.
- [X] T023 [US2] Mount `WebUpdateNotice` next to the other banners in `src/ui/shell/AppShell.tsx` (`Banners`), and also in the pre-sign-in shell so a locked or signed-out window is told too. Nothing is read from the app while locked.
- [X] T024 [US2] Add `e2e/pwa-update.spec.ts` (Chromium and Firefox) using the versioned server of `e2e/fixtures/versioned-server.ts` on port 3300 as `baseURL` (research R3; a Playwright `route` override does not work): the notice appears for a waiting worker; dismissing hides it for that version; text typed in the add sheet is kept and Update shows `update.blocked` until it is saved or discarded; after Update the app restarts once and shows the unlock screen, as any restart does, and a locked window stays locked; a second tab shows `update.elsewhere` and restarts by itself once clean; a precache file answered with a 500 leaves the old version working offline and online and shows no notice; a new worker whose install never finishes (a precache file whose response is held back) leaves the running app undisturbed; and the notice appears within 60 seconds of the new worker finishing its install (SC-003).
- [X] T025 [US2] Add axe checks for the notice in the light and dark themes and at narrow width to `e2e/pwa-update.spec.ts`.

**Checkpoint**: US2 works alone.

## Phase 5: User Story 3 - It works offline, and says so (Priority: P1)

**Goal**: the offline claims are proven for every screen.

**Independent Test**: after one visit, with the network off, every screen opens by address and after reload; an unknown address gets the app's own page.

- [X] T026 [US3] Add `e2e/pwa-offline.spec.ts` (Chromium and Firefox; WebKit skipped as in `e2e/offline-reload.spec.ts`): after one visit and a controlled reload, go offline and open by direct address each primary section (`PRIMARY_SECTIONS` in `src/ui/shell/routes.ts`) and each settings group (`SETTINGS_GROUPS`) and see its heading; an address that is not part of the app shows the app's own "page not found" screen, not the browser's error page (FR-005); adding a transaction offline is saved and the sync indicator says it is waiting (FR-006); back online, synchronisation resumes without action.
- [X] T027 [US3] If T026 finds a gap (an address that falls through to the network, or a 404 page that is the browser's), fix it in `src/sw/core.ts` `lookupKey` with a failing test first in `src/sw/core.test.ts`; otherwise record "no change needed" at the end of `research.md` R5.

## Phase 6: User Story 4 - It looks and opens like an app (Priority: P2)

**Goal**: a complete manifest and an honest record of the start-up colour.

**Independent Test**: the manifest passes its contract test; installing it in Chrome shows the name, icon, theme colour and shortcuts.

- [X] T028 [P] [US4] Write failing tests in `src/app/manifest.test.ts` for `contracts/manifest.md`: valid JSON; has `id`, `description`, `lang`, `dir`, `display_override`, `categories`, `shortcuts`; every icon file exists in `public/`; every shortcut URL is inside `scope`, is a route of the app (`ROUTES` in `src/ui/shell/routes.ts`, or `/transactions/?new=expense`) and carries no account, name or amount; the maskable icon exists; no member points to another origin.
- [X] T029 [US4] Complete `public/manifest.webmanifest` per `contracts/manifest.md`: `id` `/`, a one-sentence English `description`, `lang` `en`, `dir` `auto`, `categories` `["finance"]`, `display_override` `["standalone"]`, `orientation` `any`, and six `shortcuts` (New transaction `/transactions/?new=expense`, Overview `/overview/`, Transactions `/transactions/`, Accounts `/accounts/`, Plan `/plan/`, Settings `/settings/`); keep the four icons and `start_url`/`scope` unchanged; make T028 pass.
- [ ] T030 [US4] Spike (research R6): in the Chromium versions used for the quickstart, check whether a dark variant of the manifest colours is honoured; choose `background_color` accordingly and record the browsers where the system's start-up screen stays light, as the clarification allows. Write the outcome in `research.md` R6 and in the quickstart table. No code change if no variant is honoured.
- [X] T031 [P] [US4] Check the maskable icon's safe zone (`public/icon-maskable-512.png`) by eye on the Android adaptive shapes and record the result in the quickstart table; replace the file via `pnpm gen:assets` only if it is cropped.
- [X] T032 [US4] Add a test that a shortcut address taken while locked leads to the unlock screen and returns to the address after unlock, with no data read first, to `e2e/pwa-install.spec.ts` (the flow exists; this proves FR-011).

- [X] T041 [US4] Add a first-paint test to `e2e/pwa-install.spec.ts` (Chromium and Firefox): with `page.emulateMedia({ colorScheme: 'dark' })` and no stored theme choice, the page's computed background is the dark surface colour at `domcontentloaded`, before the app hydrates, and `<html data-theme>` is `dark` (SC-006: the app's own first screen; the system's start-up screen is the recorded limit of T030). Repeat for a stored "light" choice under a dark system, which must be light.

## Phase 7: User Story 5 - The data stays safe when installed (Priority: P3)

**Goal**: installing keeps the storage protection and its message.

**Independent Test**: after the install event the app asks for persistent storage again and the Settings text matches the answer.

- [X] T033 [P] [US5] Write a failing test in `src/ui/pwa/install-capture.test.ts` (extend T006): when `appinstalled` fires the capture module calls the persistence request once (injected, so the test does not need a browser).
- [X] T034 [US5] Wire `appinstalled` to `requestPersistence` from `src/adapters/storage-persistence.ts` in `src/ui/pwa/useInstall.ts`; make T033 pass. Nothing stored, synchronised or sent changes (FR-013).
- [X] T035 [US5] Add to `e2e/pwa-install.spec.ts` a check, with the storage API stubbed to grant and then to refuse, that Settings → Data and storage shows the granted wording and the existing refusal warning respectively.

## Phase 8: Polish & Cross-Cutting

- [X] T036 [P] Write `docs/pwa.md`: how the worker, update and install flows work, the rules (nothing install-related unprompted, every window leaves the old version, unsaved input is never lost), the manual per-browser checks, and the known limits (the start-up colour, Firefox, Safari steps). Link it from `docs/README.md`.
- [X] T037 [P] Run the type-check, lint and unit tests for `apps/web`, and `pnpm check:bundle` (the constitution blocks merges on the bundle-size budget; the new code is small and lazy where it can be, but if the budget is exceeded, trim first, and only then raise it with a one-line reason in the PR); fix findings. Commit messages and the PR text carry no AI attribution or co-author lines (constitution, Development Workflow).
- [X] T038 [P] Run the i18n completeness test, the "no browser word in desktop" test, `e2e/pseudo-walk.spec.ts` and `e2e/language.spec.ts` after adding the new screens, and fix any missing or overflowing text.
- [X] T039 Run `e2e/offline-reload.spec.ts`, `e2e/pwa-offline.spec.ts`, `e2e/pwa-update.spec.ts` and `e2e/pwa-install.spec.ts` on Chromium and Firefox, then the desktop e2e on the host system; record results in the quickstart table.
- [ ] T040 Walk through `quickstart.md` by hand on the browsers it lists (the Mac has Chrome and Safari; Windows, Linux, Android and iOS need other devices) and tick each row; include a Lighthouse installability audit in Chrome DevTools on the production build (not run in CI); record any not run as unchecked.

## Dependencies & Execution Order

- T041 belongs to US4 (Phase 6) and runs after T029; its number is out of order only because it was added after the analysis.

- Phase 1, then Phase 2 (T003 before T004). US1, US2, US3 and US4 depend only on Phase 2 (US2 and US3 do not even need it) and are independent of each other. US5 needs US1 (T008, T009).
- Within a story: tests first, then the pure code, then the hook and component, then the e2e.
- Shared files: `src/ui/i18n/messages/{en,uk,pl}.json` by T010, T021 (sequential); `src/app/providers.tsx` by T009 only; `src/ui/shell/AppShell.tsx` by T023 only; `e2e/pwa-install.spec.ts` by T013, T032, T035 (sequential); `research.md` by T001, T027, T030.

## Parallel Examples

- After T004: T005, T006 (US1), T015, T016, T017 (US2), T026 (US3) and T028 (US4) all start together.
- Messages T010 and T021 can be written in parallel with the code of their stories.

## Implementation Strategy

- **MVP**: Phases 1 and 2, then US2 (update) first, because it fixes an existing gap with no new UI surface for a first-time visitor, then US1 (install) and US3 (offline proof). Stop and validate with the quickstart.
- **Next**: US4 (manifest), then US5, then Polish.
- **Risks to watch**: the install event timing (T009, the capture must exist before page code), multi-window restarts (T024), and the start-up colour (T030, a recorded limit rather than a fix).
