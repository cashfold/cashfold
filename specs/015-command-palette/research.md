# Research: Command Palette

Each entry records what was found in the repository, the decision, and what else was considered.

## R1. How the shortcut reaches the page

**Finding**: The desktop app has no menu bar on Windows and Linux, and on macOS only a minimal app menu. All shortcuts live in one table in `apps/desktop/src/main/shortcuts.ts`, run on the window's `before-input-event`. A press that matches is stopped from reaching the page, and the page receives a closed-set action id (`ACTION_IDS` in `packages/platform`). The page handles it in `performMenuAction` and ignores everything but `lock` while locked. A test (`help-shortcuts.test.ts`) fails whenever this table and the Help list disagree. The web app has no keyboard shortcuts at all.

**Decision**: Desktop: add `{ keys: ['k'], modifier: 'primary', action: 'palette', data: true }` to the table, add `'palette'` to `ACTION_IDS`, and add a Help entry. Web: `PaletteHost` listens for `keydown` on `window` for `Meta+K` (macOS) or `Ctrl+K` (elsewhere) and calls `preventDefault()`. Because the shell stops handled presses from reaching the page, the two paths never both fire. The "menu accelerators" wording in the request does not apply as such; the shortcut table is the desktop equivalent.

**Rationale**: Reuses the one mechanism the project already tests in both directions. `data: true` gives the locked behavior for free on the desktop side.

