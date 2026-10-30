---

description: "Task list for Command Palette"
---

# Tasks: Command Palette

**Input**: Design documents from `/specs/015-command-palette/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work and the request asks for them.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`. The new folder is `ui/palette/`. User Story 4 (accessibility and lock) is a P1 story that is built together with User Story 1, so its tasks sit in Phase 3 after the US1 tasks; US2, US3 and US5 follow.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `015-command-palette` (create it from `main` if not) and run `pnpm vitest run` once to record a green baseline
- [X] T002 Create the empty folder `ui/palette/` (files are added by later tasks); add nothing else

## Phase 2: Foundational (blocks every story)

- [X] T003 [P] Add `'palette'` to `ACTION_IDS` in `packages/platform/src/schemas.ts` and extend `packages/platform/src/schemas.test.ts` so `ActionIdSchema.safeParse('palette')` succeeds and an unknown id still fails
- [X] T004 [P] Add the app shortcut `app('palette', 'palette', primary('K'))` to `HELP_SHORTCUTS` in `packages/platform/src/help-shortcuts.ts`, keeping `worksWhenLocked` false (the helper already derives it from the action)
- [X] T005 Add the shell entry `{ keys: ['k'], modifier: 'primary', shift: false, platforms: 'all', action: 'palette', data: true }` to `SHORTCUTS` in `apps/desktop/src/main/shortcuts.ts` and `'palette'` to `AppShortcutAction`; extend `apps/desktop/src/main/shortcuts.test.ts` (matches ⌘K on macOS, Ctrl+K on Windows and Linux, not Shift+K, not Alt+K, ignored while locked) and confirm `apps/desktop/src/main/help-shortcuts.test.ts` passes on all three platforms (depends on T003, T004)
- [X] T006 [P] Create `ui/palette/palette-bus.ts`: a tiny signal with `openPalette()`, `togglePalette()` and `subscribePalette(listener)` (same shape as `ui/shell/overlay-signal.ts`), plus `ui/palette/palette-bus.test.ts` (subscribe, unsubscribe, toggle)
- [X] T007 [P] Create `ui/palette/registry.ts` with the `Command`, `PaletteContext` and `PaletteGroup` types from `contracts/ui-contract.md` §2, `register(commands): () => void` (returns an unregister function; a duplicate id throws in development and is ignored in production) and `list(ctx)` (only commands whose `enabled(ctx)` is not false, in registration order); add `ui/palette/registry.test.ts` (register, unregister, duplicate id, availability filter, order)
- [X] T008 [P] Add the shared strings to `ui/i18n/messages/en.json`, `uk.json`, `pl.json` under `palette.*`: `palette.title`, `palette.placeholder` (with a `{shortcut}` parameter), `palette.group.screen`, `.action`, `.account`, `.envelope`, `.goal`, `palette.group.recent`, `.frequent`, `palette.empty`, `palette.count` (plural forms), `palette.loadingMore`, `palette.type.*`, `help.shortcut.palette`; keep keys sorted and the existing messages/catalogue tests green

**Checkpoint**: the action id, shell entry, Help entry, bus, registry and base strings exist; nothing is visible yet.

## Phase 3: User Story 1 - Jump to an account, envelope, goal or screen (P1) 🎯 MVP, and User Story 4 - works for everyone and respects the lock (P1)

**Goal**: Cmd/Ctrl+K opens a modal search that finds accounts, envelopes, goals and screens, with keyboard and screen-reader support, and never opens or shows names while locked.

**Independent Test**: With several accounts, envelopes and goals, open the palette from different screens, type part of a name, choose a result with the keyboard and land on the right item; lock the app with the palette open and closed and confirm nothing is shown; run the same with a screen reader and in both themes.

### Tests for User Stories 1 and 4

