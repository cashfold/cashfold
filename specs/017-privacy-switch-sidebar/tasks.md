---

description: "Task list for Privacy Mode Switch in the Sidebar"
---

# Tasks: Privacy Mode Switch in the Sidebar

**Input**: Design documents from `/specs/017-privacy-switch-sidebar/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`. This feature builds on spec 016 (Privacy mode), which is on the branch it starts from.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `017-privacy-switch-sidebar` (create it from `016-privacy-mode` if not), run `pnpm vitest run` once to record a green baseline, then `pnpm --filter @cashfold/web build` and `pnpm check:bundle` and write the "initial JS" size into the PR notes (374,069 of 374,784 bytes at the end of spec 016); later tasks must not raise the budget

## Phase 2: Foundational (blocks every story)

- [X] T002 [P] Add `EyeIcon` to the Heroicons re-exports in `ui/kit/icons.ts` (next to `EyeSlashIcon`)
- [X] T003 [P] Add the strings to `ui/i18n/messages/en.json`, `uk.json`, `pl.json`: `privacy.switch.on` ("Privacy mode: on"), `privacy.switch.off` ("Privacy mode: off"), `privacy.announce.on` ("Privacy mode on"), `privacy.announce.off` ("Privacy mode off"); keep keys sorted and `ui/i18n/catalogue-complete.test.ts` green
- [X] T004 Make `ui/privacy/PrivacyProvider.tsx` say `privacy.announce.on` or `privacy.announce.off` in its existing polite `role="status"` region whenever the `privacyMode` preference changes, whichever route changed it, and not on the first render; keep the "Amount shown" and "Amounts hidden" messages as they are; add a source check to `ui/privacy/privacy-guard.test.ts` that the provider announces on a change of `on` and not on mount (depends on T003)

**Checkpoint**: the icon, the strings and the announcement exist; nothing is visible yet.

## Phase 3: User Story 1 - Turn Privacy mode on from anywhere in the app (P1) 🎯 MVP

**Goal**: A control in the sidebar footer shows both states and toggles the mode, in the sidebar and in the drawer, and a compact icon-only button in the narrow-window top bar does the same without opening the drawer.

**Independent Test**: With the mode off, on any screen find the control in the sidebar (wide window) or the top bar (narrow window), press it, and see every amount masked and the control say the mode is on; press again to undo.

### Tests for User Story 1

- [X] T005 [P] [US1] Create `ui/privacy/PrivacySwitch.test.tsx` (server-rendered markup, with a `PrivacyContext` provider like `ui/kit/amount.test.tsx`): the sidebar item with the mode off reads "Privacy mode: off", has `aria-pressed="false"`, the eye icon and `data-testid="privacy-switch"`; with the mode on it reads "Privacy mode: on", `aria-pressed="true"`, the crossed-out eye; its accessible name is its visible text; the top-bar button has no text, an `aria-label` equal to the sidebar text, `aria-pressed`, `data-testid="privacy-switch-topbar"` and the 44 px size classes `min-h-11 min-w-11`; the two states differ by words and icon, not only by a colour class
- [X] T006 [P] [US1] Create `e2e/ux-privacy-switch.spec.ts` (web, skip WebKit like the other sign-up specs): sign up and create an account; in a wide window, on Overview, Accounts, Transactions, Plan and Settings the sidebar control `privacy-switch` is visible with the text "Privacy mode: off" without visiting Settings; one click masks the amounts (`[data-privacy-mask]` present) and the text becomes "Privacy mode: on" and `aria-pressed` is `true`; the control keeps keyboard focus; a second press unmasks; in a narrow window (width 390) the top-bar button `privacy-switch-topbar` is visible with no menu opened, one tap masks the amounts, and the drawer's own `privacy-switch` shows the same state and pressing it leaves the drawer open Also: with the mode off and on, Help and Lock stay visible and in their usual order, and the sync status and the schedule badge are still shown, in a wide and a narrow window and at a larger root font size (FR-012); three quick presses in a row leave the mode on and the control reading "on"; reveal one amount, press the control, and see it masked again; the top-bar button is present at a viewport width of 1023 px and absent at 1024 px (the `lg` breakpoint where the navigation stops being a drawer)

### Implementation for User Story 1

