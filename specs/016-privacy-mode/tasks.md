---

description: "Task list for Privacy Mode"
---

# Tasks: Privacy Mode

**Input**: Design documents from `/specs/016-privacy-mode/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work and the request asks for them.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`. The new folder is `ui/privacy/`. User Story 1 includes the minimal Settings switch, because without it nobody can turn the mode on; the notification settings are in User Story 3, and User Story 4 checks that all of it stays on the device.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `016-privacy-mode` (create it from `main` if not) and run `pnpm vitest run` once to record a green baseline
- [X] T002 Run `pnpm --filter @cashfold/web build` then `pnpm check:bundle` and write the "initial JS" and "worker and lazy JS" gzipped sizes into the PR notes (baseline: 372,363 of 374,784 initial bytes before this feature); later tasks must not raise the budget

## Phase 2: Foundational (blocks every story)

- [X] T003 [P] Add two fields to `Prefs`, `DEFAULT_PREFS` and the parser in `ui/prefs/schema.ts`: `privacyMode: boolean` (default `false`) and `notificationDetails: 'auto' | 'on' | 'off'` (default `'auto'`; any other value falls back to `'auto'`); each parsed field by field so an invalid value never touches the others; keep `v: 1`. Extend `ui/prefs/schema.test.ts` (defaults, invalid values, the object stays under `MAX_PREFS_BYTES` = 4096) and `ui/prefs/reset-account.test.ts` (signing out keeps both, FR-020)
- [X] T004 [P] Create `ui/privacy/mask.ts`: export `MASK = '••••'`, `maskedMoney(currency: string): string` returning the mask followed by a space and the currency code ("•••• USD"), and `MASK_WIDTH_CLASS` (a fixed minimum width class in `ch`, no inline style). Add `ui/privacy/mask.test.ts` (the text never contains a digit, always ends with the given code, same width class for any input)
- [X] T005 [P] Create `ui/privacy/reveal-store.ts`: a module-level store with `reveal(id)`, `isRevealed(id)`, `clear()` and `subscribe(listener)`, `REVEAL_MS = 5000`, one timer per id (a new reveal of the same id restarts it), revealing one id never reveals another; nothing is persisted. Add `ui/privacy/reveal-store.test.ts` with fake timers: hides after 5000 ms, restart, independence of ids, `clear()` cancels timers and notifies subscribers once
- [X] T006 [P] Add the strings to `ui/i18n/messages/en.json`, `uk.json`, `pl.json`: `privacy.mode.title`, `privacy.mode.description`, `privacy.mode.label`, `privacy.indicator.on`, `privacy.indicator.hint`, `privacy.amount.hidden` (with a `{currency}` parameter: "Hidden amount, {currency}. Press to reveal."), `privacy.announce.shown`, `privacy.announce.hidden`, `privacy.exportNote`, `privacy.notify.details`, `privacy.notify.details.hint`, `privacy.notify.amounts`, `privacy.palette.on`, `privacy.palette.off`, `privacy.keywords.on`, `privacy.keywords.off`, `schedules.notify.generic.title` ("Cashfold has a reminder"), `schedules.notify.generic.body` ("Open Cashfold to see it."), `help.shortcut.privacy` ("Turn privacy mode on or off"); keep keys sorted, plural forms complete, and `ui/i18n/catalogue-complete.test.ts` green
- [X] T007 Create `ui/privacy/usePrivacy.ts` and `ui/privacy/PrivacyProvider.tsx`: `usePrivacy()` returns `{ on, toggle, isRevealed(id), reveal(id) }` over the `privacyMode` preference (`usePrefs`/`prefsStore`) and the reveal store; with no provider mounted it returns `on: false` and no-op functions. `PrivacyProvider` clears the store on route change (`usePathname`), when `useCore().covered` becomes true, on `window` blur, on unmount (lock) and whenever `privacyMode` changes, and renders a visually hidden `role="status"` that says `privacy.announce.shown` / `privacy.announce.hidden` politely (depends on T003, T005, T006)
- [X] T008 Wrap the unlocked shell in `<PrivacyProvider>` in `ui/shell/AppShell.tsx` (inside `UnlockedShell`, around the layout and outside every screen), and add a source check to `ui/privacy/privacy-guard.test.ts` that `PrivacyProvider` appears in `UnlockedShell` and not in `PlainShell` (depends on T007)

