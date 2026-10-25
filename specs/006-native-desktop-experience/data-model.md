# Data Model: A Native Desktop Experience

Nothing is added to the ledger, the event log, the relay or the web preferences. Everything below is device-local and lives in the desktop shell, or is derived or transient.

## Desktop preferences (stored in the shell's state file, beside the window bounds)

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `hideOnBlur` | boolean | `false` | When true the page covers its content as soon as the window loses focus, as the web app does. Read by the page at start and on change. |
| `startAtLogin` | boolean | `false` | When true the operating system starts the app after the person signs in; the app starts hidden and locked. Applying it can fail (permissions, Linux autostart folder): the stored value is the person's choice, and the section shows the result. |
| `closeBehavior` | `'quit' \| 'background'` | `'background'` on macOS, `'quit'` on Windows and Linux | `'background'` is refused (and stored as `'quit'`) where the capability report says no status item is available. |
| `theme` | `'system' \| 'light' \| 'dark'` | `'system'` | A mirror of the page's theme choice so the first frame has the right colours. The page is the source of truth and corrects it at start. |
| `window` | `{ x?, y?, width, height, maximized }` | existing | Unchanged. |

Validation: the state file is parsed field by field with defaults, as `desktop-state.ts` does today; unknown keys are dropped; a bad value falls back to its default without touching the rest. Requests to change a setting are strict schemas (`setSettings` takes a subset of the first four fields, nothing else).

## Capability report (derived, read-only, per run)

| Field | Meaning |
|-------|---------|
| `platform` | `'win32' \| 'darwin' \| 'linux'` |
| `lockEvents` | which of `screen-lock`, `suspend`, `idle-state` the system is expected to report |
| `badge` | whether a dock/taskbar count can be shown |
| `statusItem` | whether a tray or menu-bar item can be shown (decides if `closeBehavior: 'background'` is offered) |
| `jumpList` / `dockMenu` | whether the quick-action menus exist |
| `notifications` | `'granted' \| 'denied' \| 'unavailable'` as the system reports it |
| `translucency` | `'active' \| 'unavailable' \| 'reduced'` |
| `loginItem` | whether start at login can be set here |

Used by Settings → Desktop to say plainly what this computer can do (FR-005, FR-023) and by the page to decide what to offer.

## Waiting count (derived)

The number of entries returned by the existing `schedules.pending` query for the selected Fold, held in the page while unlocked, sent to the shell as an integer from 0 to 999. It is not stored anywhere. 0 whenever the app is locked.

## Quick action (closed set)

`show`, `add-transaction`, `lock`, `quit`, `open-fold:<index>` (index into the list of recent Folds the page last pushed, 0 to 4). Used by the tray, the dock menu and the jump list, and arriving as arguments of a second launch (`--action=add-transaction`, `--action=lock`).

## Recent Folds (transient, page to shell)

Up to 5 entries `{ id, name }` pushed only while unlocked, with names truncated to 40 characters. Cleared on lock, on a system lock event and on quit, and the OS-held menus (dock menu, jump list) are reset to tasks only at every start. Held in the shell's memory only; never written to a file by the shell (the jump list is the operating system's own store, hence the reset).

## Incoming item (transient, shell to page)

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `'csv' \| 'backup' \| 'link'` | |
| `name` | string | file name only, no directory; at most 120 characters |
| `bytes` | binary, present for `csv` and `backup` | CSV at most 16 MiB; backup at most 128 MiB; read by the shell with a descriptor from a regular file |
| `link` | `{ screen: 'add-device', email?, server? } \| { screen: 'open', target }` | after the strict grammar in [contracts/link-and-file-intake.md](contracts/link-and-file-intake.md) |
| state | `queued → delivered → confirmed \| dismissed` | held by the shell until the page reports `unlocked`; at most 8 queued; dropped on quit |

An item is never executed by the shell or the page on arrival: delivery only opens the matching screen for review.

## State transitions that matter

```text
session:   unlocked --(page lock | systemLock | idle | pagehide)--> locked
                      badge := 0, recent Folds := [], pending reminders stop
           locked   --(unlock)--> unlocked
                      queued intake items delivered; missed reminders summarised once

window:    shown <--> hidden (closeBehavior = background)      # the page and the session stay alive
           any --> quitting (Quit, before-quit)                # everything ends
```
