---

description: "Task list for the native desktop experience"
---

# Tasks: A Native Desktop Experience

**Input**: Design documents in `/specs/006-native-desktop-experience/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Included. The constitution requires tests for each story, the contracts define exact refusals worth pinning, and the packaged-app suite is how the shell is checked in CI on all three systems.

**Format**: `- [ ] T### [P?] [US?] Description with file path` — `[P]` = different files, no dependency on an unfinished task.

**Paths**: shell under `apps/desktop/src/{main,preload}`, shared bridge under `packages/platform/src`, page side under `apps/web/src`, packaged-app specs under `apps/desktop/e2e`, docs under `docs/` and `specs/`.

**Run notes**: use `env -u ELECTRON_RUN_AS_NODE` for anything that starts Electron or Playwright; one Playwright invocation at a time, with `--workers=3` for the web suite; packaged tests with `pnpm --filter @cashfold/desktop test:packaged`. Commits and pull requests follow the constitution: no AI-attribution lines. Each story is its own pull request; the stories marked **two reviewers** (US1, US6) are security-sensitive.

**Facts the tasks rely on** (checked in the code; bundle headroom is about 20 KB gzipped): the Topbar exists only below the `lg` width (the desktop layout has a sidebar and no top bar, so US7 adds a frame bar); the lock session is in `packages/core/src/identity/application/lock.ts` and is not changed; reminders live only in `ui/plan/SchedulesView.tsx`; the desktop permission handler is in `apps/desktop/src/main/security.ts`; `hiddenGraceMs` defaults to one minute.

---

## Phase 1: Setup

- [X] T001 Record the baseline before changing anything: on the working branch run `pnpm typecheck`, `npx vitest run apps/desktop packages/platform apps/web`, and `pnpm --filter @cashfold/desktop test:packaged`; note any failure that exists already in `specs/006-native-desktop-experience/baseline.md` so it is not blamed on this work

---

## Phase 2: Foundational (blocks every story)

**Goal**: the bridge, the settings store, the capability report and the page-side provider exist and are tested, with no visible change.