- [X] T009 [P] [US1] Create `ui/palette/fuzzy.test.ts` before the matcher: out-of-order subsequence ("chk" matches "Checking"), accent and case folding ("cafe" matches "Café", "ZAZOLC" matches "zażółć", "и" matches "й"), highlight ranges are in original-string indices and merged, prefix and word-start matches outrank scattered ones, shorter targets outrank longer on equal quality, empty query matches everything with score 0, no match returns `undefined`
- [X] T010 [P] [US1] Create `ui/palette/entities.test.ts`: accounts, envelopes and goals become entries of the right type, id (`a:`, `e:`, `g:`), title and secondary line; archived accounts follow the Accounts screen rule; entries from another Fold are never produced; a failed envelope or goal read leaves accounts and screens usable
- [X] T011 [P] [US4] Create `ui/palette/palette-guard.test.ts`: the host renders nothing and registers no key listener when the core phase is not `unlocked`; unmounts and discards state when the phase changes to locked; closes when `covered` becomes true; does not open while another `[role="dialog"]` is open; closes when `dismissOverlays()` is called Also test the browser key handling: Cmd+K on macOS and Ctrl+K elsewhere opens it and calls `preventDefault()`; Shift+K and Alt+K do nothing; the listener is not installed in the desktop app (the shell delivers the action instead); a key press already prevented elsewhere is ignored (FR-022)
- [X] T012 [P] [US1] Create `ui/palette/CommandPalette.browser.test.tsx` (pattern of `ui/kit/kit.browser.test.tsx`): opens with the input focused; arrows move and wrap; Home/End; Enter runs the highlighted row and closes; Escape closes and returns focus to the opener; "No results" shown and Enter does nothing; roles and attributes from contract §5 (`combobox`, `aria-activedescendant`, `listbox`, `group`, `option`); the hidden status region announces the count after typing settles and "more results are loading" while entities load; Tab stays inside; axe passes in light and dark and with two primary colors; reduced motion removes the transition Also edge cases: an item removed while the palette is open leaves the list without breaking it and choosing it does nothing harmful; the highlighted row stays put when data reloads under the cursor; Enter acts on the row shown after rapid typing
- [X] T013 [P] [US1] Extend `ui/plan/` tests (new `ui/plan/item-focus.test.tsx`): with `?item=<id>` the matching row in `BudgetsView` and `GoalsView` is scrolled into view and focused once and the parameter is removed; an unknown id changes nothing

### Implementation for User Stories 1 and 4

- [X] T014 [US1] Create `ui/palette/fuzzy.ts`: `match(query, target): { score: number; ranges: [number, number][] } | undefined`. Fold each character with the same rules as `foldLetters` in `ui/i18n/collation.ts` (reuse it for the per-character fold) while keeping an index map back to the original string; match query characters as an ordered subsequence; score rewards prefix, word-start and consecutive matches, penalizes gaps and longer targets; merge adjacent ranges (depends on T009)
- [X] T015 [US1] Create `ui/palette/builtin-commands.ts`: register the screen commands from the contract §3 table using `PRIMARY_SECTIONS` and `SETTINGS_GROUPS` from `ui/shell/routes.ts` (overview, transactions, accounts, plan, schedules as `/plan/?view=schedules`, settings, devices and sync, data, appearance), each with `titleKey`, keyword keys and `run: ctx.navigate(href)`; add the missing `palette.command.*` titles and keywords to the three message files (depends on T007, T008)
- [X] T016 [US1] Create `ui/palette/entities.ts`: build entries from `useLedger().basics.accounts` (no read) and, on open, from `ledger.read('budgets.list')` and `ledger.read('goals.progress')`; keep only id, title and a short secondary line in component state, never store them; accounts navigate to `/transactions/?account=<id>`, envelopes to `/plan/?view=budgets&item=<id>`, goals to `/plan/?view=goals&item=<id>`; only the Fold being viewed is read (depends on T010)
- [X] T017 [US1] Create `ui/palette/CommandPalette.tsx`: kit `Dialog` named by `palette.title`; input with the combobox attributes from contract §5 and a placeholder that includes the shortcut written for the system (⌘K or Ctrl+K); grouped options (`role="group"` with labelled headings), at most 20 rows, each showing its type and the secondary line; match highlight by weight and underline from `fuzzy.ts` ranges; arrow/Home/End/Enter/Escape handling; visually hidden `role="status"` announcing "N results" after 300 ms of no typing; "No results" state; transition removed under reduced motion; colors from existing tokens only (no inline `style` attributes; CSP) (depends on T012, T014, T015, T016)
- [X] T018 [US1] Create `ui/palette/PaletteHost.tsx`: mounted inside the unlocked shell; owns open state; subscribes to `palette-bus`; listens for `keydown` on `window` for `Meta+K` on macOS or `Ctrl+K` elsewhere (no Shift or Alt; calls `preventDefault()`; skipped in the desktop app, where the shell delivers the action instead); builds `PaletteContext` from existing hooks (`useRouter`, `useCore().lock`, `useAddSheet().openAdd`, `useTheme`) ; refuses to open when another `[role="dialog"]` is open; closes on `core.covered`; registers with `subscribeOverlays` so other desktop shortcuts close it first (depends on T006, T011, T017)
- [X] T019 [US1] Mount `<PaletteHost />` inside the unlocked part of `ui/shell/AppShell.tsx`, next to the other overlays, and confirm the locked shell does not render it (depends on T018)
- [X] T020 [US1] In `ui/desktop/menu-action.ts` handle the `palette` action (toggle through `palette-bus`; ignored while locked like the other data actions) and in `ui/desktop/DesktopActions.tsx` run `palette` before `dismissOverlays()` so it does not close Help first; extend `ui/desktop/menu-action.test.ts` for both (depends on T003, T006)
- [X] T021 [P] [US1] Make `ui/plan/BudgetsView.tsx` and `ui/plan/GoalsView.tsx` read `?item=<id>`: scroll the matching row into view, move focus to it once, then remove the parameter with `router.replace`; an unknown id does nothing (makes T013 pass)
- [X] T022 [US4] Add the "Help and shortcuts" listing of the palette shortcut in a browser: in `ui/shell/HelpDialog.tsx` show a one-row shortcuts section with only the palette shortcut when `platform` is undefined (written ⌘K on Apple systems, Ctrl+K elsewhere), keeping the desktop list unchanged; update `ui/shell/HelpDialog.test.tsx` and amend the spec-008 note that a browser has no shortcuts section
- [X] T023 [US1] Add a Playwright e2e in the repo-root `e2e/` folder (`e2e/ux-command-palette.spec.ts`): open with the shortcut, type "chk", pick an account with the keyboard and land on its transactions, jump to a goal with the row focused, lock with the palette open and see it gone, press the shortcut while locked and see nothing, axe passes on the open palette in light and dark Also assert SC-001: from any screen, reaching an account, envelope or goal, or opening Add transaction, takes at most 5 keystrokes including the opening shortcut