**Checkpoint**: preferences, mask, reveal store, provider and strings exist; nothing is visible yet.

## Phase 3: User Story 1 - Hide the money and reveal one amount at a time (P1) 🎯 MVP

**Goal**: With Privacy mode on, no figure is readable on any screen, and one amount at a time can be revealed for about five seconds.

**Independent Test**: Turn the mode on in Settings → Appearance, visit Overview, Accounts, Transactions, Plan and the import preview, confirm every amount is masked and nothing shifts, reveal one amount by click and by keyboard, and confirm it hides again by itself and on navigation, blur and lock.

### Tests for User Story 1

- [X] T009 [P] [US1] Extend `ui/kit/amount.test.tsx` (server-rendered markup): with no provider or the mode off the output is exactly today's (text, `data-sign`, tone classes, plus sign); with the mode on and not revealed the markup contains no digit of the figure, no `data-sign`, no `text-(--success)` / `text-(--danger)`, no plus or minus, contains the mask and the currency code, `role="button"`, `tabindex="0"` and the name from `privacy.amount.hidden`; with `inert` (interactive ancestor) it has no `tabindex`
- [X] T010 [P] [US1] Create `ui/privacy/interleave.test.ts`: a translated sentence with two placeholders (`budgets.ratio`, `schedules.transferAmount`) comes back as text and two nodes in the right order in English, Ukrainian and Polish; a missing node leaves no token behind
- [X] T011 [P] [US1] Create `ui/privacy/money-sources.test.ts` (reads the sources like `ui/no-raw-controls.test.ts`): (1) `formatMoney` and `formatSigned` are imported only by `ledger/format.ts`, `ledger/LedgerProvider.tsx`, `kit/amount.tsx`, `ui/desktop/ReminderService.tsx` and files under `ui/privacy/` and tests; (2) `.money(` and `.signed(` calls are counted per file against a table that starts at the sites left after T018 to T021 and may only go down; a new call or a higher count fails naming the file; (3) no `Intl.NumberFormat` with `style: 'currency'` or a `currency:` option anywhere; (4) in `kit/amount.tsx` the call to `formatMoney`/`formatSigned` is inside the revealed branch only
- [X] T012 [P] [US1] Create `ui/privacy/Privacy.browser.test.tsx` (pattern of `ui/kit/kit.browser.test.tsx`): a masked `Amount` is announced "Hidden amount, USD. Press to reveal."; click, Enter and Space reveal only that amount (two amounts of the same figure stay masked); a revealed amount hides after 5 seconds (real timers or an injected duration); focus stays on it; no figure in `textContent` or any attribute while masked; reveal clears on `clear()`; an amount inside a link or button is a `span` without `tabindex` and a click reveals it without activating the ancestor; axe passes in light and dark, masked and revealed Also assert that a masked and a revealed amount keep the same width of their container and the same line count in a table cell and in a list row (SC-004), and that a touch tap (pointer events with `pointerType: "touch"`) reveals an amount
- [X] T013 [P] [US1] Create `e2e/ux-privacy-mode.spec.ts` (web, skip WebKit like the other sign-up specs): sign up, create two accounts in two currencies, a transaction, a budget, a goal and a schedule; turn the mode on in Settings → Appearance; on Overview, Accounts, Transactions, Plan (budgets, goals, schedules), Settings → Data (import preview with a small CSV) and the add sheet's account dropdown, assert that `innerText`, every `aria-label`, `title` and `alt` contain no amount-like text (`/\d[\d.,\s  ]*\d\s?(USD|EUR|UAH|PLN)/` and `/[+−-]\d/` next to a currency code) and that names, dates and notes are still readable; reveal one amount by click and see it hide after about 5 seconds; navigate away and back and see it masked again; axe passes with the mode on Also open every dialog listed in the T017 inventory with the mode on and run the same scan, and include `document.title` in the scan (FR-007, edge case "window title")

### Implementation for User Story 1

