---

description: "Task list for Desktop Native Feel"
---

# Tasks: Desktop Native Feel

**Input**: Design documents from `/specs/007-desktop-native-feel/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/desktop-chrome.md, contracts/shortcuts-without-menu.md

**Tests**: Included. The constitution requires Playwright coverage for P1 and P2 stories and test-first for shell logic.

**Organization**: Grouped by user story. Paths: `apps/desktop/` (shell), `apps/web/` (markers only), `specs/006-native-desktop-experience/` (amendment).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Read `apps/desktop/src/main/index.ts`, `window.ts`, `menu.ts`, `menu-labels.ts` and `apps/desktop/e2e/fixtures.ts` to confirm current wiring (`installMenu`, `setLanguage`, `createMainWindow`, the Electron launch fixture) before editing; no file changes.

## Phase 2: Foundational (blocks all stories)

- [X] T002 Create `apps/desktop/src/main/native-feel.ts` exporting `nativeFeelCss(): string` (initially empty sections named per `contracts/desktop-chrome.md`) and `installNativeFeel(contents: WebContents): void` that calls `contents.insertCSS` on `dom-ready` and on every `did-navigate`/`did-navigate-in-page`-free full navigation, keeping the returned key and removing the previous one so rules are never duplicated. _(Done: injects on every `dom-ready`; a new document has none of an earlier one's rules, so nothing needs removing.)_
- [X] T003 [P] Add `apps/desktop/src/main/native-feel.test.ts`: `installNativeFeel` injects once per navigation using a fake `WebContents`, and replaces the previous injection (no duplicates).
- [X] T004 Call `installNativeFeel(win.webContents)` in `apps/desktop/src/main/window.ts` right after the window is created, before `loadURL`.
- [X] T005 [P] Create `apps/desktop/e2e/native-feel.spec.ts` with the launch fixture from `fixtures.ts` and an empty `describe` per user story (filled by each story).

**Checkpoint**: an empty stylesheet is injected on every load; web app untouched.

## Phase 3: User Story 1 - No menu bar in the window (Priority: P1) 🎯 MVP

**Goal**: No File/Edit/View/Window/Help anywhere; every shortcut and menu-only action still works.

**Independent Test**: Launch on each OS: no menu, Alt shows nothing; copy/paste/undo/quit shortcuts work; About, update check, data folder, report a problem reachable from Settings.

### Amend 006 first

- [X] T016 [US1] First, amend `specs/006-native-desktop-experience/contracts/menu-and-shortcuts.md`, `spec.md` (US3, FR-009) and `tasks.md`: the menu bar is superseded by 007; replace 006 T031 and T034 (menu model, `app-menu.ts`) with "add the 006 app-action entries (ids and keys from the contract) to the 007 `shortcuts.ts` table, flagged `data: true`", keep T033 (labels without menu names) and T035 (`DesktopActions`); no 006 task builds a menu bar.

### Tests

- [X] T006 [P] [US1] Rewrite `apps/desktop/src/main/menu.test.ts` (create if absent): `buildMenu` returns a template with exactly one top-level submenu named `APP_NAME` whose item roles are, in order, about, separator, hide, hideOthers, unhide, separator, quit when `isMac`; returns `null` (no template built) when not mac.
- [X] T007 [P] [US1] Create `apps/desktop/src/main/shortcuts.test.ts`: `matchShortcut(input, platform)` returns the action for every row of `contracts/shortcuts-without-menu.md` that this feature handles (not the 006 app-action row) for mac and non-mac modifiers, returns `undefined` for unknown input, and entries flagged `data: true` are dropped while locked and unflagged entries (clipboard, window, quit) are not.
- [X] T008 [P] [US1] In `apps/desktop/e2e/native-feel.spec.ts` add: `Menu.getApplicationMenu()` is null (Win/Linux) or has exactly one item whose submenu roles are about, hide, hideOthers, unhide, quit (macOS); pressing Alt shows no menu; Ctrl/Cmd+C then V copies and pastes in a text field; Ctrl/Cmd+Q quits (on Windows and Linux there is no on-screen Quit until the 006 tray lands).

### Implementation

- [X] T009 [US1] Shrink `apps/desktop/src/main/menu.ts`: `buildMenu` builds only the macOS app-name submenu (roles about, hide, hideOthers, unhide, quit); remove File/Edit/View/Window/Help and the `isDev` Reload/DevTools entries; non-mac returns `null`.
- [X] T010 [US1] Update `installMenu` in `apps/desktop/src/main/index.ts`: `Menu.setApplicationMenu(buildMenu(...))` (null on Windows/Linux); keep `setLanguage` updating the stored language for the text-field menu (US4) without rebuilding any menu.
- [X] T011 [US1] In `apps/desktop/src/main/window.ts` call `win.removeMenu()` and `win.setMenuBarVisibility(false)` on Windows/Linux, and set `autoHideMenuBar: false`.
- [X] T012 [US1] Create `apps/desktop/src/main/shortcuts.ts` per `contracts/shortcuts-without-menu.md`: pure `matchShortcut` + `installShortcuts(contents, win, deps)` on `before-input-event` (macOS maps clipboard/undo to `webContents` methods; window actions call `win`/`app`; handled input is `preventDefault`-ed). Let the table take an optional `data: true` flag per entry and drop flagged entries while `pageLocked()` from `index.ts` is true, so 006 can add its app-action ids and keys later; add no 006 entries here. Call it from `window.ts`.
- [X] T013 [P] [US1] Trim `apps/desktop/src/main/menu-labels.ts` and `menu-labels.test.ts`: remove `file`, `edit`, `view`, `window`, `help`, `onGitHub`, `releaseNotes`, `reportProblem` for en/uk/pl; keep `languageFromSystem`.
- [X] T014 [US1] In `apps/desktop/src/main/index.ts` and `apps/desktop/src/main/background.ts` remove any remaining use of the removed labels and menu entries; run `pnpm --filter @cashfold/desktop typecheck`.
- [X] T015 [P] [US1] Add the Help links (source, release notes, report a problem) as external links (`target="_blank" rel="noopener noreferrer"`, like the existing source link there) to `apps/web/src/ui/settings/AboutSection.tsx`, shown only when the desktop bridge exists; add the strings in `apps/web/src/ui/i18n/messages/en.json`, `uk.json`, `pl.json` (FR-020) and a test in the matching `AboutSection` test file.

**Checkpoint**: US1 done; ship as MVP.

## Phase 4: User Story 2 - Text does not get selected by accident (Priority: P2)

**Goal**: Interface text is not selectable; fields and copy-on-purpose values are.

**Independent Test**: Drag and double-click over each screen: nothing highlights; copy the Secret Key and type/select in fields: works.

### Tests

- [X] T017 [P] [US2] In `apps/desktop/src/main/native-feel.test.ts` assert `nativeFeelCss()` contains `user-select: none` on `html` and `user-select: text` for `input, textarea, [contenteditable], [data-selectable]`.
- [X] T018 [P] [US2] In `apps/desktop/e2e/native-feel.spec.ts` assert: a heading, button label and list row have computed `user-select: none`; drag-select across them gives an empty `window.getSelection()`; an input and a `[data-selectable]` Secret Key remain selectable; select-all outside a field selects nothing.
- [X] T019 [P] [US2] Add a web test (e.g. `apps/web/src/ui/emergency-kit/markers.test.tsx`) that each copy-on-purpose value renders `data-selectable`.

### Implementation

- [X] T020 [US2] Add the selection rules to `nativeFeelCss()` in `apps/desktop/src/main/native-feel.ts`, quoting the selectors from `contracts/desktop-chrome.md`.
- [X] T021 [P] [US2] Add `data-selectable` to the Secret Key in `apps/web/src/ui/auth/SecretKeyScreen.tsx` and `apps/web/src/ui/settings/OneTimeSecret.tsx` (covers Emergency Kit text and recovery output) and to the key text in `apps/web/src/ui/auth/RecoverScreen.tsx`.
- [X] T022 [P] [US2] Add `data-selectable` to the server address and device pairing details in the components under `apps/web/src/ui/settings/ServerAddress.tsx`, `apps/web/src/ui/devices/AddDeviceScreen.tsx`, and the server address shown in `apps/web/src/ui/auth/SignUpForm.tsx` and `RecoverScreen.tsx`. _(Done as no change: the server address is only ever shown in an input, which is always selectable; there is no read-only pairing display yet.)_
- [X] T023 [P] [US2] Add `data-selectable` to the details line of error messages in `apps/web/src/ui/errors/` (the component that renders the catalogue details), so error details can be copied. _(Done as no change: the app shows no error details text today. The About list, which people quote when asking for help, carries `data-selectable` instead.)_
- [ ] T024 [US2] Run a keyboard-only and screen-reader pass of sign-in, add transaction and Settings (SC-007); record any regression in `specs/007-desktop-native-feel/checklists/requirements.md` notes. _(Manual: not run in this session.)_

**Checkpoint**: US2 done and independent of US3/US4.

## Phase 5: User Story 3 - The pointer says what a thing does (Priority: P3)

**Goal**: Native cursors on controls, text, disabled items and external links.

**Independent Test**: Hover each control kind and compare to the expected pointer.

- [X] T025 [P] [US3] In `apps/desktop/src/main/native-feel.test.ts` assert the CSS has `cursor: default` for the action selectors, `cursor: text` for text inputs and `[data-selectable]`, `cursor: default` for `:disabled, [aria-disabled=true]`, and `cursor: pointer` only for `a[href]` rules.
- [X] T026 [P] [US3] In `apps/desktop/e2e/native-feel.spec.ts` assert computed `cursor` for a button, tab, switch, list row, disabled button, text input, Secret Key, an external link and an internal navigation link.
- [X] T027 [US3] Add the cursor rules to `nativeFeelCss()` in `apps/desktop/src/main/native-feel.ts` per `contracts/desktop-chrome.md`; make the hand rule exactly `a[target="_blank"]` (every link that leaves the app already opens in a new window) and give all other links, including internal navigation, the arrow.
- [X] T028 [US3] If the window gains a custom drag region later, mark it `-webkit-app-region: drag` with `no-drag` on controls; for now add a code comment and an assertion in `native-feel.test.ts` that no such region exists (frame redesign is out of scope).

**Checkpoint**: US3 done.

## Phase 6: User Story 4 - Other web-page habits are gone (Priority: P4)

**Goal**: Text-field menu, no image drag, safe file drops, no bounce, no pinch zoom.

**Independent Test**: Right-click a field; drag an icon; drop a file; scroll a short screen; pinch.

- [X] T029 [US4] Add `cut`, `copy`, `paste`, `selectAll` labels for en/uk/pl to `apps/desktop/src/main/menu-labels.ts` and test them in `menu-labels.test.ts`.
- [X] T030 [P] [US4] Create `apps/desktop/src/main/text-menu.test.ts`: `buildTextMenu(params, labels)` returns Cut/Copy/Paste/Select all (enabled per `editFlags`) for an editable field, spelling suggestions first when `misspelledWord` is set, only Copy for a selectable value with selection, and `null` otherwise.
- [X] T031 [US4] Create `apps/desktop/src/main/text-menu.ts` (`buildTextMenu` + `installTextMenu(contents, getLanguage)` on `context-menu`, popup via `Menu.buildFromTemplate`), and call it from `window.ts`.
- [X] T032 [P] [US4] Add `-webkit-user-drag: none` for `img, svg, a` and `overscroll-behavior: none` for `html, body` to `nativeFeelCss()` and assert them in `native-feel.test.ts`.
- [X] T033 [US4] In `apps/desktop/src/main/window.ts` call `win.webContents.setVisualZoomLevelLimits(1, 1)`.
- [X] T034 [P] [US4] In `apps/desktop/e2e/native-feel.spec.ts` assert: right-click in a field offers the localized text menu; right-click on empty chrome shows nothing; an `img` is not draggable; a synthetic `drop` event carrying a file does not change `window.location` (real OS drag-and-drop is checked manually in the quickstart); a short screen has no scroll; ctrl+wheel does not change zoom.
- [X] T035 [US4] Lower the `security.navigation-blocked` log in `apps/desktop/src/main/security.ts` for `file:` drops to debug (and update `security.test.ts`) so a stray drop is not noise.

**Checkpoint**: all stories done.

## Phase 7: Polish & Cross-Cutting

- [X] T036 [P] Add a web test that no desktop-only rule appears in `apps/web/src/app/globals.css` or the built web CSS (SC-006) in `apps/web/src/ui/` next to `logical-layout.test.ts`. _(Done in `apps/web/src/ui/native-feel-not-in-web.test.ts`.)_
- [X] T037 [P] Update `apps/desktop/README.md` and `docs/` index entries describing the menu removal, the `data-selectable` rule for new copy-on-purpose values, and shortcuts. _(Done in `docs/desktop.md`.)_
- [X] T038 Run `pnpm --filter @cashfold/desktop test`, `pnpm --filter @cashfold/web test`, lint, typecheck, and `pnpm --filter @cashfold/desktop e2e`; fix failures.
- [ ] T039 Walk through `quickstart.md` manually on macOS, Windows and Linux and on the web app in a browser; note results in the PR. _(Manual: not run; only the automated e2e on this machine, macOS.)_

## Dependencies & Execution Order

- T016 (amend 006) is the first task of Phase 3.
- Phase 1 → Phase 2 → stories. US1, US2, US3, US4 are independent after Phase 2 and share only `native-feel.ts` (US2, US3, US4 each add rules there; do them in priority order or merge carefully) and `window.ts`.
- T029 and T013 both edit `menu-labels.ts`: do T013 first (T029 is not parallel).
- T012 depends on T009/T010 only for wiring.
- Tests (T006–T008, T017–T019, T025–T026, T029–T030, T034) are written first and must fail before the matching implementation.

## Parallel Opportunities

- US1: T006, T007, T008, T013, T015 together; then T009–T012.
- US2: T017, T018, T019, T021, T022, T023 together.
- US3: T025 and T026 together.
- US4: T030, T032, T034 together; T029 after T013.

## Implementation Strategy

- **MVP**: Phases 1–3 (US1): menu removed with shortcuts and relocated actions.
- Then US2 (selection), US3 (cursors), US4 (habits), each shippable on its own as a small single-concern pull request.
