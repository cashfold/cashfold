# Contract: page and worker

Existing, unchanged: the worker accepts `{ type: 'SKIP_WAITING' }` from the page only; it handles `GET` of its own origin's known files only (no API, no other origin, no user data).

Added (page side only):

| Trigger | Page does |
|---|---|
| `registration.waiting` found or `updatefound` reaches `installed` with a controller present | `UpdateState: waiting-found(version)`; the version is the worker's script hash from the existing precache manifest (`/precache-manifest.json`), read for display only. |
| `visibilitychange` to visible, `online`, and every 60 minutes | `registration.update()`; errors are ignored (offline is normal). |
| Update pressed | If `unsaved-input` is clean, post `SKIP_WAITING`, state `applying`; else state `blocked`. |
| `controllerchange` | If this tab posted `SKIP_WAITING`, reload once; otherwise state `restarting-elsewhere` and reload once the page holds no unsaved input. A tab that has never had a controller does nothing. |
| Install of a new worker fails | State `failed`; no notice. |

Not added: no new worker message types, no change to what the worker caches or serves, no use of `BroadcastChannel` (the browser already notifies every tab of `controllerchange`).