**Checkpoint**: US1 and US4 work and can ship on their own: jump anywhere by keyboard, accessible, lock-safe.

## Phase 4: User Story 2 - Run common actions from the keyboard (P2)

**Goal**: The same box runs Add transaction, Lock now, Switch theme, Sign out / use a different account and Help and shortcuts, each exactly as its normal control does.

**Independent Test**: Run each action from the palette and confirm it does the same as the normal control, including the sign-out confirmation; an unavailable action is not listed.

### Tests for User Story 2

- [X] T024 [P] [US2] Extend `ui/palette/registry.test.ts` and add `ui/palette/builtin-commands.test.ts`: each action calls exactly the matching `PaletteContext` function once; "Sign out / use a different account" only opens the existing sign-out dialog and never signs out by itself; "Add transaction" is not listed without an account; every command id is unique and has a title key present in all three languages

### Implementation for User Story 2

- [X] T025 [US2] Add a small `ui/shell/help-bus.ts` (same shape as `palette-bus.ts`) and make `HelpItem` in `ui/shell/AppShell.tsx` open its dialog when the bus fires, so the palette can open Help without moving its state
- [X] T026 [US2] Add the action commands to `ui/palette/builtin-commands.ts`: `add-transaction` (`ctx.openAdd()`, enabled when an account exists), `lock-now` (`ctx.lock()`), `switch-theme` (`ctx.toggleTheme()`, toggling exactly as the existing theme control resolves it), `sign-out` titled "Sign out / use a different account" (`ctx.openSignOut()`; the one command for both, because the app holds one account per device), `help` (`ctx.openHelp()` through T025); extend the strings from T008 with their titles and keywords (depends on T024, T025)
- [X] T027 [US2] Complete `PaletteContext` in `ui/palette/PaletteHost.tsx`: wire `toggleTheme` to `useTheme`, `openSignOut` to the existing sign-out dialog of spec 011 (`ui/auth/SignOutDialogLazy.tsx`, which asks for its own confirmation); `openHelp` to `help-bus`; navigation uses the same router push as the sidebar. Record in `specs/011-sign-out-switch-account/spec.md` a one-line note that spec 015 adds the palette as an extra entry point to Sign out (depends on T025, T026)
- [X] T028 [US2] Extend `e2e/ux-command-palette.spec.ts`: run "Add transaction", "Switch theme", "Help and shortcuts"; run "Sign out / use a different account" and confirm the usual confirmation appears and nothing changes until confirmed; run "Lock now" and see the locked screen

**Checkpoint**: US2 works with US1; every action matches its normal control.

## Phase 5: User Story 3 - Recent and Frequent items when the box is empty (P2)

**Goal**: An empty box shows what the person opened or ran last and most, kept only on this device and clearable.

**Independent Test**: Use a few items several times, reopen with nothing typed and see Recent newest first and Frequent most-used first without repeats; clear the history in Settings and see both gone; sign out (or use a different account) and see the history deleted.

### Tests for User Story 3

