# Research: Privacy Mode

What was found in the repository, the decision, and what else was considered.

## R1. Where money reaches the screen

**Finding** (`apps/web/src`): formatting is in one file, `ui/ledger/format.ts` (`formatMoney`, `formatSigned`, `formatPlain`). It reaches the screen through:

| Path | Where | Handling |
|------|-------|----------|
| `<Amount>` | `kit/amount.tsx`, used by `Stat` values, Overview totals and tables, Accounts list and group totals, Transactions rows and day totals, `AccountOption` | mask inside the component |
| `ledger.money()` / `ledger.signed()` | defined in `LedgerProvider.tsx`; used in `SchedulesView` (lines 64, 68, 208, 209), `GoalsView` (55), `BudgetsView` (100, 138, 174), `TransactionsScreen` (366, 368 transfers), `CsvImportPanel` (234), `OverviewScreen` (184, 221) | masked strings; those placed in JSX become `<Amount>` |
| Templates with money in the sentence | `budgets.ratio` ("{spent} of {limit}"), `schedules.transferAmount` ("{out} → {into}") | render with `<Amount>` nodes (R5) |
| `formatPlain` | add/edit forms (`TransactionMode`, `TransferMode`, `AccountsScreen`, `GoalsView`, `SchedulesView`) | stays real: the forms show what is typed (FR-012) |
| Notification text | `adapters/notifications/notify.ts`, filled by `ui/desktop/ReminderService.tsx` | own rule (R6) |
| Charts | Overview trend is an SVG polyline with an `aria-label`, and tables use `Amount`; progress bars use the native `<progress>` plus a text status | shapes stay (clarification); text through `Amount` |

No other `Intl.NumberFormat` is used for money (the only ones are file sizes and number separators).

**Decision**: mask in `Amount` and in `ledger.money/signed`, move the string-in-JSX sites to `<Amount>`, and protect the result with a source-scan test (R8).

## R2. How a masked amount behaves

**Decision**: when the mode is on and the amount is not revealed, `Amount` renders:

- the text `••••` followed by the currency code (clarification 2), in a fixed-width inline box (`min-width` in `ch`, set by a class, no inline style), so a screen does not shift;
- no `data-sign`, no gain or loss colour and no plus sign (FR-003), and none of the real figure anywhere in the element, its attributes or its children;
- `role="button"`, `tabIndex={0}`, an accessible name "Hidden amount, USD. Press to reveal" (the currency is not secret), `aria-live` not set (the reveal is announced by a polite status, R4);
- on click, tap, Enter or Space: reveal this one amount for 5 seconds.

**Alternatives considered**: CSS blur of the real text (rejected: the figure stays in the DOM, so a screen reader, copy and a DOM scan would read it, failing FR-007); a `<button>` element (rejected: an amount sits inside rows, links and buttons, and a button inside a button is invalid; a `span` with the button role avoids invalid HTML but see R9 for nested interactive content).

**Risk**: width of the mask must not depend on the figure. Using a fixed `min-w-[Nch]` with right alignment matches the widest common figure but a very large figure can still be wider when revealed; that is acceptable (revealed amounts are temporary and the spec asks only that masked layout does not jump).

## R3. Keeping the figure out of the DOM while masked

**Decision**: `Amount` formats the money only in the revealed branch. `ledger.money/signed` return the masked string without calling `formatMoney` when the mode is on. Sort keys, `data-testid`s and other attributes must not carry figures (existing `data-testid`s hold ids, not amounts; the spec scan in the e2e checks).

Tooltips and `aria-label`s: the trend SVG label is generic; the `Progress` component takes `label` and `statusText`, which callers fill with words, not money (checked in the source scan, R8).

## R4. Reveal state and clearing

**Decision**: a module-level store (`reveal-store.ts`) with `reveal(id)`, `isRevealed(id)`, `clear()` and `subscribe`. An amount's id is a stable key built from where it is drawn (`useId()` per `Amount` instance), so revealing one never reveals another, even for the same figure. A reveal lasts 5 seconds (one timer per id, cleared when replaced). `clear()` runs on:

- route change (`usePathname` in `PrivacyProvider`);
- window blur and the privacy cover (`useCore().covered`);
- lock and sign-out (the provider is mounted inside the unlocked shell, so it is gone with the lock, and the module store is cleared on unmount);
- turning Privacy mode off or on.

Announcements: revealing and re-hiding are announced politely with a visually hidden status ("Amount shown" / "Amounts hidden") held by `PrivacyProvider`, not by the amount, so many amounts do not talk at once. Focus never moves; if a revealed amount has focus when it hides, focus stays on it (it is the same element).

**Alternatives considered**: React context state per screen (rejected: re-renders the screen on each reveal and cannot be cleared from the shell); sessionStorage (rejected: reveal state must never persist).

## R5. Money inside translated sentences

**Finding**: only `budgets.ratio` and `schedules.transferAmount` pass money into messages (plus the notification messages). A message cannot hold a component.