- [X] T002 [P] Add the new channel names to `packages/platform/src/channels.ts` exactly as listed in `contracts/desktop-bridge-additions.md`: `settings`, `settingsSet`, `theme`, `session`, `badge`, `recentFolds`, `popupMenu`, `windowShow` (calls) and `systemLock`, `menuAction`, `incoming`, `frameState`, `settingsChanged` (events), all in the `cashfold:` namespace
- [X] T003 [P] Add strict schemas to `packages/platform/src/schemas.ts` (every object `z.strictObject`): `DesktopSettingsSchema` (`hideOnBlur: boolean`, `startAtLogin: boolean`, `closeBehavior: 'quit' | 'background'`, `theme: 'system' | 'light' | 'dark'`), `CapabilitiesSchema` (fields in `data-model.md`), `SettingsUpdateSchema` (at least one of `hideOnBlur`, `startAtLogin`, `closeBehavior`), `ThemeRequestSchema`, `SessionReportSchema` (`state: 'locked' | 'unlocked'`), `BadgeRequestSchema` (`count`: integer 0 to 999), `RecentFoldsRequestSchema` (0 to 5 entries of `{ id: string ≤ 64, name: string ≤ 40 }`), `PopupMenuRequestSchema` (1 to 12 items, `id` matching `^[a-z][a-z-]{0,23}$`, `label` ≤ 60, optional `destructive`) and `PopupMenuResponseSchema` (`id: string | null`), `ActionIdSchema` (the closed set in `contracts/menu-and-shortcuts.md`), `SystemLockEventSchema` (`reason`: `screen-lock` | `suspend` | `idle-state`), `IncomingItemSchema` (kind `csv` | `backup` | `link`, `name` ≤ 120, bytes, link variants), `FrameStateSchema`; export them from `packages/platform/src/index.ts`
- [X] T004 [P] Write `packages/platform/src/schemas.test.ts` cases for the new schemas: each accepts a valid value and refuses an unknown key, a wrong type, a count of 1000, a 6th recent Fold, a 13th menu item, a menu id with a capital letter, a label over 60 characters, an unknown action id
- [X] T005 Extend `packages/platform/src/bridge.ts` with the new methods and `platform` as listed under "Bridge object" in `contracts/desktop-bridge-additions.md` (listeners return an unsubscribe function)
- [X] T006 [P] Create `apps/desktop/src/main/desktop-settings.ts` and extend `apps/desktop/src/main/desktop-state.ts`: add `hideOnBlur` (default `false`), `startAtLogin` (default `false`), `closeBehavior` (default `'background'` on macOS and `'quit'` on Windows and Linux) and `theme` (default `'system'`) to the state, sanitised field by field like the existing fields (unknown keys dropped; a bad value falls back to its default without touching the rest); add `apps/desktop/src/main/desktop-settings.test.ts` for the defaults per platform, bad values and partial files
- [X] T007 [P] Create `apps/desktop/src/main/capabilities.ts` returning the capability report in `data-model.md` from injected facts (`process.platform`, `XDG_CURRENT_DESKTOP`, the Windows build number, `nativeTheme` flags); `statusItem` is true on Windows and macOS and, on Linux, only when `XDG_CURRENT_DESKTOP` names KDE, XFCE, Cinnamon, MATE, LXQt, Budgie, Pantheon or Deepin; add `capabilities.test.ts` covering each platform, the allow-list, plain GNOME, and an unset variable
- [X] T008 Edit `apps/desktop/src/main/ipc.ts` to register the new calls with strict argument parsing and the sender check: `settings` (answers settings and capabilities), `settingsSet` (refuses `closeBehavior: 'background'` when `statusItem` is false and stores `'quit'`), `theme`, `session`, `badge`, `recentFolds` (refused and cleared unless the last `session` was `unlocked`), `popupMenu`, `windowShow`; extend `IpcHandlers`; handlers whose behaviour belongs to a later story (`popupMenu`, `badge`, `recentFolds`, `windowShow`) are safe stubs here (accept the validated request, do nothing, answer `null` or nothing) and are replaced in their story; update `apps/desktop/src/main/ipc.test.ts` for each (valid, refused argument, refused sender)
- [X] T009 Edit `apps/desktop/src/preload/bridge.ts` to implement every new method and event through `CHANNELS`, validate every answer and event payload against the schemas, expose `platform`, and keep the bridge and its groups frozen; update `apps/desktop/src/preload/bridge.test.ts` (exact key list, nothing exposes `invoke`, `send` or `on`)
- [X] T010 Edit `apps/web/src/adapters/platform/index.ts` so the validating wrapper covers the new methods (an answer that fails its schema becomes a safe default or an error, never reaches the page), and extend `apps/web/src/adapters/platform/index.test.ts`
- [X] T011 Create the page-side providers: `apps/web/src/ui/desktop/DesktopSettingsProvider.tsx` and `useDesktop.ts` (exposes `isDesktop`, `platform`, `settings`, `capabilities`, `update(partial)`; in a browser every value is the inert default and nothing calls the bridge), and mount the provider in `apps/web/src/app/providers.tsx` between `I18nProvider` and `CoreProvider` (it must sit above `CoreProvider`; it reads only the synchronous bridge check at start and loads the validating wrapper lazily); add `DesktopSettingsProvider.test.tsx` for desktop and browser behaviour
- [X] T012 Create `apps/web/src/ui/desktop/lazy.tsx` with a `DesktopOnly` wrapper and a `loadDesktop(name)` helper that load a desktop-only module by dynamic `import()` only when `isDesktopApp()` is true (the same pattern as `apps/web/src/ui/settings/useDesktopUpdates.ts`), so none of the desktop-only code is in the web app's initial bundle; add `lazy.test.tsx` (in a browser nothing is imported, in the desktop app it is) and run `pnpm check:bundle` to record the starting figures (initial 354,847 and lazy 255,877 bytes gzipped at the time of writing)
- [X] T013 Create `apps/desktop/src/main/background.ts` with an `enabled` switch that `index.ts` passes as `false` for now (it is turned on in the US5 task that activates background mode, so closing the window behaves exactly as today on every system, including macOS where it currently destroys the window and the page locks): when enabled, `closeBehavior` is `'background'` and the app is not quitting, closing the window hides it (the page and its session stay alive); `before-quit` sets a quitting flag; on `window-all-closed` quit on Windows and Linux unless in background mode; on macOS `activate` shows the window; edit `apps/desktop/src/main/window.ts` to use it and to set `backgroundThrottling: false` so a hidden window still runs its 60-second check on time; add `background.test.ts` with a fake window (disabled: close destroys and quits as today; enabled: hides; quitting: really closes)
- [X] T014 Create `apps/desktop/src/main/test-hooks.ts`, compiled in only when the main-process bundle is built with the compile-time constant `__CASHFOLD_TEST_HOOKS__` (declare it in `apps/desktop/src/main/build-constants.d.ts` and set it in `apps/desktop/scripts/build.mjs` from `CASHFOLD_TEST_BUILD`, like the existing `__CASHFOLD_TEST_FEED_ENABLED__`; a runtime variable must not enable it), exposing on `globalThis.__cashfoldTest` the things the packaged tests need and no more: emit a power event, read the badge, read the tray and menu models, read the window options, read the queued intake items, deliver a launch argument vector; add a test that the hooks are absent when the constant is undefined, and a check in `scripts/check-desktop-config.mjs` that a release bundle contains no `__cashfoldTest` text; update `apps/desktop/e2e/hardening.spec.ts` to list the new bridge keys exactly and to check the hooks are absent from the page
- [X] T015 Wire the new modules in `apps/desktop/src/main/index.ts` (settings store, capabilities, background mode, new IPC handlers) without enabling any story behaviour yet (background mode passed as disabled, stubs in place), and confirm `pnpm --filter @cashfold/desktop test:packaged` still passes

**Checkpoint**: the bridge and settings exist, nothing visible has changed on any system (closing the window behaves as before), the packaged suite is green.

---

## Phase 3: User Story 1 — Lock when the computer locks, not when I click elsewhere (P1) 🎯 MVP

**Goal**: on desktop, losing focus no longer covers or locks by default; the computer locking, sleeping or idling locks the app; "hide when I switch away" is an option; the web app is unchanged. **Two reviewers.**

**Independent test**: click another window: content stays. Emit a lock-screen or suspend event: the app is locked within 5 seconds with no content in the window. Turn the option on: switching hides at once. Minimise and leave: locks at the idle time, not after one minute. In a browser nothing changed.

### Tests first