- [X] T014 [US1] Change `ui/kit/amount.tsx` as in `contracts/ui-contract.md` §3: read `usePrivacy()`; when the mode is on and `isRevealed(id)` is false (id from `useId()`) render `maskedMoney(currency)` in a `span` with `role="button"`, `tabIndex={0}`, the `privacy.amount.hidden` name, `MASK_WIDTH_CLASS`, `tabular-nums whitespace-nowrap`, no `data-sign`, no tone classes, no sign; click/tap/Enter/Space call `reveal(id)` (Space is prevented from scrolling); format the figure with `formatMoney`/`formatSigned` only in the other branch; add an optional `inert` prop (no `tabIndex`, click reveals and calls `stopPropagation`); with the mode off the output is byte-for-byte today's (depends on T004, T007, T009)
- [X] T015 [US1] Make `money` and `signed` in `ui/ledger/LedgerProvider.tsx` mask-aware: when `usePrivacy().on` is true return `maskedMoney(currency)` without calling `formatMoney`/`formatSigned`; otherwise unchanged. `formatPlain`, `parseMoney` and every form helper stay untouched (FR-012)
- [X] T016 [US1] Create `ui/privacy/interleave.ts`: `interleave(template: string, nodes: Record<string, ReactNode>): ReactNode[]` — format the message with unique placeholder tokens for each name, split on them, and put the nodes back in order (depends on T010)
- [X] T017 [US1] Audit every `<Amount>` call site for an interactive ancestor (a `button`, `a`, `role="button"`, `role="link"`, `role="option"` or a clickable row): `ui/transactions/TransactionsScreen.tsx` lines 400 and 459, `ui/accounts/AccountsScreen.tsx` line 270, `ui/accounts/GroupSection.tsx` line 31, `ui/overview/OverviewScreen.tsx` lines 120 to 125 and 167 to 169, `ui/kit/stat.tsx`. Record the result as a table in `research.md` under R9 ("site, ancestor, mode") and pass `inert` at the sites that have an interactive ancestor Also make an inventory of every dialog and status message that can show money (adjust balance, delete confirmations, missing-rates, transfer rates, import preview, schedule and budget confirmations; search `notify(` and `status.notify` calls for money parameters) and add it as a second table in `research.md` R1 with "shows money? how handled"; record that error messages carry no amounts (see `ui/errors/catalogue.ts`)
- [X] T018 [P] [US1] In `ui/plan/BudgetsView.tsx` replace the string figures (lines 100 to 106 and 138) with `<Amount>` nodes and render `budgets.ratio` through `interleave` with two `<Amount>` nodes; change `text()` at line 174, which pre-fills the edit form, to `formatPlain` so the form keeps showing the real figure with the mode on (a masked string there would corrupt the saved value)
- [X] T019 [P] [US1] In `ui/plan/GoalsView.tsx` replace the `money()` strings at line 55 (saved, remaining, monthly) with `<Amount>`; keep `data-testid`s
- [X] T020 [P] [US1] In `ui/plan/SchedulesView.tsx` replace the figures at lines 64, 208 and 209 with `<Amount>` and render `schedules.transferAmount` (line 68) through `interleave` with two `<Amount>` nodes
- [X] T021 [P] [US1] In `ui/transactions/TransactionsScreen.tsx` (lines 366 and 368, the transfer amounts), `ui/data/CsvImportPanel.tsx` (line 234) and `ui/overview/OverviewScreen.tsx` (lines 184 and 221) replace the string figures with `<Amount>`; keep `showSign` where a sign was shown
- [X] T022 [US1] Make `ui/accounts/AccountOption.tsx` show the account name only while the mode is on (no balance, no mask), as `contracts/ui-contract.md` §5 says; update `ui/accounts/AccountOption.browser.test.tsx` for both modes
- [X] T023 [US1] Create `ui/privacy/PrivacySection.tsx` with the Privacy mode switch (kit `SwitchField`, label `privacy.mode.title`, description `privacy.mode.description` naming what is hidden and what is not, and the `privacy.exportNote` line) bound to `privacyMode`, and mount it in `ui/settings/AppearanceSection.tsx`, loaded lazily (`React.lazy` + `Suspense`) so it is not in the initial chunk
- [X] T024 [US1] Fill the ratchet table in `ui/privacy/money-sources.test.ts` with the real remaining `.money(` and `.signed(` counts per file, run `pnpm vitest run apps/web/src/ui/privacy`, then run `pnpm --filter @cashfold/web build` and `pnpm check:bundle`; if the initial size passes the budget, move the provider's route and blur listeners into a lazy chunk before continuing (research R11)