**Decision**: `interleave(template, nodes)` formats the message with unique placeholder tokens, splits on them, and returns React nodes with the `<Amount>` elements put back. About 20 lines, tested, no dependency. Each money placeholder is then its own revealable amount.

**Alternatives considered**: mask both in one go (rejected: one click would reveal two figures; the spec says one amount at a time); a rich-text feature in the i18n layer (rejected: much larger change for two messages).

## R6. Notifications

**Finding**: notification text is built in the page (`textFor` in `adapters/notifications/notify.ts`), not by the desktop shell (the shell only reports whether notifications are supported). Today the title is "Due: {name}" and the body "Scheduled for {date}"; the amount is added when the flag `cashfold.reminders.amounts` is `1`, which is set from a checkbox in `SchedulesView`. A single reminder is shown as itself; several become one summary with a count.

**Decision**:
- Generic by default: title and body that say only that something needs attention (new messages, three languages), with no name, date or count; the several-reminders case uses the same generic text (FR-018).
- New pref `notificationDetails` (`'auto' | 'on' | 'off'`, same precedent as the Accounts view choice). `auto` means never chosen and takes the value of the old amounts flag, so people who allowed amounts keep details on (FR-021). When details are on, the title and body are today's (name and day), and the amount is added only if the old flag is also on.
- The text builder takes `details: boolean` and `amounts: boolean`; the reminder service passes both; amounts are formatted with `formatMoney` directly (never the masked `ledger.money`), so Privacy mode does not change a notification and a notification setting does not depend on it (FR-017).
- The checkboxes move from `SchedulesView` to the new Settings section; `SchedulesView` keeps the permission button and a line pointing to Settings.
- Nothing crosses the desktop bridge for notification text. The bridge carries counts for the badge only, unchanged.

**Alternatives considered**: keep names in the title and only drop amounts (rejected: the spec requires no names by default); migrate by copying the flag into prefs at startup (rejected: needs a once-only startup hook; the `auto` value does the same without one).

## R7. Preferences

**Finding**: `cashfold.ui` is one JSON object (4 KB cap) parsed field by field with defaults (`ui/prefs/schema.ts`); invalid values fall back without touching the rest. `resetAccountPrefs` keeps theme, language and layout when an account is signed out, which is what FR-020 wants.

**Decision**: add `privacyMode: boolean` (default false) and `notificationDetails: 'auto' | 'on' | 'off'` (default `'auto'`) in the same style; keep `v: 1`. `resetAccountPrefs` is unchanged (it copies the rest). The two fields add under 60 bytes.

## R8. A test that fails when new money formatting appears

**Decision**: `money-sources.test.ts` reads the source files (the same technique as `no-raw-controls.test.ts` and the palette guard test) and checks:

1. `formatMoney`, `formatSigned` are imported only by an allow-list (`ledger/format.ts`, `LedgerProvider.tsx`, `kit/amount.tsx`, `adapters/notifications` through the reminder service, `privacy/`).
2. `.money(` and `.signed(` calls are counted per file against a ratchet table (today's sites, minus the ones converted); a new call, or a count that goes up, fails with the file name. The table can only be reduced in later changes.
3. No `Intl.NumberFormat` with `style: 'currency'` or `currency:` anywhere.
4. In `kit/amount.tsx`, the real figure is produced only inside the revealed branch (a text check on the structure, backed by the browser test).

**Alternatives considered**: ESLint rule (rejected: no custom rule infrastructure beyond the kit rule); a runtime check in development (rejected: misses code paths not exercised).

## R9. Amounts inside other interactive elements

**Finding**: some amounts sit inside rows that are buttons or links (for example a transaction row). A `role="button"` inside a button or link is a nested-interactive violation in axe.

**Decision**: the implementation audits every `Amount` call site for an interactive ancestor. Where there is none, the amount is the reveal control. Where there is one (a clickable row), the masked amount is a plain `span` (not focusable), and a click on it reveals it instead of activating the row (`stopPropagation`); keyboard users reveal it from the row's own detail view or edit form, which always show real figures (FR-012). The audit result is listed in the tasks, and an axe run in the browser test covers both kinds.

**Audit result (T017)**, every `<Amount>` call site and whether it has an interactive ancestor:

| Site | Ancestor | Mode |
|------|----------|------|
| `transactions/TransactionsScreen.tsx` row amount (line 400) | a `span` beside the row button (not inside it) | focusable |
| `transactions/TransactionsScreen.tsx` day total (line 459) | a heading (`h2`) | focusable |
| `accounts/AccountsScreen.tsx` balance (line 270) | a `div` beside the name link | focusable |
| `accounts/GroupSection.tsx` subtotal (line 31) | a plain `div` | focusable |
| `overview/OverviewScreen.tsx` tiles (lines 120 to 125) and trend table (lines 167 to 169) | `Stat` tiles, table cells | focusable |
| `accounts/AccountOption.tsx` balance | a listbox option | not drawn while masked (R13) |

No `<Amount>` sits inside a link, a button or a clickable row today, so none needs `inert`; the prop stays for amounts that are put in one later. Two attributes did leak direction, and are removed while masked: `data-sign` on the transaction amount wrapper (`TransactionsScreen.tsx` line 399) and on the account balance (`AccountsScreen.tsx` line 269).

**Inventory of dialogs and status messages that can show money (T017)**

| Where | Shows money? | Handling |
|-------|--------------|----------|
| Add and edit forms (transaction, transfer, account, goal, budget, schedule) | Yes, in the fields | Real on purpose (FR-012); filled with `formatPlain` |
| Adjust balance (`AccountsScreen`) | The target, in a field | Real on purpose |
| Budget detail (`BudgetsView` line 145) | Spent, limit, available | Moved to `<Amount>` (T018) |
| CSV import preview (`CsvImportPanel` line 234) | Row amounts | Moved to `<Amount>` (T021) |
| Missing exchange rates dialog | Currency codes only | Nothing to mask |
| Delete and archive confirmations | Names only | Nothing to mask |
| Status messages (`status.saved`, `deleted`, `restored`, `accountSaved`, `accountMoved`, `accountArchived`, `accountUngrouped`) | No (a name at most) | Nothing to mask; the e2e scan covers them |
| Error messages | No: `ui/errors/catalogue.ts` states that amounts, names and notes are never read from an error | Nothing to mask |

**Alternatives considered**: always make the amount focusable (rejected: invalid nesting and axe failures); a "reveal this row" key on the row (rejected: new interaction pattern, more surface).

## R10. The shortcut

**Finding**: the desktop shell owns its shortcuts in `apps/desktop/src/main/shortcuts.ts`; a test compares the table with the Help list. Existing keys: Mod+N, L, comma, F, K, 1 to 5, Shift+I, Shift+E, Mod+W/M/Q/0/plus/minus. The palette added `palette`. A browser has no shortcuts of its own except the palette's key listener.

**Decision**: **Mod+Shift+M** ("M for money"), action id `privacy`, `data: true` (ignored while locked). Checked against the common clashes: it is not a Chrome, Edge or Safari page shortcut on Windows or Linux; Firefox uses Ctrl+Shift+M for its responsive design view and Chrome on macOS uses Cmd+Shift+M for the profile menu, both browser features a page can override with `preventDefault` while the app is focused (the same position as Cmd/Ctrl+K). Mod+M alone is the desktop app's minimise and stays unchanged. It does not use Alt (the shell table has a test against Alt combinations).

The page handles it in a browser with a small key listener (like the palette's), and in the desktop app through the shell's `privacy` action; the shell stops handled presses from reaching the page, so the two never both fire. The listener ignores presses already prevented and works while a text field has focus (it does not type a character because the combination includes a modifier).

**Alternatives considered**: Mod+Shift+H (rejected: Firefox history, Safari home page, Finder home), Mod+Shift+P (rejected: private window), Mod+Shift+L, Mod+Shift+. (rejected: weak mnemonic or awkward). The key can be changed in one place if review prefers another.

## R11. Bundle budget

**Finding**: the initial JavaScript is 372,363 of 374,784 gzipped bytes; only about 2.4 KB is free. `Amount`, the store and the provider are needed on the first page.

**Decision**: keep the always-loaded part small: `mask.ts`, the store (about 40 lines), the provider (about 40 lines) and the `Amount` branch. Load the rest as separate chunks: `PrivacySection` (Settings), the indicator and key listener together in one lazy chunk mounted after unlock (as the palette host is), and the palette commands (already lazy). If the measured initial size still grows past the budget, the provider's route listener moves into the lazy chunk. Measure with `check:bundle` at the end of Phase 1; do not raise the budget.

## R12. Palette commands

**Decision**: add `privacy: boolean` and `togglePrivacy()` to `PaletteContext`, and two commands: "Turn privacy mode on" (enabled when off) and "Turn privacy mode off" (enabled when on), so the list never offers a no-op. `PaletteHost` supplies the state from `usePrivacy()`.

## R13. Dropdown balances

**Finding**: spec scenario 6 says a dropdown shows account names without balances, while FR-002 lists dropdown balances among masked amounts. A reveal control inside a list of choices would fight selection and keyboard navigation.

**Decision**: while the mode is on, `AccountOption` shows the name only. The spec wording is aligned (FR-002 notes it).

## R14. Testing approach

**Decision**:
- Unit: `mask.ts`; `reveal-store` (reveal, replace, timeout with fake timers, clear on each trigger); `interleave`; prefs parsing (defaults, invalid values, 4 KB cap, sign-out keeps); notification text (generic default, many, details, amounts, language); the shortcut agreement test (shell table, Help list, three platforms); the source scan (R8).
- Browser (real Chromium, axe, light and dark): masked and revealed states, click, Enter, Space, auto-hide, focus stays, nested-interactive audit, no figure in the DOM text or attributes.
- E2E (web): with the mode on, visit every main screen and dialog and assert that no amount-like text (a digit group with a decimal part next to a currency code) exists in `innerText`, `aria-label`, `title`, or `alt`; toggle by the shortcut; persistence across reload and sign-out; export still real.
- E2E (desktop): the shortcut toggles the mode; ignored while locked; Help lists it.