- [X] T029 [P] [US3] Create `ui/palette/history.test.ts`: `record` adds and increments; at most 24 items, trimmed by lowest count then oldest time; count capped at 9999; a value with the wrong version, wrong types or over 2 KB is discarded as a whole and never repaired; `clear` removes the key `cashfold.palette`; storage unavailable (throws) leaves the palette working without history; the stored value contains only `id`, `n`, `t` (no names)
- [X] T030 [P] [US3] Create `ui/palette/ranking.test.ts`: Recent is newest first up to 5; Frequent is most used first up to 5 and never repeats a Recent item; items that no longer exist, belong to another Fold or are unavailable are skipped; no history shows the main screens and the most common actions; with a query, score decides and ties break by count then by type order
- [X] T031 [P] [US3] Extend `ui/core/core-client.test.ts` or add `ui/core/forget-account-state.test.ts`: signing out (which is also how a person uses a different account) removes `cashfold.palette`, and removing the account from the device does too

### Implementation for User Story 3

- [X] T032 [US3] Create `ui/palette/history.ts` with `load()`, `record(entryId)` and `clear()` over `localStorage['cashfold.palette']` using the format and rules in `data-model.md` §4 (`{ "v": 1, "items": [ { "id", "n", "t" } ] }`; at most 24 items; stored size at most about 2 KB; try/catch around every storage call) (depends on T029)
- [X] T033 [US3] Create `ui/palette/ranking.ts`: `emptyQuerySections(entries, history, now)` returning Recent and Frequent per `research.md` R6, and `orderResults(matches, history)` for typed queries (depends on T030, T032)
- [X] T034 [US3] Use history in `ui/palette/CommandPalette.tsx`: show the Recent and Frequent sections with an empty query (headings `palette.group.recent` and `.frequent`), and call `record` with the entry id whenever a row is run (depends on T033)
- [X] T035 [US3] In `ui/core/CoreProvider.tsx` make `forgetAccountScopedState` also call `history.clear()`, which covers sign-out, using a different account and account removal (depends on T031, T032)
- [X] T036 [US3] Add the "Clear palette history" control to `ui/settings/DataAndStorage.tsx` (kit `Button` and `Text`; one-line description "Forgets which places and actions you open most on this device. Your data is not touched."; after pressing it, a status message says what was cleared and the open palette re-reads); add the strings to the three message files and a test next to `ui/settings/` that the button removes the palette key (depends on T032)
- [X] T037 [US3] Extend `e2e/ux-command-palette.spec.ts`: use items, reopen with an empty box and see Recent and Frequent; clear in Settings and see them gone; sign out and confirm the `cashfold.palette` key is removed from storage and the next sign-in starts with an empty history

**Checkpoint**: US3 works with US1 and US2; history is device-local, deleted when the account leaves the device, and clearable.

## Phase 6: User Story 5 - Discoverable and the same everywhere (P3)

**Goal**: The shortcut is listed in Help and the palette behaves the same in the web app and the desktop app.

**Independent Test**: Open Help on desktop and in a browser and see the shortcut with the right keys; compare results, order and actions for the same data in both.

- [X] T038 [P] [US5] Add a desktop e2e in `apps/desktop/e2e/` (copy the pattern of an existing spec there) that presses ⌘K / Ctrl+K in the packaged shell, jumps to an account, locks with the palette open, and checks the Help dialog lists the shortcut with the system's notation
- [X] T039 [P] [US5] Add a parity unit test `ui/palette/parity.test.ts` that builds the entry list for the same fixture data with `isDesktop` true and false and expects identical groups, order and titles
- [X] T040 [US5] Update `docs/desktop.md` (the shortcut list and that Cmd/Ctrl+K opens the palette, ignored while locked) and `docs/privacy.md` (palette history stays on the device, holds only ids, counts and times, is deleted on sign-out, can be cleared in Settings); add a short note about the browser key claim and its limits (research R11) and run `pnpm check:docs`

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T041 [P] Run `pnpm check:bundle`, `pnpm check:licenses` and confirm no new dependency was added to any `package.json`; if the bundle budget is exceeded, load `CommandPalette.tsx` lazily (pattern of `ui/desktop/lazy.tsx`) and re-check
- [X] T042 [P] Check text at larger size and at narrow width: no horizontal scroll, long and duplicate names truncate visually and keep the full text in the accessible name; fix in `ui/palette/CommandPalette.tsx`
- [X] T043 [P] Check performance with a fixture of 500+ combined entries: results update within one frame of a keystroke (add a benchmark next to `e2e/bench/` or a Vitest timing guard in `ui/palette/fuzzy.test.ts`)
- [X] T044 Search the repository for logging, error messages and URLs that could include palette entry titles and confirm none do (FR-020); add a lint-style test in `ui/palette/` that fails if a module there calls `console.*` or writes a title to storage
- [X] T045 Run the full verification (`pnpm typecheck`, `pnpm lint`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, `pnpm test:e2e`) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks all stories. T005 needs T003 and T004.
- **US1 + US4 (Phase 3)**: after Foundational. This is the MVP.
- **US2 (Phase 4)**: after Phase 3 (needs the host, dialog and registry).
- **US3 (Phase 5)**: after Phase 3; independent of Phase 4 apart from sharing `CommandPalette.tsx` and `builtin-commands.ts` (do the file edits in order if both run at once).
- **US5 (Phase 6)**: after Phases 3 to 5 for the parity and e2e checks; docs (T040) can start after Phase 3.
- **Polish (Phase 7)**: after the stories you ship.