**Checkpoint**: US1 works on its own and can ship: the switch hides every amount, reveal works, nothing readable is left (T013 passes).

## Phase 4: User Story 2 - Switch with one key press and see the state (P1)

**Goal**: One shortcut turns the mode on or off from any screen, in the web app and the desktop app; an indicator and the command palette show and change the state.

**Independent Test**: Press the shortcut with the app unlocked and see every amount mask and the indicator appear; press again to undo; while locked, nothing happens; Help lists the shortcut.

### Tests for User Story 2

- [X] T025 [P] [US2] Extend `packages/platform/src/schemas.test.ts` (`ActionIdSchema.safeParse('privacy')` succeeds) and `packages/platform/src/help-shortcuts.test.ts` (add `privacy` to the app actions the list must contain once)
- [X] T026 [P] [US2] Extend `apps/desktop/src/main/shortcuts.test.ts`: Command+Shift+M on macOS and Ctrl+Shift+M on Windows and Linux match `privacy`; plain Mod+M still minimises; Alt combinations do not match; the entry has `data: true`; add `['privacy', 'm', true]` to the `CONTRACT` list and `'privacy'` to the app-action filter; confirm `apps/desktop/src/main/help-shortcuts.test.ts` passes on all three platforms
- [X] T027 [P] [US2] Create `ui/privacy/privacy-keys.test.ts`: the browser key matches Command+Shift+M on an Apple system and Control+Shift+M elsewhere, not without Shift, not with Alt, not when already prevented or composing text; reuse `isApplePlatform` from `ui/palette/palette-keys.ts`
- [X] T028 [P] [US2] Extend `ui/palette/builtin-commands.test.ts`: `privacy-on` is offered only when the mode is off and `privacy-off` only when it is on, each calls `togglePrivacy` once and nothing else; every command still has titles and keywords in the catalogue
- [X] T029 [P] [US2] Extend `ui/desktop/menu-action.test.ts` (the `privacy` action calls `togglePrivacy`; while locked only `lock` does anything) and `ui/shell/HelpDialog.test.tsx` (a browser shows the palette and the privacy shortcuts, written ⇧⌘M or Ctrl+Shift+M; the desktop list shows `privacy` too)
- [X] T030 [US2] Extend `e2e/ux-privacy-mode.spec.ts`: press the shortcut (key chosen by asking the page whether it is an Apple system, like `e2e/ux-command-palette.spec.ts`), see the mode flip on a screen with amounts, also while a text field has focus and without typing a character; the indicator says "Privacy mode on" and toggles when activated; the shortcut does nothing on the lock screen

### Implementation for User Story 2

