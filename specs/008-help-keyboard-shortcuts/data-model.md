# Data Model: Help Shows the Keyboard Shortcuts

Nothing is stored, synced or sent. These are in-memory shapes.

## HelpShortcut (static list entry, `packages/platform`)
| Field | Meaning |
|---|---|
| `id` | Stable identifier, also the suffix of the message key for its plain name |
| `group` | `app` (the app's own) or `standard` (the "also works" group) |
| `action` | The action it performs: an `ActionId` for `app` entries; for `standard` entries one of the closed set `undo, redo, cut, copy, paste, select-all, zoom-in, zoom-out, zoom-reset, close, minimize, toggle-fullscreen, quit` (the shell's own names) |
| `keys` | Per system (`mac`, `other`): `{ modifiers: (ctrl\|alt\|shift\|primary)[]; key }` where `primary` is Command on macOS and Control elsewhere |
| `via` | Per system: `shell` (handled by the shell's table) or `system` (handled by the OS/Chromium) |
| `worksWhenLocked` | true only for Lock |

Rules: `id`s are unique; `app` entries cover exactly the shortcut-bearing members of `ActionId` (new transaction, lock, settings, search, five `go:*`, import, export); no `development` shortcut appears; every entry has a message key `help.shortcut.<id>` in all three catalogues.

## ChecklistStatus (derived, web)
`{ known: boolean; complete: boolean }` from Fold, account and transaction counts through the existing `checklistState`. Shared by the card and the dialog.

## HelpDialog state (UI)
`open: boolean`, owned by the Help item. Transitions: Help activated -> open; Escape / Close / getting-started button / app shortcut arrives (the drawer closes too) / lock -> closed. Focus returns to the Help item on every close except lock.