- [X] T016 [P] [US1] Write `apps/desktop/src/main/system-events.test.ts` against a fake `powerMonitor`: `lock-screen` and `suspend` each send one `system-lock` with the right reason; the 5-second poll of `getSystemIdleState` sends `idle-state` once when it turns `locked` and not again until it unlocks; `resume` re-sends if the page has not reported `locked`; events are debounced to one per second; no event is sent when there is no window
- [X] T017 [P] [US1] Write `apps/web/src/ui/core/CoreProvider.desktop.test.tsx`: in the desktop app with `hideOnBlur` false, `blur` neither covers the content nor tells the worker `session.focus(false)`; with `hideOnBlur` true it does both and `focus` restores without a password; a `visibilitychange` to hidden still covers visually but sends nothing to the worker's hidden-window timer (research D1b); a `system-lock` event locks like the Lock button; in a browser every behaviour is exactly as before
- [X] T018 [P] [US1] Write the packaged spec `apps/desktop/e2e/lock-policy.spec.ts` (uses the T014 hooks): focus change keeps data visible; `lock-screen` and `suspend` events lock within 5 seconds and the window shows only the unlock screen; with a 1-minute idle time the app locks at one minute; with the option on, a blur hides the content at once; a hidden window is still unlocked after 90 seconds and locks at the idle time

### Implementation

- [X] T019 [US1] Create `apps/desktop/src/main/system-events.ts` implementing the behaviour pinned by T016, sending `system-lock` through the window's `webContents`, and calling an `onSystemLock` callback that other modules (badge, tray, recent Folds) use to clear their data; wire it in `apps/desktop/src/main/index.ts`
- [X] T020 [US1] Edit `apps/web/src/ui/core/CoreProvider.tsx`: read `useDesktop()`; on desktop ignore `blur` and `focus` for covering and for `session.focus` unless `settings.hideOnBlur`; on desktop do not forward the hidden state to the worker's hidden-window timer (keep the visual cover); subscribe to the bridge's `onSystemLock` and lock exactly as `lock()` does; report `locked` or `unlocked` to the shell through `reportSession` whenever the phase changes; the web path is untouched
- [X] T020a [US1] (added during implementation) Create `apps/web/src/ui/desktop/idle-lock.ts` and `DesktopIdleLock.tsx`, mounted in `UnlockedShell` through `DesktopOnly`: the desktop app's own idle lock that counts only the person's input. Needed because the worker's idle timer is reset by every worker call and the page polls `sync.status` every 15 seconds, so with the hidden-window timer gone the idle time would never be reached; the worker and the web app are left as they are (see the note in `baseline.md`); `idle-lock.test.ts`. The Settings → Profile 'hidden for' choice is hidden in the desktop app, where it no longer applies
- [X] T021 [P] [US1] Create the Settings → Desktop section: `apps/web/src/ui/settings/DesktopSection.tsx` (only rendered when `isDesktop`) with the switch "Hide the content when I switch to another window", a plain-language list of which events this computer reports (from the capability report; FR-005), and a note that the idle time also governs a minimised or hidden window; add the route `apps/web/src/app/settings/desktop/page.tsx` (in a browser it redirects to `/settings/`, so no route is empty and the route-walk tests still find one heading), the group in `apps/web/src/ui/settings/SettingsIndex.tsx` (desktop only) and the entry in `apps/web/src/ui/shell/routes.ts`; component test `DesktopSection.test.tsx` (desktop renders the switch; browser redirects)
- [X] T022 [P] [US1] Add the new text to `apps/web/src/ui/i18n/messages/en.json`, `uk.json` and `pl.json` (`settings.group.desktop`, `settings.desktop.*`) and run `npx vitest run apps/web/src/ui/i18n` so the completeness test passes in both languages
- [X] T023 [P] [US1] Write the security documents: add a "Desktop lock policy" section to `docs/threat-model.md` (what changes: focus loss no longer hides by default; the hidden window now locks at the idle time; what compensates: system lock, sleep and idle events; what is still true: a locked app shows nothing, no key is in the shell), create `docs/adr/0012-desktop-lock-policy-and-intake.md` with the lock part (the intake part is added in T062) and list it in `docs/adr/README.md`; add a note under FR-007 in `specs/001-secure-finance-core/spec.md`: "Amended for the desktop app by spec 006: focus loss no longer hides by default; see ADR-0012"
- [X] T024 [US1] Run `npx vitest run apps/desktop apps/web`, `pnpm --filter @cashfold/desktop test:packaged`, and the web Playwright specs `e2e/us1-account.spec.ts` and `e2e/shell.spec.ts` (`--project=chromium --workers=3`) to prove the browser path did not change, and `pnpm check:bundle` (no growth beyond the T012 figures); request two reviewers on the pull request (not done: no pull request exists yet)

**Checkpoint**: US1 works and ships alone.

---

## Phase 4: User Story 2 — It looks right from the first frame (P2)

**Goal**: the window is in the right colours from its first frame and follows the system theme.

**Independent test**: system dark, quit, start: no light frame. Theme Light on a dark system: opens light. Change the system theme with "System": follows within a second.

### Tests first

- [ ] T025 [P] [US2] Write `apps/desktop/src/main/appearance.test.ts`: the window colour for each of theme (`system` | `light` | `dark`) × system dark/light is `#ffffff` or `#09090b`; a test reads `apps/web/src/app/tokens.css` and fails if those two colours stop matching `--bg` of the light and dark themes; `themeSource` is set from the stored theme; a `nativeTheme` `updated` event under "System" updates the window colour
- [ ] T026 [P] [US2] Write `apps/web/src/ui/theme/ThemeProvider.desktop.test.tsx`: on desktop the provider sends the choice to the bridge at start and on every change and corrects the shell's mirror when it differs; in a browser it never calls the bridge