- [X] T007 [US1] Create `ui/privacy/PrivacySwitch.tsx` exporting `PrivacySidebarItem` (a `SidebarItem` with `aria-pressed={on}`, the text from `privacy.switch.on` or `privacy.switch.off`, `EyeIcon` when off and `EyeSlashIcon` when on with `aria-hidden`, `onClick={toggle}`, `data-testid="privacy-switch"`, a label that truncates inside the sidebar) and `PrivacyTopbarItem` (a `NavbarItem` with the icon only, `aria-pressed={on}`, `aria-label` equal to the same text, `className="min-h-11 min-w-11 justify-center"`, `data-testid="privacy-switch-topbar"`); both read `usePrivacy()` and hold no state of their own; delete `ui/privacy/PrivacyIndicator.tsx` (depends on T002, T003, T005) Also remove the keys that nothing uses once the old indicator is gone (`privacy.indicator.on`, `privacy.indicator.hint`, `privacy.mode.label`) from the three catalogues, in this same task so the old button never shows raw key names; keep `ui/i18n/catalogue-complete.test.ts` green
- [X] T008 [US1] In `ui/shell/AppShell.tsx` replace the `PrivacyIndicatorLazy` import with a `React.lazy` of `PrivacySidebarItem` from `../privacy/PrivacySwitch` and mount it, inside `Suspense`, in the sidebar footer section above `HelpItem`, so it is rendered in both states and in the drawer too (the sidebar is one component) (the top-bar button is wired in T009, not here) (depends on T007)
- [X] T009 [US1] In `ui/shell/Topbar.tsx` render the lazy compact button in the `NavbarSection` before the Add button, inside `Suspense` with no fallback, importing it with `React.lazy` so it is not in the initial chunk; keep the page title truncating so the row (menu button, title, privacy, Add) fits at 320 px (depends on T007) Then run `pnpm --filter @cashfold/web build` and `pnpm check:bundle`: the initial JavaScript must still be inside its budget (374,784 bytes); if it is not, fix it now by moving more into the lazy chunk, before any later task (research R7)
- [X] T010 [US1] Update the tests that mention the old indicator: in `e2e/ux-privacy-mode.spec.ts` change `privacy-indicator` to `privacy-switch`, change "absent while the mode is off" (`toHaveCount(0)`) to "present and reading off with `aria-pressed="false"`", and "contains 'Privacy mode on'" to "contains 'Privacy mode: on'"; in `apps/desktop/e2e/privacy.spec.ts` and `apps/desktop/e2e/help.spec.ts` change the testid and the checks the same way (depends on T007)

**Checkpoint**: US1 works on its own: one press from any screen turns the mode on or off, wide and narrow.

## Phase 4: User Story 2 - Always see which state Privacy mode is in (P1)

**Goal**: Both states are visible in words and an icon, announced to a screen reader, reachable by keyboard, and readable in both themes, in every language, without overlapping the neighbouring controls.

**Independent Test**: Turn the mode on and off by each route and check the control with a keyboard and a screen reader, in light and dark, in Ukrainian and Polish, at larger text.

### Tests for User Story 2

- [X] T011 [P] [US2] Create `ui/privacy/PrivacySwitch.browser.test.tsx` (pattern of `ui/kit/kit.browser.test.tsx`, a harness with the real `Sidebar` and `Navbar` kit pieces and a `PrivacyContext` provider): axe passes in light and dark, in both states, for the sidebar item and for the top-bar button; Tab reaches each, Enter and Space toggle, focus stays on the same element after toggling; the sidebar item with a very long label (Ukrainian or Polish text and a 24 px root font size) stays inside the 256 px sidebar without horizontal scroll and does not overlap the item below it; the top-bar row at a 320 px viewport (menu button, long title, privacy, Add) has no horizontal scroll and keeps the privacy button and Add at least 44 px square (the existing menu button is checked only for being present, visible and not overlapped, because it is smaller than 44 px today) Also assert that, with reduced motion on, the control has no running transition or animation when its state changes
- [X] T012 [P] [US2] Extend `e2e/ux-privacy-switch.spec.ts`: the polite status region reads "Privacy mode on" and "Privacy mode off" after the change from the sidebar control, from the keyboard shortcut and from the Settings switch; with Ukrainian and Polish selected the control's text is in that language and has no horizontal overflow

### Implementation for User Story 2

- [X] T013 [US2] Finish the layout of `ui/privacy/PrivacySwitch.tsx`: make the sidebar label truncate with the sidebar's own classes and keep its full text in the accessible name; give the control a visible focus ring from the existing tokens (`--focus`), no colour-only state, no animation, and make sure it reads well in the dark theme and with any primary color (depends on T007, T011)

