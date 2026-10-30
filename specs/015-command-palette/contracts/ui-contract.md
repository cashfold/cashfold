# UI Contract: Command Palette

The interfaces other parts of the app, the desktop shell and the tests rely on.

## 1. Shortcut

| System | Keys | Handled by |
|--------|------|------------|
| macOS desktop | ⌘K | Shell table entry; sends action id `palette` |
| Windows / Linux desktop | Ctrl+K | Shell table entry; sends action id `palette` |
| Browser on macOS | ⌘K | Page `keydown` listener in the unlocked shell |
| Browser elsewhere | Ctrl+K | Page `keydown` listener in the unlocked shell |

- Shift or Alt with K does not match. Pressing the shortcut with the palette open closes it.
- Desktop table entry: `{ keys: ['k'], modifier: 'primary', shift: false, platforms: 'all', action: 'palette', data: true }`. `data: true` means it is ignored while locked.
- Platform package: `ACTION_IDS` gains `'palette'`; `HELP_SHORTCUTS` gains `app('palette', 'palette', primary('K'))`. The existing desktop test that compares the two lists in both directions must pass on macOS, Windows and Linux.
- The desktop page runs `palette` without first closing other overlays (see the dialog rules below); every other action keeps the close-first behavior of spec 008.

## 2. Registry (`palette/registry.ts`)

```text
type PaletteGroup = 'screen' | 'action'

interface PaletteContext {            // assembled by PaletteHost from existing hooks
  navigate(href: string): void        // the router push the sidebar uses
  openAdd(): void
  lock(): void
  toggleTheme(): void
  openSignOut(): void
  openHelp(): void
  accounts: number                    // for enabled() rules
  foldId: string | undefined
}

interface Command {
  id: string
  titleKey: string
  keywordKeys?: string[]
  group: PaletteGroup
  enabled?(ctx: PaletteContext): boolean
  run(ctx: PaletteContext): void
}

register(commands: Command[]): () => void      // returns an unregister function
list(ctx: PaletteContext): Command[]           // only enabled ones, in registration order
```

- A feature adds an action by calling `register` once; it never edits the palette.
- `run` must call the same function as the normal control and must not skip a confirmation.
- Duplicate ids are rejected.

## 3. Built-in commands

| Id | Group | Title (English) | Available when | Does |
|----|-------|-----------------|----------------|------|
| `go-overview` | screen | Overview | always | navigate `/overview/` |
| `go-transactions` | screen | Transactions | always | navigate `/transactions/` |
| `go-accounts` | screen | Accounts | always | navigate `/accounts/` |
| `go-plan` | screen | Plan | always | navigate `/plan/` |
| `go-schedules` | screen | Schedules | always | navigate `/plan/?view=schedules` |
| `go-settings` | screen | Settings | always | navigate `/settings/` |
| `go-devices` | screen | Devices and sync | always | navigate `/settings/sync/` |
| `go-data` | screen | Data (import, export, backup) | always | navigate `/settings/data/` |
| `go-appearance` | screen | Appearance | always | navigate `/settings/appearance/` |
| `add-transaction` | action | Add transaction | an account exists | `openAdd()` |
| `lock-now` | action | Lock now | always | `lock()` |
| `switch-theme` | action | Switch theme | always | `toggleTheme()` |
| `sign-out` | action | Sign out / use a different account | an account is signed in | `openSignOut()` (the spec-011 dialog; asks to confirm) |
| `help` | action | Help and shortcuts | always | `openHelp()` |

Screen ids and routes come from `shell/routes.ts` (`PRIMARY_SECTIONS`, `SETTINGS_GROUPS`) so a renamed route cannot drift. Desktop-only and install screens appear only where they exist.

## 4. Entity entries

| Type | Source | Navigates to |
|------|--------|--------------|
| account | `useLedger().basics.accounts` (archived accounts only if the Accounts screen shows them) | `/transactions/?account=<id>` |
| envelope | `ledger.read('budgets.list')` on open | `/plan/?view=budgets&item=<id>` |
| goal | `ledger.read('goals.progress')` on open | `/plan/?view=goals&item=<id>` |

- Only the Fold being viewed is read.
- `item=<id>`: `BudgetsView` and `GoalsView` scroll the row with that id into view, move focus to it once, and remove the parameter. An unknown id changes nothing.

## 5. Dialog and accessibility contract

- Container: kit `Dialog` with an accessible name ("Command palette"). Focus trap, inert background, Escape to close, focus returns to the opener unless the chosen action moved focus on purpose.
- Input: `role="combobox"`, `aria-expanded="true"`, `aria-controls` = the listbox id, `aria-activedescendant` = the highlighted option id, `aria-autocomplete="list"`, placeholder includes the shortcut written for the system.
- List: `role="listbox"`; groups are `role="group"` with `aria-labelledby` the heading; rows are `role="option"` with `aria-selected` on the highlighted one and an `aria-label` of "title, type" when the visible text alone is ambiguous.
- Live region: a visually hidden `role="status"` announces "N results" (or "No results") after the query settles; also announces "More results are loading" while entities load.
- Keys: Down/Up move (wrapping), Home/End jump, Enter runs, Escape closes, the shortcut again closes. No other key is captured; Tab stays in the dialog.
- Visuals: the selected row and the match highlight use weight and underline as well as color; the open/close transition is removed when reduced motion is on; colors come from the existing tokens, so the primary color and both themes apply.
- Limits: at most 20 rows are rendered; typing narrows the rest. Long titles truncate visually and keep the full text in the accessible name.

## 6. Guards

| Situation | Behavior |
|-----------|----------|
| App locked | `PaletteHost` is not mounted; the shortcut does nothing (browser: default browser behavior; desktop: ignored by `data: true`). |
| Lock happens with the palette open (button, idle, system event) | The shell unmounts; the palette and its state are gone. |
| Privacy cover shows (hidden or blurred window) | The palette closes. |
| Another modal dialog is open (confirm, unsaved changes, Help, add sheet) | The shortcut does nothing. |
| Another desktop shortcut pressed with the palette open | The palette closes, then that shortcut's action runs (spec 008 rule). |

## 7. History store (`palette/history.ts`)

```text
load(): HistoryItem[]
record(entryId): void                  // count + time; trims to 24
clear(): void                          // Settings control and account leaving the device
```

- Key `cashfold.palette` (one account per device); value format and rules in `data-model.md` §4.
- `CoreProvider.forgetAccountScopedState` also calls `clear`, which covers sign-out, using a different account and account removal.
- Settings → Data and storage: a "Clear palette history" button with a one-line description ("Forgets which places and actions you open most on this device. Your data is not touched.") that tells the person what was cleared.

## 8. Text

All new strings exist in `en.json`, `uk.json` and `pl.json` under `palette.*`: title, placeholder (with shortcut), group headings, type labels, empty state, result count (with plural forms), "more results are loading", command titles and keywords, Help row, Settings control and its confirmation, and the desktop shortcut name `help.shortcut.palette`. The existing messages test fails if a language is missing a key.