### Within Each Story

- Tests first (T009 to T013, T024, T029 to T031) and see them fail, then implementation.
- Pure logic (matcher, registry, history, ranking) before the React parts, the dialog before the host, the host before the shell mount.

### Parallel Opportunities

- Phase 2: T003, T004, T006, T007 and T008 are in different files and run together; T005 follows T003 and T004.
- Phase 3: T009 to T013 (tests) together; then T014, T015, T016 and T021 together; T017 follows them; T018 to T020 and T022 follow T017/T006.
- Phase 5: T029, T030 and T031 together; T032 then T033; T034 to T036 follow.

## Parallel Example: Phase 3 tests

```text
Task: "Create ui/palette/fuzzy.test.ts"
Task: "Create ui/palette/entities.test.ts"
Task: "Create ui/palette/palette-guard.test.ts"
Task: "Create ui/palette/CommandPalette.browser.test.tsx"
Task: "Create ui/plan/item-focus.test.tsx"
```

## Implementation Strategy

### MVP First (User Stories 1 and 4)

1. Phase 1 and Phase 2.
2. Phase 3 (jump anywhere, accessible, lock-safe).
3. **Stop and validate** with quickstart scenarios 1 to 3, 7 to 10 and 12; ship if ready.

### Incremental Delivery

1. Foundation, then US1 + US4 (MVP).
2. Add US2 (actions), validate scenario 4.
3. Add US3 (history), validate scenarios 5 and 6.
4. Add US5 (Help parity, docs), validate scenario 11.
5. Polish and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- The `[US4]` label marks the lock and accessibility work; it ships with US1 because both are P1.
- Commit after each task or logical group; keep the Help list and the shell table in step (T004 and T005) in the same commit.
- Avoid: storing or logging entry titles anywhere, adding a dependency, opening the palette over another modal, or skipping a confirmation an action normally asks for.

## Implementation notes

Where the finished work differs from what the tasks said, and why:

- **T025**: there is no `help-bus`. The sidebar renders two Help items at once (the static sidebar and the narrow-window drawer), so a shared signal would have opened two dialogs. `PaletteHost` owns its own `HelpDialog`, and the "show the getting-started card" action is shared through `ui/shell/show-card.ts`.
- **T033**: query ordering and the limit live in `ui/palette/search.ts` (with the tie-break by use count). `ranking.ts` holds only the empty-query sections and `usageOf`.
- **Hidden keywords** match only when their letters are together (a word that starts with, or contains, the query). Scattered-letter matching on keywords made "cafe" find "Add transaction" through "income transfer".
- **Groups** are ordered by their best match (a fixed order among equals), not always screens first, so the top hit's group is first.
- **T018 / T019**: the palette is loaded as its own chunk right after unlock (`React.lazy` in `AppShell.tsx`). Loading it with the shell put the initial JavaScript 1.9 KB over its budget.
- **T011 / T013**: unit tests run in Node here, so the key handling is tested on its pure functions (`palette-keys.test.ts`), the mount and guard rules by reading the shell source (`palette-guard.test.ts`), and the row focus by its pure parts (`item-focus.test.ts`); the real-browser behavior is in the browser test and the e2e specs.
- **T037**: the sign-out wipe is covered by a unit test of `forgetAccountScopedState` (`forget-account-state.test.ts`), not by a full sign-out in e2e.
- **T038**: the desktop e2e is `apps/desktop/e2e/palette.spec.ts`, and `help.spec.ts` gained the `palette` expectation.
- **E2E key**: the e2e specs ask the page which key it expects (Command or Control) because an emulated browser can report another system than the host.