**Checkpoint**: US2 done with US1.

## Phase 5: User Story 3 - Settings and the shortcut keep working (P2)

**Goal**: Nothing that exists is lost: the Settings switch, the shortcut and the palette commands change the mode and the control follows, and the control changes the mode and Settings follows. There is exactly one privacy control in the navigation, and none while locked.

**Independent Test**: Change the mode from each place in turn and confirm all the others agree; lock the app and confirm no control is shown.

- [X] T014 [P] [US3] Extend `e2e/ux-privacy-switch.spec.ts`: turn the mode on in Settings → Appearance and see `privacy-switch` read "on"; with the keyboard shortcut and see it follow; with the command palette command "Turn privacy mode off" and see it follow; turn it on with the sidebar control and see the Settings switch `aria-checked="true"`; in a wide window exactly one `[data-testid="privacy-switch"]` is in the page and no `privacy-switch-topbar` is visible; in a narrow window with the drawer open there is one `privacy-switch` in the drawer and one `privacy-switch-topbar` in the top bar, and they show the same state; lock the app and see neither on the lock screen, unlock and see it back in the state it was left in
- [X] T015 [P] [US3] Extend `ui/privacy/privacy-guard.test.ts` with source checks on `ui/shell/AppShell.tsx` and `ui/shell/Topbar.tsx`: the sidebar item and the top-bar button are imported through `React.lazy` (not statically) from `../privacy/PrivacySwitch`, the sidebar item is rendered once in the sidebar footer and not in `PlainShell`, and `PrivacyIndicator` is no longer referenced anywhere under `ui/`

**Checkpoint**: US3 done with US1 and US2.

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Update `docs/privacy.md` (one sentence in "What privacy mode hides": the switch is always in the sidebar, and in the top bar on narrow windows, so it can be turned on without opening Settings) and run `pnpm check:docs`
- [X] T017 [P] Add a note to `specs/016-privacy-mode/spec.md` under its Clarifications section: "Note (2026-11-01): spec 017 replaces the indicator that appeared only while the mode was on (FR-011) with a control that is always shown in both states."
- [X] T018 Run `pnpm --filter @cashfold/web build`, `pnpm check:bundle`, `pnpm check:licenses` and confirm the initial JavaScript is still inside its budget and no `package.json` changed; if the initial size grew, move whatever `Topbar` imports into the lazy chunk (research R7)
- [X] T019 Run the full verification (`pnpm typecheck`, `pnpm exec eslint apps packages e2e scripts`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, the web e2e specs `ux-privacy-mode`, `ux-privacy-switch`, `ux-command-palette` and `ux-help` on Chromium, Firefox and the RTL project, and the desktop `privacy` and `help` specs) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. T004 needs T003.
- **US1 (Phase 3)**: after Foundational. This is the MVP.
- **US2 (Phase 4)**: after US1 (it refines the same component and adds checks).
- **US3 (Phase 5)**: after US1; independent of US2.
- **Polish (Phase 6)**: after the stories you ship.

### Within Each Story

- Tests first (they fail), then the component, then the shell wiring (T005 and T006 before T007 to T010).
- `PrivacySwitch.tsx` before `AppShell.tsx` and `Topbar.tsx`.

### Parallel Opportunities

- Phase 2: T002 and T003 together.
- Phase 3 tests: T005 and T006 together; then T008 and T009 together after T007.
- Phase 4: T011 and T012 together.
- Phase 5: T014 and T015 together.
- Phase 6: T016 and T017 together.

## Parallel Example: User Story 1

```text
Task: "Create ui/privacy/PrivacySwitch.test.tsx"
Task: "Create e2e/ux-privacy-switch.spec.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 and Phase 2.
2. Phase 3: the control in both states, wide and narrow, with the old tests updated.
3. **Stop and validate** with quickstart scenarios 1 to 5 and 10; ship if ready.

### Incremental Delivery

1. Foundation, then US1 (MVP).
2. US2: accessibility, announcements, long labels (scenarios 7 and 8).
3. US3: every route stays in step, one control, nothing while locked (scenarios 6 and 9).
4. Polish, docs and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- The control holds no state of its own, so it can never disagree with the preference.
- Avoid: a second privacy button beside the new one, a colour-only state, a status that is not in the visible text, putting the components in the initial chunk, or raising the bundle budget.
