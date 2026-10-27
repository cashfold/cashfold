# Data Model: Installable Web App (PWA)

Nothing is stored, synchronised or sent. These are small in-memory state machines in the page. Spec entities: Install state, Update state, Connection state, App shortcut.

## InstallState (`ui/pwa/install-state.ts`)

| State | Meaning | Section shows |
|---|---|---|
| `unknown` | Before the first answer (the first moments of a visit; it becomes `unavailable` after 2 seconds with no install event, and a later event still makes it `promptable`). | Nothing. |
| `promptable` | Chromium gave a deferred install event. | An Install button. |
| `steps` | Installable by hand; has `kind`: `ios-safari`, `ios-other`, `mac-safari`. | The steps for `kind`, in the person's language. |
| `installed` | Running as an installed app (own window). | Nothing: the group is hidden (clarified 2026-10-27). |
| `installed-in-tab` | `appinstalled` fired while this browser tab is open. | One line confirming it is installed, until the tab is closed. |
| `unavailable` | The browser cannot install the app, or this is the desktop app. | Nothing; the group is hidden. |

Transitions: `unknown -> promptable | steps | installed | unavailable`; `promptable -> installed` (accepted, or `appinstalled`); `promptable -> unavailable` after a decline until a new event arrives; `* -> installed` on `appinstalled` or when `display-mode: standalone` matches.

Validation: the deferred event is used at most once; `prompt()` is called only from a person's press.

## UpdateState (`sw/update-state.ts`)

| State | Meaning | UI |
|---|---|---|
| `idle` | No update known. | Nothing. |
| `ready` | A worker is installed and waiting; has `version`. | The quiet notice with Update and Dismiss. |
| `dismissed` | The person dismissed this `version`. | Nothing until the app is next opened. |
| `blocked` | Update pressed with unsaved input. | The notice says to save or discard first. |
| `applying` | `SKIP_WAITING` sent. | The notice says it is restarting. |
| `restarting-elsewhere` | Another tab switched; this tab must leave the old version. | "Cashfold was updated. Restart to continue", then an automatic restart once clean. |
| `failed` | A new worker could not install. | Nothing shown; the old version keeps working; retried at the next check. |

Events: `waiting-found(version)`, `dismiss`, `apply`, `unsaved-found`, `unsaved-cleared`, `controller-changed(own)`, `install-failed`. Rules: `dismiss` is per version and per page life; `controller-changed` with `own = false` always leads to `restarting-elsewhere`; `apply` never reloads while the unsaved-input check reports input.

## UnsavedInput (`ui/pwa/unsaved-input.ts`)

A pure function over a document: `true` when any form control differs from its default value. Password fields are ignored, so typing a password never delays the restart of a locked window. The add sheet's fields are covered by the same scan. No stored state.

## ConnectionState

Existing: the sync indicator's state (online, offline, waiting). Not changed; tests read it.

## AppShortcut (manifest member)

`{ name, short_name, url, icons? }`: New transaction, Overview, Transactions, Accounts, Plan, Settings. URLs are relative to the scope and carry no data.
