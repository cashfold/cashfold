---

description: "Task list for Help shows the keyboard shortcuts"
---

# Tasks: Help Shows the Keyboard Shortcuts

**Input**: Design documents from `/specs/008-help-keyboard-shortcuts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/help-dialog.md, quickstart.md

**Tests**: Included. The spec requires a drift test (FR-014) and accessibility checks (FR-011), and the constitution requires test-first work and Playwright coverage for P1/P2 stories.

**Organization**: Grouped by user story. Message keys (all in `apps/web/src/ui/i18n/messages/{en,uk,pl}.json`, parity enforced by `catalogue-complete.test.ts`):
`help.title`, `help.close`, `help.shortcuts.heading`, `help.shortcuts.app`, `help.shortcuts.standard`, `help.shortcuts.locked`, `help.start.heading`, `help.start.show`, `help.start.done`, and one `help.shortcut.<id>` per list entry.

List ids. **app**: `new-transaction`, `lock`, `settings`, `search`, `go-overview`, `go-transactions`, `go-accounts`, `go-plan`, `go-settings`, `import`, `export`. **standard**: `undo`, `redo`, `cut`, `copy`, `paste`, `select-all`, `zoom-in`, `zoom-out`, `zoom-reset`, `close`, `minimize`, `fullscreen`, `quit`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 list, US2 getting started, US3 open/close/accessibility/drawer/shortcut-while-open, US4 drift test

## Phase 1: Setup

- [X] T001 Read `apps/desktop/src/main/shortcuts.ts`, `apps/web/src/ui/shell/AppShell.tsx` (Help item at the `shell.help` SidebarItem), `apps/web/src/ui/firstrun/FirstRunChecklist.tsx` and `apps/web/src/ui/desktop/DesktopActions.tsx`, and confirm each matches the plan's assumptions; note any difference in `specs/008-help-keyboard-shortcuts/research.md` before coding.

## Phase 2: Foundational (blocks all stories)

**Goal**: the shared list, the key formatter, the dialog skeleton, and the Help item opening it.

- [X] T002 [P] Write failing tests for the list in `packages/platform/src/help-shortcuts.test.ts`: ids unique; `group` is `app` or `standard`; the `app` entries are exactly new-transaction, lock, settings, search, the five `go:*`, import, export (compare against `ACTION_IDS` filtered to those); only `lock` has `worksWhenLocked: true`; no entry for reload or developer tools.
- [X] T003 Implement `HELP_SHORTCUTS` and the `HelpShortcut` type in `packages/platform/src/help-shortcuts.ts` per `data-model.md` (fields `id`, `group`, `action` (an `ActionId` for app entries; for standard entries one of the closed set `undo, redo, cut, copy, paste, select-all, zoom-in, zoom-out, zoom-reset, close, minimize, toggle-fullscreen, quit`, exported as a type), `keys: {mac, other}` as `{modifiers: ('ctrl'|'alt'|'shift'|'primary')[]; key}`, `via: {mac, other}`, `worksWhenLocked`). Keys: app entries `primary`+N, L, `,`, F, 1 to 5, and `primary`+shift+I / E. Standard: undo `primary`+Z; redo `primary`+shift+Z; cut/copy/paste/select-all `primary`+X/C/V/A; zoom-in `primary`+`+`; zoom-out `primary`+`-`; zoom-reset `primary`+0; close `primary`+W; minimize `primary`+M; fullscreen mac `ctrl`+`primary`+F, other `F11`; quit `primary`+Q (mac `via: system`). `via` is `system` on non-mac for undo/redo/cut/copy/paste/select-all (Chromium), else `shell`. Export from `packages/platform/src/index.ts`. Make T002 pass.
- [X] T004 [P] Write failing tests in `apps/web/src/ui/desktop/format-shortcut.test.ts`: mac gives ⌘N, ⇧⌘I, ⌃⌘F, ⌘, and ⌘0; other gives Ctrl+N, Ctrl+Shift+I, F11, Ctrl+, and Ctrl+0; the spoken form spells keys out ("Command, N", "Control, Shift, I"); macOS order is ⌃ ⌥ ⇧ ⌘ then key.
- [X] T005 Implement `formatShortcut(keys, platform)` returning `{ text, spoken }` in `apps/web/src/ui/desktop/format-shortcut.ts`; make T004 pass.
- [X] T006 [P] Add the non-list message keys (`help.title` "Help", `help.close` "Close", `help.shortcuts.heading`, `help.shortcuts.app`, `help.shortcuts.standard`, `help.shortcuts.locked` "While the app is locked, only Lock works.", `help.start.heading`, `help.start.show` "Show the getting-started card", `help.start.done` ("You have finished getting started.")) in English, Ukrainian and Polish in `apps/web/src/ui/i18n/messages/en.json`, `uk.json`, `pl.json`.
- [X] T007 Create `apps/web/src/ui/shell/HelpDialog.tsx`: a component `HelpDialog({ open, onClose })` using the kit `Dialog` (`apps/web/src/ui/kit/dialog.tsx`), a `DialogTitle` (`help.title`), a body with two empty sections (shortcuts, getting started) and a Close button (`help.close`, in `DialogActions`). Also create `apps/web/src/ui/shell/overlay-signal.ts` exporting a module-level `dismissOverlays()` and a `subscribeOverlays(listener)` that `HelpDialog` uses (the sidebar layout subscribes in T022).
- [X] T008 In `apps/web/src/ui/shell/AppShell.tsx` (`NavigationSidebar`), replace the Help item's `onClick` (which reset `firstRun.dismissed` and pushed `/overview/`) with local `open` state that renders `<HelpDialog>` next to the item, so the dialog is rendered by the Help item itself and focus returns to it. Keep the item's icon and label.

**Checkpoint**: Help opens an empty-ish dialog from the sidebar and the drawer and closes with Escape or Close.

## Phase 3: User Story 1 - See which keyboard shortcuts exist (Priority: P1) MVP

**Goal**: desktop users see the full, system-notated shortcut list; browsers do not.

**Independent Test**: In the desktop app on each system press Help and compare the list with the spec; in a browser confirm there is no shortcut section.

- [X] T009 [P] [US1] Write failing tests in `apps/web/src/ui/shell/HelpDialog.test.tsx`: with a desktop context on `darwin` the dialog shows every name from the list and ⌘N and ⇧⌘I and ⌃⌘F; on `win32` Ctrl+N, Ctrl+Shift+I and F11; two groups exist (app, "Also works"); the locked note is shown; in a browser (no desktop) no shortcut heading and no locked note appear; each row exposes name plus spoken keys to assistive technology.
- [X] T010 [P] [US1] Add one `help.shortcut.<id>` message per list id (names: New transaction, Lock, Settings, Search transactions, Go to Overview, Go to Transactions, Go to Accounts, Go to Plan, Go to Settings, Import, Export, Undo, Redo, Cut, Copy, Paste, Select all, Zoom in, Zoom out, Actual size, Close the window, Minimise, Full screen, Quit) in `apps/web/src/ui/i18n/messages/en.json`, `uk.json`, `pl.json`.
- [X] T011 [US1] In `apps/web/src/ui/shell/HelpDialog.tsx` render the shortcuts section only when `useDesktop()` (from `apps/web/src/ui/desktop/useDesktop.ts`) reports `isDesktop` and a `platform`: two labelled groups from `HELP_SHORTCUTS`, each row a description-list term (the `help.shortcut.<id>` name) and `kbd` keys from `formatShortcut`, with the spoken form as accessible text; add the `help.shortcuts.locked` note. Make T009 pass.

**Checkpoint**: US1 delivers the main value on its own.

## Phase 4: User Story 4 - The list cannot drift from reality (Priority: P1)

**Goal**: a failing test whenever the list and the shell's shortcut handling differ.

**Independent Test**: rebind or add one shell shortcut without touching the list, the test fails naming it.

- [X] T012 [US4] Write `apps/desktop/src/main/help-shortcuts.test.ts` per `contracts/help-dialog.md`: for darwin, win32 and linux (1) each list entry with `via: 'shell'` builds a key press and `matchShortcut(press, platform)` returns an entry with the same action (for `app` entries the same `ActionId`, with `data: true` on every entry except Lock to match `worksWhenLocked`; for `standard` entries the list's action name equals the table's); (2) for every non-`development` entry of `SHORTCUTS` that applies on that system, every key it owns (for example both `+` and `=` for zoom in, `-` and `_` for zoom out) returns that entry's action from `matchShortcut`, and some list entry has the same action for that system (compare by action, modifier and system; alias keys need no list entry); (3) `via: 'system'` entries equal an explicit allow-list in the test (macOS quit; Windows/Linux undo, redo, cut, copy, paste, select all) with a comment giving the reason; (4) `matchShortcut(..., development=false)` never matches a listed entry that is development-only. Failure messages must name the shortcut and the system.
- [X] T013 [US4] Prove the test detects drift: temporarily change one key in `apps/desktop/src/main/shortcuts.ts`, then drop one entry from the list, confirm T012 fails with a message naming each, and revert both; then confirm `git diff` shows no change to `apps/desktop/src/main/shortcuts.ts` (FR-016). Record the result in `specs/008-help-keyboard-shortcuts/quickstart.md` under "Negative check".
- [X] T014 [P] [US4] Add `apps/desktop/e2e/help.spec.ts` test "every listed shortcut does what it says": for each `app` entry press the key from the main process as `apps/desktop/e2e/shortcuts.spec.ts` does and assert the effect (route, add sheet, search focus, import and export focus, lock); for `standard` entries assert zoom in/out/reset changes zoom level, full screen toggles, close/minimise/quit as feasible, and redo with Ctrl+Shift+Z in a text field (research R3). Exact assertions for the window shortcuts: close, the window is closed or hidden as background mode dictates; minimise, `win.isMinimized()` is true; quit, the app's quit is requested (assert the call by stubbing it, do not end the process); full screen, `isFullScreen()` toggles and toggles back.
- [X] T015 [US4] Add to the same e2e: while locked every `app` shortcut except Lock does nothing, matching the "only Lock works" note.

**Checkpoint**: US1 + US4 deliver a trustworthy list.

## Phase 5: User Story 2 - Getting-started card, honestly (Priority: P2)

**Goal**: button while steps remain, "all done" line after.

**Independent Test**: new empty Fold shows the button and it restores the card; after the three steps, the line appears and no button.

- [X] T016 [P] [US2] Write failing tests in `apps/web/src/ui/firstrun/checklist-status.test.ts` for a `useChecklistStatus` hook's pure core: counts unknown -> `{known: false}`; any zero -> `complete: false`; all non-zero -> `complete: true`.
- [X] T017 [US2] Extract the counts-to-status logic from `FirstRunChecklist.tsx` into `apps/web/src/ui/firstrun/checklist-status.ts` (using the existing `checklistState` in `checklist.ts`), and use it in `FirstRunChecklist.tsx` with no change in the card's behaviour; make T016 pass.
- [X] T018 [P] [US2] Write failing tests in `apps/web/src/ui/shell/HelpDialog.test.tsx` (same file as T009, new cases): steps left -> button "Show the getting-started card" is present and pressing it clears `firstRun.dismissed`, navigates to `/overview/` and closes the dialog; complete -> the `help.start.done` line is shown and no such button; works in a browser context too.
- [X] T019 [US2] Render the getting-started section in `apps/web/src/ui/shell/HelpDialog.tsx` using `useChecklistStatus`; make T018 pass.

## Phase 6: User Story 3 - Open, close, accessibility, drawer, languages (Priority: P2)

**Goal**: keyboard and screen-reader complete, in both layouts, themes and languages; shortcut-while-open closes then runs.

**Independent Test**: keyboard-only open/close with focus return, in a narrow window, in both themes and each language.

- [X] T020 [P] [US3] Add `e2e/ux-help.spec.ts` (web): Help opens the dialog from the sidebar and from the drawer in a narrow viewport; focus moves in and is trapped; Escape and Close each return focus to Help; the page behind is inert; no shortcut section in the browser; the dialog has a name and the all-done / button states render; axe (WCAG 2.2 AA, as in `e2e/a11y.spec.ts`) has no violations in the light and dark themes.
- [X] T021 [P] [US3] Add to `apps/desktop/e2e/help.spec.ts`: axe on the open dialog in the light and dark themes (use the helper pattern from `apps/desktop/e2e/a11y-desktop.spec.ts`); opening in each of English, Ukrainian and Polish shows localized names; no text overlap at the narrow width (assert no horizontal scroll).
- [X] T022 [US3] In `apps/web/src/ui/desktop/DesktopActions.tsx`, call `dismissOverlays()` (from `apps/web/src/ui/shell/overlay-signal.ts`) before `performMenuAction` for every action; `HelpDialog` subscribes so an open dialog closes first, and `apps/web/src/ui/kit/sidebar-layout.tsx` subscribes (through a new optional `onDismissOverlays` prop wired in `AppShell.tsx`) so an open narrow-window drawer closes too (FR-017). Lock needs no special case because locking unmounts the unlocked shell (FR-015).
- [X] T023 [US3] Add unit tests in `apps/web/src/ui/desktop/menu-action.test.ts` or a new `apps/web/src/ui/desktop/help-close.test.ts` that an arriving action closes an open dialog and an open drawer and still performs the action, and add the matching case to `apps/desktop/e2e/help.spec.ts`: open Help, press the new-transaction shortcut, the dialog closes and the add sheet opens; in a narrow window with the drawer open beneath the dialog, the same shortcut closes both and the add sheet opens; open Help, press Lock, the app locks and no dialog remains.
- [X] T024 [US3] Run the existing pseudo-locale walk and the catalogue completeness test (`apps/web/src/ui/i18n/catalogue-complete.test.ts`, `e2e/pseudo-walk.spec.ts`) and fix any missing or overflowing text in the dialog; add the dialog to the walk if it enumerates screens.

## Phase 7: Polish & Cross-Cutting

- [X] T025 [P] Update `docs/desktop.md` so the shortcut table states that Help lists these shortcuts and that `packages/platform/src/help-shortcuts.ts` must change together with `apps/desktop/src/main/shortcuts.ts` (the drift test enforces it).
- [X] T026 [P] Run type-check and lint for `packages/platform`, `apps/web`, `apps/desktop`; fix findings. Commit messages and PR text for this feature carry no AI-tool attribution or co-author lines (constitution, Development Workflow).
- [ ] T027 Run the whole quickstart in `specs/008-help-keyboard-shortcuts/quickstart.md`, including the manual checks (macOS ⌃⌘F, Windows/Linux F11, narrow width, larger text). The Electron e2e runs only on the host system, so run it on macOS, Windows and Linux (SC-002), tick each system in a table in the quickstart, and record any system not run as unchecked.

## Dependencies & Execution Order

- Phase 1 -> Phase 2 (T002/T004/T006 parallel; T003 after T002; T005 after T004; T007 after T006; T008 after T007).
- US1 (Phase 3) after Phase 2. US4 (Phase 4) needs only T003 (list) and can run in parallel with US1. US2 (Phase 5) after T007/T008; independent of US1. US3 (Phase 6) after T008; T022 after T007; T020/T021 after their stories' UI exists (T011, T019).
- Polish last.
- Shared files: `HelpDialog.tsx` is edited by T007, T011, T019, T022 (sequential); the three catalogue files by T006, T010, T019 (sequential); `apps/desktop/e2e/help.spec.ts` by T014, T015, T021, T023 (sequential).

## Parallel Examples

- After T001: T002, T004, T006 together.
- After T008: US1 (T009, T010), US4 (T012), US2 (T016, T018) together.
- Phase 6: T020 and T021 together.

## Implementation Strategy

- **MVP**: Phase 1, 2, then US1 and US4 (the list and the guarantee it is true). Stop and validate with the quickstart.
- **Increment 2**: US2 (getting-started), then US3 (accessibility, drawer, shortcut-while-open), then Polish.