### Implementation

- [ ] T027 [US2] Create `apps/desktop/src/main/appearance.ts` (sets `nativeTheme.themeSource` from the stored theme at launch, answers the `theme` call by storing and applying it, exposes `backgroundColorFor(theme, systemDark)`, updates the live window on `nativeTheme` `updated`); edit `apps/desktop/src/main/window.ts` to create the window with that colour instead of the fixed `'#ffffff'`; wire the `theme` handler in `ipc.ts`/`index.ts`
- [ ] T028 [US2] Edit `apps/web/src/ui/theme/ThemeProvider.tsx` to call the bridge's `setTheme` when running in the desktop app, as in T026
- [ ] T029 [P] [US2] Write the packaged spec `apps/desktop/e2e/appearance.spec.ts`: with the stored theme `dark` the created window's background colour is `#09090b`; with `light` it is `#ffffff` whatever the system says; with `system` it follows `nativeTheme.themeSource = 'dark'` then `'light'` within one second
- [ ] T030 [US2] Run the T025 to T029 tests and `npx vitest run apps/web/src/ui/theme`; run `pnpm check:bundle`; check by eye on each system that no light frame appears in dark mode (record in the verification list, T076)

**Checkpoint**: US1 and US2 work.

---

## Phase 5: User Story 3 — Shortcuts (P3)

> **Superseded in part by [spec 007](../007-desktop-native-feel/spec.md):** the application menu bar is removed. Shortcuts stay, but are plain keyboard shortcuts in the shell's shortcut table (`apps/desktop/src/main/shortcuts.ts`, entries flagged `data: true`), with no menu entry and no menu to disable. Read "menu" below accordingly.


**Goal**: the listed shortcuts and menu entries work, in the language shown, and are disabled when locked.

**Independent test**: every shortcut and its menu entry do the same thing; the menu shows the shortcut that works; Polish menus after switching language; locked app: data entries disabled.

### Tests first

