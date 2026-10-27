# Contract: Help dialog and the shortcut list

## UI contract
- Opened by the Help item (sidebar and drawer). Accessible name "Help"; labelled by its title. Modal: focus moves in, is trapped, the page is inert, Escape and a Close button close it, focus returns to the Help item.
- Sections in order: **Keyboard shortcuts** (desktop only) with groups "Shortcuts" and "Also works", then a note "While the app is locked only Lock works"; then **Getting started**: button "Show the getting-started card" while steps remain, otherwise the line saying setup is complete.
- Each shortcut row: plain name, then its keys in `kbd`; accessible text spells keys out ("Command, N").
- Browser: no Keyboard shortcuts section, no "locked" note.

## List contract (`packages/platform/help-shortcuts.ts`)
- Exports `HELP_SHORTCUTS` (readonly array of `HelpShortcut`, see data-model).
- Invariants checked by tests: unique ids; all shortcut-bearing `ActionId`s present exactly once; messages exist in en/uk/pl.

## Drift contract (`apps/desktop/src/main/help-shortcuts.test.ts`)
For each system (darwin, win32, linux):
1. For every list entry with `via: 'shell'`, building its key press and calling `matchShortcut` returns an entry with the same action (and for `app` entries the same `ActionId`).
2. For every non-development `SHORTCUTS` entry that applies on that system, every key it owns (for example both `+` and `=` for zoom in) returns that entry's action from `matchShortcut`, and some list entry has the same action for that system. Comparison is by action, modifier and system; alias keys need no list entry.
3. Entries with `via: 'system'` must be in the test's explicit allow-list (macOS quit; Windows/Linux undo, redo, cut, copy, paste, select all) with the reason stated.
4. Development-only entries are not listed.
Failure messages name the shortcut and the system. The e2e (`help.spec.ts`) presses every listed key on the running system and checks the effect.

## Shell contract
Unchanged. No new IPC channel, no new action id, no new shortcut.