**Alternatives considered**: a page-only listener in both shells (rejected: duplicates the shell's job and escapes the Help/shell consistency test); an Electron `globalShortcut` (rejected and out of scope: it would work while unfocused).

## R2. Where the entities come from

**Finding**: `useLedger().basics` holds accounts (with groups), categories, payees and tags in memory. It does not hold envelopes (budgets) or goals. The Plan screen reads them with `ledger.read('budgets.list')` and `ledger.read('goals.progress')`, which are local queries to the worker over the encrypted store.

**Decision**: Accounts from `basics` (no read). On open, the palette calls the two existing queries once and keeps the rows for that open (names and ids only are kept in component state, never stored). While they load, accounts and screens are already searchable and a polite status line says more results are loading; a failed read leaves the rest working.

**Rationale**: Honors "no new queries or network calls": these are existing local read-model queries, not new endpoints or events. Waiting is invisible in practice (local).

**Alternatives considered**: add envelopes and goals to `ledger.basics` (rejected: changes a hot path for every screen, and affects `core`); cache them in a context at app start (rejected: duplicates the Plan screen's data and goes stale); skip them (rejected: the spec requires them).

## R3. Deep links to an envelope or a goal

**Finding**: Accounts have a route (`/transactions/?account=<id>`). Envelopes and goals only have tabs of the Plan screen (`/plan/?view=budgets|goals`); there is no per-item page.

**Decision**: Navigate to the tab and add an `item=<id>` query. `BudgetsView` and `GoalsView` scroll the matching row into view and move focus to it once, then remove the parameter. This is the only change to those views. A missing id is ignored, so a deleted item never breaks the page (spec edge case).

**Rationale**: "Reach" an item should land on it, not just on its list. The parameter is a few lines per view and is covered by a test.

**Alternatives considered**: land on the tab only (rejected: with many goals this is not "reaching" the item); build item pages (rejected: out of scope).

## R4. Fuzzy matcher

**Finding**: `foldLetters` in `i18n/collation.ts` already folds case, accents (NFD without marks) and `ł`. It does not keep an index map, which highlighting needs.

**Decision**: A small in-house matcher in `palette/fuzzy.ts`: fold each character of the target while keeping its index in the original string, then match the query's characters as an ordered subsequence. Score rewards a prefix match, word-start matches, consecutive runs, and a shorter target; it penalizes gaps. Output: `{ score, ranges }` with ranges in original-string indices, merged. Reuse `foldLetters` for the character fold so the rules are the same as the rest of the app. Case: empty query matches everything with score 0.

**Rationale**: About 80 lines with unit tests, no dependency. Libraries such as fuse.js or fzf-for-js would add bundle weight and a supply-chain item (constitution VIII, IX) for something this small.

**Alternatives considered**: `fuse.js` (rejected: ~7 KB gzipped, approximate-string scoring that is hard to make accent-aware and index-accurate for highlights); `Intl.Collator` comparison only (rejected: no subsequence matching or highlights).

## R5. Where the history lives, and what it holds

**Finding**: `cashfold.ui` is one JSON object capped at 4 KB, device-wide, with an account-scoped part reset on sign-out (`resetAccountPrefs`, `forgetAccountScopedState` in `CoreProvider`). The app holds one account per device, and "use a different account" is the sign-out flow of spec 011, so whatever belongs to an account is cleared in that one place.

**Decision**: One key, `cashfold.palette`, holding `{ v: 1, items: [{ id, n, t }] }`: an entry id, a use count and a last-used time. At most 24 items, trimmed by lowest rank when full; the stored size is capped (about 2 KB) and a corrupt or oversized value is dropped, not repaired. Entry ids are opaque: `a:<id>`, `e:<id>`, `g:<id>` for entities, and `c:<commandId>` for screens and actions. `forgetAccountScopedState` also removes the key, so the history is deleted whenever the account leaves the device (sign-out, use a different account, removal from the device). The Settings control removes the same key and tells the palette to re-read.

**Rationale**: A separate key keeps the 4 KB prefs object small and makes deletion a one-line removal. Because the key carries no account id, no identifier is added to storage. Storing only ids, counts and times satisfies FR-011.

**Alternatives considered**: a field inside `cashfold.ui` (rejected: shares the 4 KB cap); a key per account (rejected: the app holds one account per device, so there is never a second history to keep); IndexedDB (rejected: heavier than needed); storing names for faster display (rejected: violates FR-011).

## R6. Recent and Frequent ranking

**Decision**: Recent = items by `t` descending, up to 5. Frequent = items by `n` descending, ties by `t`, up to 5, excluding any already in Recent. Both are filtered to entries that still exist and are currently available (a deleted or unavailable item is skipped, not shown). With no history the empty query shows the main screens and the most common actions. With a query, entries are ordered by match score; ties break by use count, then by type order (screens, actions, accounts, envelopes, goals).

**Rationale**: Simple, explainable, testable. Count and time are enough; no decay is needed at this size.

## R7. Dialog and accessibility pattern

**Finding**: The kit wraps Headless UI `Dialog` and `Combobox`. The palette needs grouped options, a live result count and an always-open list, which the existing `Combobox` (dropdown over a form field, virtual list) does not give.

**Decision**: Use the kit `Dialog` for the modal behavior (focus trap, inert page, Escape, focus return) and build the list as the standard ARIA combobox pattern: an `input role="combobox"` with `aria-expanded`, `aria-controls` and `aria-activedescendant`, and a `role="listbox"` of `role="option"` rows grouped with `role="group"` and a labelled heading. Focus stays in the input; arrows move `aria-activedescendant`. A visually hidden `role="status"` region announces "N results" after each change (debounced to the end of typing by 300 ms so it does not talk over the user). Reduced motion removes the open/close transition through the existing reduce-motion handling. Highlight uses `<mark>`-style weight plus underline, not color alone.

**Rationale**: Matches the product's existing pattern and the W3C combobox-with-listbox example; keeps axe checks the same as other dialogs.

**Alternatives considered**: reuse kit `Combobox` inside a dialog (rejected: it is built for a closed field with a dropdown); `cmdk` library (rejected: new dependency for something the kit already mostly provides).

## R8. Lock, cover and other dialogs

**Finding**: `AppShell` renders only when unlocked; lock unmounts the signed-in shell, closing every overlay without a prompt (see `OverlayHost.tsx`). While the privacy cover is up (`core.covered`), the portal layer is made inert but stays mounted. Help and the narrow drawer register with `subscribeOverlays`, and a desktop shortcut closes them first.

**Decision**: `PaletteHost` is mounted inside the unlocked shell only, so it does not exist while locked and unmounts with the lock. It also closes when `core.covered` becomes true, so names are not left under the cover. The palette registers with `subscribeOverlays`, so any other desktop shortcut (new transaction, settings) closes it, then runs. The `palette` action itself is the exception: it skips the close-first step and toggles the palette. The palette does not open when another modal is open: it checks for an open `[role="dialog"]` that is not its own and for the confirm/unsaved-changes guard, and otherwise does nothing.

**Rationale**: Gets FR-002, FR-018 and FR-019 without a new lock subscription. The existing spec-008 rule (shortcut closes Help first) is preserved for every other shortcut.

## R9. Actions and their confirmations

**Decision**: Each built-in command calls the same function its normal control calls, passed in through a `PaletteContext` that `PaletteHost` assembles from existing hooks (`useRouter`, `useCore().lock`, `useAddSheet().openAdd`, `useTheme`, the Help open signal): add transaction, lock now, switch theme (toggle light/dark exactly as the existing control resolves it), sign out / use a different account (opens the existing sign-out dialog of spec 011, which asks for its own confirmation; the app holds one account per device, so there is no separate switch flow, and the palette is a deliberate extra entry point beyond Settings and the lock screen), and Help and shortcuts (opens the Help dialog). A command is listed only if its `enabled(ctx)` is true. Navigation goes through the same `router.push` the sidebar uses. There is no navigation-time unsaved-changes guard in the app (the add form asks only when it is closed), and the palette never opens over the add form, so there is nothing to bypass.

**Rationale**: FR-005 requires no bypass of confirmations or guards; sharing the entry points guarantees it.

**Open detail resolved**: Help needs to be openable from outside the sidebar. `HelpItem` keeps its local state; a tiny `help-bus` (same shape as `palette-bus`) lets the palette ask it to open.

## R10. Help dialog in a browser

**Finding**: Spec 008 shows the shortcuts section only in the desktop app, because a browser had none. The palette shortcut works in a browser.

**Decision**: In a browser, the Help dialog shows a one-row shortcuts section with only the palette shortcut (⌘K on macOS, Ctrl+K elsewhere, decided by the platform string the page already reads). In the desktop app, it appears as another app shortcut in the existing list. The spec-008 rule "the browser has none of these shortcuts" is amended accordingly, and its test is updated.

**Rationale**: FR-021 requires the shortcut to be discoverable, and a browser person has no other way to find it.

## R11. Browser key conflicts

**Decision**: On web, `Ctrl+K` / `Cmd+K` is claimed only while the signed-in shell is mounted and the key event is not already prevented. Firefox and Chromium use Ctrl+K for "focus search bar" on some platforms; `preventDefault()` on a `keydown` reaches the page first in all supported browsers, so the page wins while focused. When the app is not focused or is locked, the browser keeps its own behavior.

**Rationale**: Matches FR-022. Documented in `docs/` so it is not a surprise.

## R12. Testing approach

**Decision**: Unit tests (Vitest) for the matcher (folding, ranges, ranking order, empty query), the registry (register/unregister, availability), history (caps, trimming, corrupt value, clear, account isolation), and ranking. A browser test (kit pattern, with axe) for roles, `aria-activedescendant`, announcements, focus trap, focus return, themes and reduced motion. A guard test for locked, covered and over-another-dialog. A desktop test that the shell table and Help list contain the palette entry on all three platforms (extends the existing test, no new mechanism). One Playwright flow for web and one for desktop: open, type, jump, lock with the palette open.