- [X] T031 [P] [US2] Add `'privacy'` to `ACTION_IDS` in `packages/platform/src/schemas.ts` and `app('privacy', 'privacy', primary('M', 'shift'))` to `HELP_SHORTCUTS` in `packages/platform/src/help-shortcuts.ts` (depends on T025)
- [X] T032 [US2] Add `{ keys: ['m'], modifier: 'primary', shift: true, platforms: 'all', action: 'privacy', data: true }` to `SHORTCUTS` in `apps/desktop/src/main/shortcuts.ts` and `'privacy'` to `AppShortcutAction` (depends on T026, T031)
- [X] T033 [US2] In `ui/desktop/menu-action.ts` add `togglePrivacy(): void` to `MenuActionDeps` and handle the `privacy` action; in `ui/desktop/DesktopActions.tsx` run it without closing other overlays first (like `palette`) and pass `usePrivacy().toggle` (depends on T029, T031)
- [X] T034 [US2] Create `ui/privacy/PrivacyKeys.tsx` (a `keydown` listener on `window` using `isPaletteKey`'s pattern: Control+Shift+M or Command+Shift+M, `preventDefault()`, `toggle()`, not installed in the desktop app) and `ui/privacy/PrivacyIndicator.tsx` (visible only while the mode is on: an eye-slash icon and the text from `privacy.indicator.on`, a button with `aria-pressed`, toggles when activated, placed in the sidebar footer above Help in `ui/shell/AppShell.tsx` and in the narrow-window drawer via the same sidebar). Load both through one `React.lazy` chunk mounted next to `PaletteHostLazy` (depends on T027, T032)
- [X] T035 [US2] Add `privacy: boolean` and `togglePrivacy(): void` to `PaletteContext` in `ui/palette/registry.ts`, the `privacy-on` and `privacy-off` commands to `ui/palette/actions.ts` (titles `privacy.palette.on`/`.off`, keyword keys `privacy.keywords.on`/`.off`, `enabled` by `ctx.privacy`), and supply both from `usePrivacy()` in `ui/palette/PaletteHost.tsx` (depends on T028) Adding required fields breaks the hand-built contexts in `ui/palette/registry.test.ts`, `ui/palette/entities.test.ts` and `ui/palette/builtin-commands.test.ts`: add `privacy: false` and `togglePrivacy: vi.fn()` to each
- [X] T036 [US2] In `ui/shell/HelpDialog.tsx` show the privacy row next to the palette row in the browser's one-section list (filter on `palette` and `privacy`) and keep the desktop list as is (depends on T029, T031) Also update `e2e/ux-help.spec.ts`, which asserts exactly one `kbd` in the browser Help dialog: it must now expect two (the palette and the privacy shortcuts), each matching ⌘K / Ctrl+K and ⇧⌘M / Ctrl+Shift+M

**Checkpoint**: US2 works with US1; the shortcut, indicator and palette all agree.

## Phase 5: User Story 3 - Notifications that say nothing private (P1)

**Goal**: By default a notification says only that something needs attention; the schedule name and day appear only when details are on, and the amount only when amounts are on too.

**Independent Test**: With a due reminder named "Rent" for 1,200.00, allow notifications and see a generic message; turn details on and see "Due: Rent / Scheduled for …"; turn amounts on and see the amount; Privacy mode makes no difference.

### Tests for User Story 3

- [X] T037 [P] [US3] Extend `apps/web/src/adapters/notifications/notify.test.ts`: with `details: false` one reminder and several reminders give the same generic title and body containing no name, date, amount or count (including a name like "Rent" and an amount like "1,200.00" in the input); `details: true, amounts: false` gives the name and the day and no amount; `details: true, amounts: true` adds the amount; the tag stays the reminder key; the text follows the language of `copy`
- [X] T038 [P] [US3] Create `ui/privacy/notification-details.test.ts` for `effectiveNotificationDetails(pref, amountsAllowed)`: `'on'` → true, `'off'` → false, `'auto'` → the amounts flag (FR-021: people who allowed amounts keep details on)
- [X] T039 [P] [US3] Extend `ui/desktop/reminder-service.test.ts`: the service passes `details` and `amounts` to the builder, uses the real formatter for the amount (not the masked ledger string) even when Privacy mode is on, and shows nothing without permission or while locked
- [X] T040 [US3] Extend `e2e/ux-privacy-mode.spec.ts`: install an init script that records every call to `ServiceWorkerRegistration.prototype.showNotification` and `Notification` (title, body) and grants permission; with a schedule named "Rent" due now assert the recorded text is the generic message with no "Rent", no date, no amount; turn details on in Settings and assert "Rent" appears; turn amounts on and assert the amount; with two due schedules assert one generic notification Also update the two existing specs that expect the old default text: `e2e/us6-schedules.spec.ts` (line 104, `Due: Rent`) and `apps/desktop/e2e/presence.spec.ts` (lines 123 and 125): by default assert the generic title and body, then switch details on in Settings and assert `Due: Rent`, reusing the fake `Notification` those specs already install; in both, choose the notification and confirm the schedules open as before (FR-019)

### Implementation for User Story 3

- [X] T041 [US3] Change `textFor` and `showDueReminders` in `apps/web/src/adapters/notifications/notify.ts`: `NotifyDeps` gains `details: boolean`; replace `showAmounts` with `amounts: boolean`; add `generic: NotificationText` to `ReminderCopy`; with `details: false` return the generic text for one reminder and for several (no count); with `details: true` keep the current title and body, adding the amount only when `amounts` is true (depends on T037) Remove the keys `schedules.notify.message.many` and `schedules.notify.message.manyBody` from the three catalogues, because nothing uses them after this change
- [X] T042 [US3] Add `effectiveNotificationDetails(pref, amountsAllowed): boolean` to `ui/privacy/notification-details.ts` (depends on T038) and use it in `ui/desktop/ReminderService.tsx`: pass `details` and `amounts: amountsAllowed()`, set `copy.generic` from `schedules.notify.generic.title` and `.body`, and make `formatAmount` call `formatMoney(minor, currency, locale)` from `ui/ledger/format.ts` directly (never `ledger.money`); read the preference through `prefsStore`
- [X] T043 [US3] Move the two notification checkboxes out of `ReminderSettings` in `ui/plan/SchedulesView.tsx` into `ui/privacy/PrivacySection.tsx`: "Show details in notifications" bound to `notificationDetails` (shown as on when the effective value is on, saving `'on'`/`'off'`) and "Show amounts in notifications" (the existing `allowAmounts`/`amountsAllowed` flag, shown only while details are on) with the hints from `contracts/ui-contract.md` §6; `ReminderSettings` keeps the "Allow notifications" button and a line pointing to Settings → Appearance
- [X] T044 [US3] Keep `cashfold.reminders.amounts` and `forgetShownReminders` in `apps/web/src/adapters/notifications/browser.ts` as they are, and add a test in `apps/web/src/adapters/notifications/browser.test.ts` that signing out (the shown-keys wipe) leaves the amounts flag and both preferences alone

**Checkpoint**: US3 works with US1 and US2; notifications are generic by default.

## Phase 6: User Story 4 - Settings that stay on this device (P2)

**Goal**: Both settings sit together in Settings with plain descriptions, survive restart and sign-out, and never leave the device.

**Independent Test**: Turn both on, restart, sign out and in again: both stay on; nothing about them is in sync traffic or exports.

- [X] T045 [P] [US4] Extend `ui/privacy/Privacy.browser.test.tsx` (or add `ui/privacy/PrivacySection.browser.test.tsx`): the section shows both switches off by default with their descriptions (what is hidden and what is not), is operable by keyboard, and passes axe in light and dark at narrow and wide widths
- [X] T046 [P] [US4] Extend `e2e/ux-privacy-mode.spec.ts`: turn both settings on, reload and see both on; sign out through Settings and sign in again and see both on; read `localStorage` and confirm the only places the settings live are `cashfold.ui` (`privacyMode`, `notificationDetails`) and `cashfold.reminders.amounts`; run an export and confirm the file mentions neither setting
- [X] T047 [P] [US4] Add a test next to `ui/settings/` or in `ui/prefs/reset-account.test.ts` that a profile that had `cashfold.reminders.amounts = '1'` and no `notificationDetails` shows the details switch on and the amounts switch on (FR-021), and that Privacy mode starts off
- [X] T048 [US4] Finish the copy and layout of `ui/privacy/PrivacySection.tsx`: group the switches under one heading "Privacy", order them (mode, details, amounts), and make sure the descriptions say what is not hidden (names, dates, notes, the window itself); translate in `uk.json` and `pl.json`; check the section at a narrow width and larger text

**Checkpoint**: US4 done with US1 to US3.

## Phase 7: User Story 5 - Real figures where the person acts on them (P2)

**Goal**: Forms, exports, backups and copying a revealed amount give real figures with the mode on.

**Independent Test**: With the mode on, add and edit a transaction, export a CSV and a backup, copy a masked and a revealed amount.

- [X] T049 [P] [US5] Extend `e2e/ux-privacy-mode.spec.ts`: with the mode on, open the add sheet and the edit form of a transaction, a transfer, an account, a budget and a goal and assert each amount field shows the real figure and the saved value equals what was typed; export a CSV and compare it to the same export with the mode off (identical); copy a masked amount (the clipboard holds no figure) and a revealed one (it holds the figure)
- [X] T050 [P] [US5] Add a test in `ui/privacy/money-sources.test.ts` that form and export code paths use `formatPlain`, `parseMoney` or the core exporters and never `ledger.money`/`ledger.signed`: list the form files (`TransactionMode`, `TransferMode`, `AccountsScreen` edit form, `GoalsView` and `BudgetsView` forms, `SchedulesView` form) and fail if any of them calls the masked helpers
- [X] T051 [US5] Print: confirm by test that a screen printed with the mode on shows the mask: in `e2e/ux-privacy-mode.spec.ts` call `page.emulateMedia({ media: 'print' })` on Overview and Transactions and run the same no-figure scan (the print style must add nothing that reveals figures) and add the `privacy.exportNote` line ("Exports and backups always use real figures") to the Data screen next to the export button in `ui/data/DataScreen.tsx`

**Checkpoint**: US5 done.

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T052 [P] Add `apps/desktop/e2e/privacy.spec.ts`: press the shortcut the way the system delivers it (see `apps/desktop/e2e/palette.spec.ts`), see amounts mask and the indicator appear, press again to undo, lock and see the key do nothing; extend `apps/desktop/e2e/help.spec.ts` with a `privacy` effect (the mode flips) and its written keys (⇧⌘M / Ctrl+Shift+M)
- [X] T053 [P] Update `docs/privacy.md` (a section "What privacy mode hides": amounts masked on screen, what stays visible, reveal and timeout, notifications generic by default and the details setting, settings stored on this device only, nothing sent) and `docs/desktop.md` (the shortcut row Mod+Shift+M and that it is ignored while locked); run `pnpm check:docs`
- [X] T054 [P] Check masked layouts in Ukrainian and Polish and at larger text and narrow width: no horizontal scroll, no overlap, the mask keeps the column width; fix classes in `ui/privacy/mask.ts` or the call sites The automatic width check is in T012; this task is the by-eye pass in other languages
- [X] T055 [P] Add the 600-entry style timing guard: toggling the mode on a screen with 300 amounts re-renders without perceptible delay (a Vitest timing guard with a generous bound, like `ui/palette/search.test.ts`)
- [ ] T056 Run `pnpm --filter @cashfold/web build` and `pnpm check:bundle`, `pnpm check:licenses`, `pnpm check:no-float`; the initial JavaScript must stay inside its budget and `package.json` files must show no new dependency
- [ ] T057 Run the full verification (`pnpm typecheck`, `pnpm exec eslint apps packages e2e scripts`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, the web and desktop e2e specs of this feature) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks all stories. T007 needs T003, T005 and T006; T008 needs T007.
- **US1 (Phase 3)**: after Foundational. This is the MVP.
- **US2 (Phase 4)**: after Phase 2; the indicator and keys need US1's provider; the palette commands need the palette (already on `main`).
- **US3 (Phase 5)**: after Phase 2; independent of US1 and US2 except that its settings controls live in `PrivacySection` (T023) and so follow T023.
- **US4 (Phase 6)** and **US5 (Phase 7)**: after US1 and US3.
- **Polish (Phase 8)**: after the stories you ship.

### Within Each Story

- Tests first (they fail), then implementation.
- Pure pieces (mask, reveal store, interleave, notification text) before React parts; `Amount` and `LedgerProvider` before the call-site conversions; conversions before the ratchet table is filled (T024).

### Parallel Opportunities

- Phase 2: T003, T004, T005 and T006 together.
- Phase 3: tests T009 to T013 together; then T014 to T016 (different files) and, after T014, T018 to T021 together.
- Phase 4: T025 to T029 together, then T031 and T035 together.
- Phase 5: T037 to T039 together.

## Parallel Example: Phase 3 tests

```text
Task: "Extend ui/kit/amount.test.tsx"
Task: "Create ui/privacy/interleave.test.ts"
Task: "Create ui/privacy/money-sources.test.ts"
Task: "Create ui/privacy/Privacy.browser.test.tsx"
Task: "Create e2e/ux-privacy-mode.spec.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 and Phase 2.
2. Phase 3: mask every amount, reveal one at a time, the Settings switch.
3. **Stop and validate** with quickstart scenarios 1 to 4 and 11; ship if ready.

### Incremental Delivery

1. Foundation, then US1 (MVP).
2. US2: the shortcut, indicator and palette commands (scenarios 5 and 6).
3. US3: generic notifications (scenarios 7 and 8). US1 to US3 are all P1 and should ship together to protect a person fully.
4. US4 and US5: persistence and real-figure checks (scenarios 9 and 10).
5. Polish, docs and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- T018 matters most for safety: `BudgetsView` pre-fills its edit form with `ledger.money`, which would store the mask as the amount if left alone; it must use `formatPlain`.
- The `data-testid`s and the existing e2e specs assume real figures with the mode off; they are unchanged because the mode is off by default.
- Avoid: formatting money in a new place, putting a figure in an attribute, a reveal that survives navigation or lock, or a dependency.