- [ ] T031 [P] [US3] Write the table-driven test in `apps/desktop/src/main/shortcuts.test.ts` (extending spec 007's): each action id of `contracts/menu-and-shortcuts.md` has the accelerator in the contract, none is duplicated, every entry is flagged `data: true` and is dropped while the session is `locked` except `lock`, a platform shortcut that clashes with ours is not registered (superseded: no menu model, see spec 007)
- [ ] T032 [P] [US3] Write `apps/web/src/ui/desktop/DesktopActions.test.tsx`: each action id performs its effect (add sheet, lock, Settings, Transactions with the search focused, each section, Settings → Data with import or export focused); while locked an incoming data action does nothing; an unknown id is ignored

### Implementation

- [ ] T033 [US3] Extend `apps/desktop/src/main/menu-labels.ts` with every menu, tray and dialog string needed here in `en`, `uk` and `pl` (no menu names after spec 007; the tray, dock-menu and jump-list strings are added with the tray in the US5 text task), and extend `menu-labels.test.ts` so a missing language fails
- [ ] T034 [US3] Add the app-action entries (`CmdOrCtrl+N`, `+L`, `+,`, `+F`, `+1` to `+5`, `Shift+CmdOrCtrl+I` and `+E`) to the table in `apps/desktop/src/main/shortcuts.ts`, each sending `menu-action` with its id (superseded: there is no `app-menu.ts` and no menu)
- [ ] T035 [US3] Create `apps/web/src/ui/desktop/DesktopActions.tsx` mounted in `UnlockedShell` (`apps/web/src/ui/shell/AppShell.tsx`) through `DesktopOnly` (loaded only in the desktop app): subscribes to the bridge's `onMenuAction` and maps each action to `useAddSheet().openAdd()`, `core.lock()`, `router.push(...)`, or a focus request; add a tiny focus-request store in `apps/web/src/ui/desktop/focus-request.ts`; edit `apps/web/src/ui/transactions/TransactionsScreen.tsx` to focus its search field on a `search` request and `apps/web/src/ui/data/DataScreen.tsx` to focus the import or export panel on a request
- [ ] T036 [P] [US3] Write the packaged spec `apps/desktop/e2e/shortcuts.spec.ts`: press each shortcut and check the page effect (superseded: no menu items to click)
- [ ] T037 [US3] Run the T031 to T036 tests; run `pnpm check:bundle`; update `docs/desktop.md` with the menu and shortcut table (generated or copied from the contract)

**Checkpoint**: US3 works.

---

## Phase 6: User Story 4 — Right-click menus and dropping files in (P4)

**Goal**: rows have a native context menu with exactly their existing actions; a CSV dropped on the window starts the import; a receipt dropped on the sheet attaches.

**Independent test**: right-click a transaction and an account: the same actions as their buttons; drop a CSV: import preview; drop a picture on the add sheet: attached on save; unsupported or oversized or locked: a message and nothing changes.

### Tests first

- [ ] T038 [P] [US4] Write `apps/web/src/ui/transactions/row-actions.test.ts` and `apps/web/src/ui/accounts/account-actions.test.ts`: the functions that will serve both menus return the same ids and order as the current dropdowns (edit, pin or unpin, duplicate, delete for a transaction; the account's current set), with delete flagged destructive
- [ ] T039 [P] [US4] Write `apps/desktop/src/main/context-menu.test.ts`: a valid request pops up a menu with the given items and resolves with the chosen id or `null`; a request breaking any rule in `PopupMenuRequestSchema` is refused and nothing is shown
- [ ] T040 [P] [US4] Write `apps/web/src/ui/desktop/DropTarget.test.tsx`: a `.csv` under 16 MiB dropped on the window calls the import hand-off; an unsupported type, an empty file and a file over its limit show a message and do nothing; a drop while locked, or on a page before sign-in, is ignored with a message and the default is still cancelled (the guard, not only the unlocked target); the default navigation is always prevented; nothing happens in a browser

### Implementation

- [ ] T041 [US4] Extract the actions of a transaction row into `apps/web/src/ui/transactions/row-actions.ts` and of an account into `apps/web/src/ui/accounts/account-actions.ts`, and make the existing `DropdownButton` menus in `TransactionsScreen.tsx` (both row types around lines 365 and 399) and `AccountsScreen.tsx` (line 128) render from them, with no change in what they show
- [ ] T042 [US4] Create `apps/desktop/src/main/context-menu.ts` (validated native pop-up through `Menu.popup` at the pointer) and wire the `popupMenu` handler; create `apps/web/src/ui/desktop/ContextMenu.ts` with a `useRowContextMenu(actions)` hook returning an `onContextMenu` handler (works for the context-menu key and Shift+F10) that asks the bridge and runs the chosen action, falling back to nothing in a browser; attach it to transaction rows and account rows
- [ ] T043 [US4] Create `apps/web/src/ui/desktop/DropGuard.tsx` mounted in both shells through `DesktopOnly` (window-level `dragover` and `drop` always cancel the default; while locked, or on the unlock, sign-up and recover pages, a drop is ignored with a message "unlock first") and `apps/web/src/ui/desktop/DropTarget.tsx` mounted in `UnlockedShell` through `DesktopOnly`: window-level `dragover` and `drop` that prevent the default, check kind and size before reading, and hand a CSV to the import panel through `apps/web/src/ui/desktop/import-handoff.ts`; edit `apps/web/src/ui/data/CsvImportPanel.tsx` to take a pending file from the hand-off (file chosen, preview shown, nothing imported until confirmed) and navigate to `/settings/data/` when a CSV is dropped elsewhere; edit `apps/web/src/ui/ledger/AttachmentField.tsx` to accept a drop on the add sheet within `MAX_ATTACHMENT_MB`
- [ ] T044 [P] [US4] Add the new text (`desktop.drop.*` messages: unsupported kind, too large, empty, unlock first) to `en.json`, `uk.json`, `pl.json` and keep the completeness test green
- [ ] T045 [P] [US4] Write the packaged spec `apps/desktop/e2e/gestures.spec.ts`: a dispatched `drop` event carrying a `DataTransfer` with a CSV opens the import preview; the context menu request for a transaction row returns the expected item list through the test hooks; both are ignored when locked; the time from the `drop` event to the import preview being shown is under two seconds for a 5,000-row file (SC-004)

**Checkpoint**: US4 works.

---

## Phase 7: User Story 5 — Dock or taskbar badge, notifications, tray, dock menu, jump list (P5)

**Goal**: a count of waiting entries while unlocked, native reminders on any screen and in the background, a tray or menu-bar item and quick actions; nothing while locked. Needs the background mode from T013.

**Independent test**: create entries that ask for confirmation: the badge shows and falls; with the window hidden a reminder appears natively within a minute and brings the app forward; lock: badge and menus clear; unlock: one summary notification.

### Tests first

- [ ] T046 [P] [US5] Write `apps/desktop/src/main/badge.test.ts` (count clamps to 0 to 999; 0 clears; Windows uses the overlay image for 1 to 9 and "9+" with a description; macOS uses `setBadgeCount`; the badge is cleared on a system lock and on quit) and `apps/desktop/src/main/tray.test.ts` (the tray, dock-menu and jump-list models are exactly the entries in `contracts/menu-and-shortcuts.md`; with `session: locked` or after a system lock no Fold name is present anywhere; recent Folds are cleared on lock and on quit, and at every start the dock menu and jump list are reset to tasks only (a stale list left by a crash is removed); a launch argument `--action=` outside the closed set is ignored)
- [ ] T047 [P] [US5] Write `apps/desktop/src/main/security.test.ts` additions: `notifications` is granted for the app origin and for no other origin; the previous grants are unchanged
- [ ] T048 [P] [US5] Write `apps/web/src/ui/desktop/ReminderService.test.tsx` (use fake timers and a fake ledger): it runs on every screen, not only Schedules; shows a due reminder once; shows no amount unless the opt-in is on; while the session is locked nothing runs; after unlock several missed reminders become one notification and one stays as it is today; it sets the badge to the waiting count and to 0 on lock; a notification click calls `showWindow` and navigates; without permission it shows nothing and does not fail
- [ ] T049 [P] [US5] Extend `apps/web/src/adapters/notifications/notify.test.ts` for the new "many due at once" summary behaviour of `showDueReminders`

### Implementation

- [ ] T050 [US5] Edit `apps/desktop/src/main/security.ts` to grant `notifications` for the app origin only (extend `GRANTED`/`decidePermission`)
- [ ] T051 [US5] Generate the number images and the tray images: edit `scripts/gen-brand-assets.mjs` to write `apps/desktop/build/badges/1.png` to `9.png` and `9plus.png` (overlay icons, 32 px) and `apps/desktop/build/tray/` (a macOS template image at 1x and 2x, and coloured images for Windows and Linux) from the master mark, run it, check that the output is stable (the brand-asset check must still pass), and add the folder to the packaged files in `apps/desktop/electron-builder.config.mjs`
- [ ] T052 [US5] Create `apps/desktop/src/main/badge.ts` and `apps/desktop/src/main/tray.ts` (tray or menu-bar item, macOS dock menu, Windows jump list; labels from `menu-labels.ts`; quick actions through the same action enum; recent Folds only while unlocked and cleared by `onSystemLock`, by a `session: locked` report and on `before-quit`, and the jump list and dock menu are reset to tasks only at every start); wire the `badge` and `recentFolds` handlers and the `--action=` handling of `second-instance` in `index.ts`
- [ ] T053 [US5] Extend `apps/web/src/adapters/notifications/notify.ts` so `showDueReminders` shows one summary notification when more than one reminder is fresh at once (new text `schedules.notify.message.many`) and exactly the current notification when there is one; keep the 60-second cadence
- [ ] T054 [US5] Create `apps/web/src/ui/desktop/ReminderService.tsx` mounted once in `UnlockedShell`: runs the reminder check from the moved `Reminders` logic for the selected Fold on every screen and every 60 seconds, computes the waiting count with the existing `useScheduleInbox`, calls the bridge's `setBadge` and `setRecentFolds`, shows notifications with `new Notification` (falling back from the service-worker path when it throws), and on click calls `showWindow` and navigates to Plan → Schedules; remove the `Reminders` component from `apps/web/src/ui/plan/SchedulesView.tsx` (keep `ReminderSettings`); the service also runs in a browser tab (the one intended change in web behaviour, recorded in the spec's Assumptions) and only its desktop-only parts (badge, recent Folds, window show) are loaded through `DesktopOnly`; add a web check to `e2e/us6-schedules.spec.ts`: with notification permission granted a due reminder is shown while a screen other than Schedules is open
- [ ] T055 [US5] Activate background mode: in `apps/desktop/src/main/index.ts` pass `enabled = settings.closeBehavior === 'background' && capabilities.statusItem` to `background.ts` and keep it in step when the setting changes; apply `closeBehavior` when `settingsSet` changes it; add the "When I close the window" choice (quit, or keep running in the background; the second is shown only when `capabilities.statusItem`) to `apps/web/src/ui/settings/DesktopSection.tsx`; extend `background.test.ts` and the packaged spec of T057 with: defaults are quit on Windows and Linux and keep running on macOS, `'background'` is refused where `statusItem` is false, a hidden window keeps its session and timers, Quit really quits
- [ ] T056 [P] [US5] Add the new text to `en.json`, `uk.json`, `pl.json` (`schedules.notify.message.many`, the Settings → Desktop note that reminders need the app unlocked and the close-window choice) and the tray, dock-menu and jump-list strings to `apps/desktop/src/main/menu-labels.ts` in the three languages with a test that none is missing and keep the completeness test green
- [ ] T057 [P] [US5] Write the packaged spec `apps/desktop/e2e/presence.spec.ts`: the badge equals the number of waiting entries and is 0 after a lock event; a hidden window still shows a due reminder; no notification and no badge while locked; the tray, dock-menu and jump-list models contain no Fold name when locked; `--action=add-transaction` on a second launch shows the window

**Checkpoint**: US5 works.

---

## Phase 8: User Story 6 — Start at login, background, files and links (P6)

**Goal**: start at login (off by default), a choice of what closing does, files and `cashfold://` links that only open the right screen for review, one copy running. **Two reviewers.**

**Independent test**: login item on, sign out and in: running, locked, no window. Open a CSV, a backup, a valid link, a link with a secret and a malformed one: the first three go to review screens and change nothing; the others are refused with a message. A second launch hands over.

### Tests first

- [ ] T058 [P] [US6] Write `apps/desktop/src/main/intake.test.ts` as table-driven tests of `contracts/link-and-file-intake.md`: every accepted link; every refusal (rule 1 to 7: too long, wrong host, fragment, user-information, extra or repeated parameter, bad email, non-https server, secret-like parameter name, `C1-` and `R1-` patterns anywhere, control characters, double-encoded values); the file checks (regular file, size on the descriptor before reading, extension, empty, directory, link to a device); the queue (at most 8, held while locked, delivered one at a time after `session: unlocked`, dropped on quit); log lines carry only kind, decision and reason code
- [ ] T059 [P] [US6] Write `apps/desktop/src/main/launch.test.ts`: start-at-login settings per platform (Windows and macOS through the login-item API with a hidden-start argument; Linux writes `~/.config/autostart/cashfold.desktop` with the AppImage path or the executable), removal when off, a failure reported in the result without changing the stored choice; a hidden start creates the window hidden
- [ ] T060 [P] [US6] Write `apps/web/src/ui/desktop/incoming.test.tsx`: a `csv` item opens the import panel with the file chosen; a `backup` item opens the restore form with the file chosen and no passphrase; an `add-device` link opens the add-device screen with email and service address filled and the Secret Key empty; an `open` link navigates; an app that already has an account says so; nothing is imported, restored or signed in on arrival

### Implementation

- [ ] T061 [US6] Create `apps/desktop/src/main/intake.ts` implementing the contract (parsing, descriptor-based file reading with size and kind checks, the in-memory queue with hold-while-locked and one-at-a-time delivery, logging of kind/decision/reason only); handle macOS `open-file` and `open-url` (queued if they arrive before `ready`) and Windows/Linux command-line arguments in `second-instance` in `apps/desktop/src/main/index.ts`; the second launch brings the running window to the front; add `app.setAsDefaultProtocolClient('cashfold')` for unpackaged runs
- [ ] T062 [US6] Security documents for intake: add an "Input from outside the window" section to `docs/threat-model.md` (links without secrets and why, descriptor-checked files, hold-while-locked, no recent-documents registration) and complete `docs/adr/0012-desktop-lock-policy-and-intake.md`
- [ ] T063 [US6] Create `apps/desktop/src/main/launch.ts` (login item on Windows and macOS, the Linux autostart entry, hidden start), apply it when `settingsSet` changes `startAtLogin`, and return the real result of applying so the page can show it
- [ ] T064 [US6] Edit `apps/desktop/electron-builder.config.mjs` and `scripts/check-desktop-config.mjs`: register the `cashfold` protocol (macOS `protocols`, NSIS registry, Linux `x-scheme-handler/cashfold` in the `.desktop` file), the `.cashfold-backup` extension as the default type for Cashfold, and CSV as an alternative handler only (research D10, verification V4); add the new checks to the config checker
- [ ] T065 [US6] Handle incoming items on the page: extend `apps/web/src/ui/desktop/DesktopActions.tsx` (or a sibling `IncomingHandler.tsx`) to subscribe to `onIncoming`, show them one at a time, route a `csv` to `CsvImportPanel` through `import-handoff.ts`, a `backup` to the restore form in `apps/web/src/ui/data/BackupPanel.tsx` (file chosen, passphrase asked), and links to the add-device screen `apps/web/src/ui/devices/AddDeviceScreen.tsx` (prefill email and service address only) or the named section; show a clear message for a refused item
- [ ] T066 [US6] Extend `apps/web/src/ui/settings/DesktopSection.tsx` with "Start Cashfold when I sign in", showing the result of applying it; keep the completeness test green with the new text in `en.json`, `uk.json`, `pl.json`
- [ ] T067 [P] [US6] Write the packaged spec `apps/desktop/e2e/intake.spec.ts` through the test hooks: a second launch with a valid CSV path, a valid backup path, a valid link and each kind of refused link and file; items are held while locked and delivered after unlock; no image of a refused link appears in the log; only one app process exists after a second launch
- [ ] T068 [US6] Run the T058 to T067 tests, `pnpm check:desktop-config`, `pnpm check:bundle` and the packaged suite; request two reviewers on the pull request

**Checkpoint**: US6 works.

---

## Phase 9: User Story 7 — A frame that belongs to the app (P7)

**Goal**: the title bar is part of the app's own top bar on macOS and Windows, the system's on Linux; optional translucent sidebar; nothing hidden under the system buttons. May slip without blocking anything.

**Independent test**: drag, double-click, snap, maximise, full screen and the smallest size on each system; keyboard access to the controls; reduced transparency turns the sidebar plain.

### Tests first

- [ ] T069 [P] [US7] Write `apps/desktop/src/main/frame.test.ts`: window options per platform (`titleBarStyle: 'hidden'` with the traffic-light position on macOS; `titleBarStyle: 'hidden'` with `titleBarOverlay` colours from the theme and the bar height on Windows; the system frame on Linux); translucency options (vibrancy on macOS, Mica on Windows 11 build 22621 or later, none otherwise); `prefersReducedTransparency` or high contrast turns them off live; `frame-state` events on full screen and maximise
- [ ] T070 [P] [US7] Write `apps/web/src/ui/desktop/FrameBar.test.tsx`: the bar renders only in the desktop app on macOS and Windows; it is a drag region and every control inside has `no-drag`; the left inset is applied on macOS and removed in full screen; the right inset on Windows comes from the overlay area; `data-translucent` follows the shell's `frame-state`

### Implementation

- [ ] T071 [US7] Create `apps/desktop/src/main/frame.ts` implementing T069 and edit `apps/desktop/src/main/window.ts` to use it; update the overlay colours when the theme changes; send `frame-state` on `enter-full-screen`, `leave-full-screen`, `maximize`, `unmaximize` and when translucency is switched off
- [ ] T072 [US7] Create `apps/web/src/ui/desktop/FrameBar.tsx` and `FrameInsets.tsx`: set `data-platform` and `data-frame` on `<html>` from the synchronous `platform` property before first paint (no layout shift), render a slim drag bar (height held in the CSS variable `--frame-bar-h`, zero when the frame is the system's) above the content in both `PlainShell` and the unlocked layout in `apps/web/src/ui/shell/AppShell.tsx`, and put the CSS in `apps/web/src/app/globals.css`: `-webkit-app-region: drag` on the bar and `no-drag` on its controls, the macOS left inset, the Windows right inset from `env(titlebar-area-*)`
- [ ] T073 [US7] Make the layouts account for the bar: edit `apps/web/src/ui/kit/auth-layout.tsx` and `apps/web/src/ui/kit/sidebar-layout.tsx` (and the sticky offsets in `apps/web/src/ui/shell/Topbar.tsx`) to subtract `--frame-bar-h` from their minimum heights using the variable (the variable is `0px` in a browser and on Linux, so the web layout is unchanged); add the translucent sidebar styling under `[data-translucent]` only; check both pre-sign-in and signed-in pages at 320 px and 1280 px
- [ ] T074 [P] [US7] Write the packaged spec `apps/desktop/e2e/frame.spec.ts` through the test hooks: the created window has the expected frame options per platform; the page has the expected `data-platform`/`data-frame`; the bar element has the drag region style and its buttons do not; the minimum-size window has no horizontal overflow and nothing overlaps the reserved inset; a reduced-transparency change removes `data-translucent`
- [ ] T075 [US7] Run the T069 to T074 tests, the web Playwright `a11y.spec.ts` and `ux-responsive.spec.ts` (`--project=chromium --workers=3`) to prove the browser layout is unchanged, `pnpm check:bundle`, and the packaged suite

**Checkpoint**: all seven stories work.

---

## Phase 10: Polish and cross-cutting

- [ ] T076 Record the real-machine checks V1 to V6 (research.md; V6 is start at login within 10 seconds, SC-006, and the review by people who use native finance apps, SC-010) in `specs/006-native-desktop-experience/verification.md` with the system, the result and the date for each of macOS, Windows 11, Windows 10 and two Linux desktops (one on the allow-list, plain GNOME); anything that fails becomes a follow-up item, not a silent skip
- [ ] T077 [P] Update `docs/desktop.md` (menus and shortcuts, background mode, start at login, links and files, the frame, what is best effort on Linux) and `README.md` / `apps/desktop/README.md` (one paragraph each); keep `pnpm check:docs` green
- [ ] T078 [P] Run `npx vitest run apps/web/src/ui/i18n` and the pseudo-locale walk (`env -u ELECTRON_RUN_AS_NODE npx playwright test -c e2e/playwright.config.ts --project=pseudo --workers=3`) to prove no hard-coded text and complete en/uk/pl catalogues; add the desktop-only strings to a component test since the browser walk cannot see them
- [ ] T079 [P] Accessibility pass for the desktop-only interface: Settings → Desktop, the drop messages and the frame bar with the existing axe rules in a component or packaged test, keyboard order around the traffic-light and overlay insets, reduced motion and high contrast behaviour
- [ ] T080 Make sure the CI workflows run the new packaged specs (`.github/workflows/ci.yml`, `desktop-smoke.yml`): they run `test:packaged` as a whole, so confirm the new files are picked up, the three systems all run them, and macOS/Windows/Linux-specific specs skip with a reason on the others
- [ ] T081 Final verification: `pnpm typecheck`, `npx eslint apps packages e2e scripts`, `npx vitest run`, `pnpm check:docs`, `pnpm check:bundle`, `node scripts/build-verify.mjs`, the web Playwright suite on `chromium`, `rtl`, `webkit` and `firefox` (`--workers=3`), the packaged suite, and the by-hand walk of `quickstart.md`

---

## Dependencies and order

- Phase 1 → Phase 2 → stories in order US1 → US7 → Phase 10. Each story ships as its own pull request once Phase 2 is merged; US2, US3 and US7's first half do not depend on US1.
- US4 uses the action model of US3 only for naming; the row actions (T041) are independent. US5 needs only Phase 2: the close-to-background mechanism (T013) is built there but stays inactive until the US5 activation task (T055), and the tray text is written in the US5 text task. US6 needs the tray from US5 and the settings section from T021.
- Inside a story: tests first, then the main-process module, then the page side, then text and docs.
- `en.json`, `uk.json` and `pl.json` are edited by several stories: land each story's keys together and keep `catalogue-complete.test.ts` green at every commit.
- `apps/desktop/src/main/index.ts` is edited by T015, T019, T027, T034, T052, T055, T061 and T063: do those in order. Every desktop-only web module is loaded through `DesktopOnly` (T012) so the web bundle does not grow.

## Parallel examples

- Phase 2: T002, T003, T004, T006, T007 together; then T008 and T009 together; T010, T011 and T012 together.
- US1: T016, T017, T018 together; T021, T022, T023 together.
- US3: T031 and T032 together; US4: T038, T039, T040 together; US5: T046 to T049 together; US6: T058, T059, T060 together; US7: T069 and T070 together.
- Polish: T077, T078, T079 together.

## Implementation strategy

1. **MVP = Phases 1, 2 and 3 (US1).** The foundation and the lock policy: it removes the most irritating non-native behaviour and is the only security-relevant change that has to be reviewed first.
2. Then US2 and US3 (small, visible), US4 and US5 (the desktop idioms and presence), US6 (background, files, links; second security review), and US7 last, which may slip.
3. Every story is releasable on its own; stop after any of them and the app is better than before.

## Notes

- Items that need a real machine are in T076; the packaged tests use simulated events (`powerMonitor.emit`, launch arguments, dispatched drops), so a green CI does not prove the real system events: V1 to V5 do.
- The badge and the reminders cover the selected Fold in this release (research D6, spec Assumptions); all-Folds is a follow-up. Close-to-background is built in the foundation but inactive until T055; do not enable it earlier.
- The spec wording adjustments from the plan (FR-003 hidden window, FR-016 selected Fold, the entities note, the slim bar at the top, the web reminders assumption) are applied in `spec.md`.
