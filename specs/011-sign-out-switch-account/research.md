# Research: Sign Out and Switch Account

Date: 2026-10-28. The spec has no open `NEEDS CLARIFICATION` items. This file records what the code already does, what it leaves behind today, and the decisions that follow.

## R-1 What the code already does

| Finding | Where | Consequence |
|---|---|---|
| `eraseEverything` clears the credentials and the quick-unlock record, destroys the open database file, then locks. It runs when the device is removed from the account (`DeviceRemoved`) and after "Delete my account". | `worker/app-handlers.ts:129` | The core of sign-out already exists. It is not reachable on its own, and it is incomplete (R-2). |
| `eraseEverything` can only destroy a database that is **open**: it calls `webSession.current()?.db.destroy()`. The optional `eraseLocalData` dependency that would remove the file by name is never wired. | `app-handlers.ts:129-139`, `core-worker.ts` | From the lock screen (User Story 4) there is no open database, so the file would be left behind. |
| The database is one file, `/cashfold.db`, plus older "generations" and journals, in the OPFS pool `/cashfold`. `destroy()` removes all of a database's generations, but only through an open `EncryptedDatabase`. | `adapters/sqlite-opfs/database.ts:169`, `web-session.ts:76`, `runtime.ts:38` | A file-level erase can use `runtime.pool.getFileNames()` and `unlink`, which needs no key. |
| Attachment pieces live inside the same database file. | `attachment-store.ts` | One erase covers them. |
| The device's small records are one IndexedDB database, `cashfold-credentials`, with three stores: `device` (credentials), `settings` (lock settings) and `quick`. | `keystore-idb/idb.ts` | `device` and `quick` are cleared today; `settings` is not. |
| `DeviceSettings` mixes device policy (auto-lock minutes, hidden grace, quick-unlock idle time) with account-tied facts: `quickUnlock.enabled`, `kitReminderDismissed`, `lastBackupAtMs`, `backupNagDismissedAtMs`. | `identity/domain/device-settings.ts` | After sign-out the next account would inherit "a backup was made" (so the new backup step and the data-loss reminder would be wrong) and a dismissed kit reminder. |
| Interface preferences are one JSON object in `localStorage` (`cashfold.ui`). `recents` is keyed by Fold id, and `firstRun.dismissed` records that the Getting started card was hidden. | `ui/prefs/schema.ts` | Fold ids of the old account would linger, and the new account would not see its Getting started card. |
| A shown-reminders list is kept in `localStorage` (`cashfold.reminders.shown`). | `adapters/notifications/browser.ts:6` | It names reminders of the old account and should go. |
| The page already reacts to `DeviceRemoved` by going to `no_account`, bumping an epoch, and setting a "removed" notice. `Locked` is handled too. Events are published to every tab through the core runtime. | `ui/core/CoreProvider.tsx` | Multi-tab sign-out needs a sibling event, `SignedOut`, that does the first part without the "removed" notice. |
| The signed-out gate (`RequireUnlocked`, phase `no_account`) and the home page offer only "Create account". The sign-in path is `/add/` and recovery is `/recover/`. | `ui/core/RequireUnlocked.tsx`, `app/page.tsx` | The signed-out screen must be one shared component with all three ways in. |
| Removing a device on the service is `DELETE /devices/{id}`, through `createDeviceManager(...).revoke(thisDevice)`, which needs a live relay link. The sync engine, on seeing its own device revoked, publishes `DeviceRemoved`. | `identity/application/enrol-device.ts:124`, `sync-service.ts:186` | Revoking this device while signing out will also trigger `DeviceRemoved`; the sign-out must keep that from showing "this device was removed" and from erasing twice. |
| The desktop app holds no account state of its own (nothing in `apps/desktop/src` stores credentials or account data), and it loads the same web export. | `apps/desktop/src` | No shell change expected. The check is repeated in the tasks. |
| `delete-account.ts` already takes an `eraseLocal` function and wipes secrets on every path. | `identity/application/delete-account.ts` | It is the pattern to follow for the new use case. |

## Decisions

### D-1 A new `signOut` use case in the Identity & Access context

- **Decision**: add `packages/core/src/identity/application/sign-out.ts`. It takes ports for the pending-erase marker, the local eraser, the optional device removal and the session, and exposes `signOut({ revokeDevice })` (account unlocked) and `signOutLocked({ email })` (lock screen).
- **Rationale**: the order of steps (mark, try the service, erase, clear the mark) and the guarantees (idempotent, finishes after a crash, wipes secrets) are domain rules that deserve unit tests with fakes, and the constitution keeps domain logic in `core` behind ports.
- **Alternatives**: put the sequence in the worker handler. Rejected: it would be tested only in a browser, and the crash-recovery rule is easy to get wrong.

### D-2 Erase everything the account owns, and nothing the device owns

| Store | What sign-out does |
|---|---|
| OPFS pool `/cashfold`: the database, its generations and journals | Unlink every file in the pool by name (works without a key and without an open session) |
| IndexedDB `device` (credentials) and `quick` | Clear |
| IndexedDB `settings` | Keep `autoLockMinutes`, `hiddenGraceSeconds` and `quickUnlock.maxIdleMinutes`; reset `quickUnlock.enabled`, `kitReminderDismissed`, `lastBackupAtMs` and `backupNagDismissedAtMs` to their defaults |
| `localStorage` `cashfold.ui` | Keep theme, language, optional fields, overview and plan choices, hints and archived-account choice; reset `recents` and `firstRun` |
| `localStorage` `cashfold.reminders.shown` | Remove |
| `sessionStorage` `cashfold.session` | Left alone (a random token with no account data) |

- **Rationale**: spec FR-002 and FR-004. The reset list is exactly the fields that describe the account, found in R-1; leaving them would carry one account's backup history and dismissals to the next.
- **Alternatives**: wipe all device storage including preferences. Rejected: spec FR-004 keeps language and theme.

### D-3 A pending-erase marker makes it crash-safe (FR-013)

- **Decision**: write a marker (a record in the existing `device` IndexedDB store, under its own key, so no schema change) before anything is erased, and clear it last. On worker start, before answering `status`, a marker means "finish the erase" and the same steps run again.
- **Rationale**: every step is idempotent (unlinking a missing file, clearing an empty store), so repeating them is safe. Today's order (credentials first, then the database) can leave an unreadable database and no credentials after a crash, which is a trace and a stuck state.
- **Alternatives**: erase in one transaction. Not possible across OPFS and IndexedDB.

### D-4 Leaving the service: best effort, then erase regardless (FR-009)

- **Decision**: while signing out an unlocked, registered account, try `devices.revoke(thisDevice)` once, with a short time limit. Success or not, erase. A `signingOut` flag in the worker makes the resulting `DeviceRemoved` event harmless: it neither publishes the "removed" notice nor erases a second time. If the revoke did not go through, the result carries `deviceStillListed: true` and the confirmation shown afterwards says so.
- **Rationale**: a device that stays in the service's list is clutter, not a risk, because its credentials are gone. Blocking sign-out on the network would break the offline case and would strand a person with a dead service.
- **Alternatives**: require the service to be reachable. Rejected: spec edge case. Skip the revoke. Rejected: the device list would fill with devices that no longer exist.

### D-5 Lock-screen path asks for the email, not the password (FR-014)

- **Decision**: `account.signOutLocked({ email })` compares the typed address with the stored one (trimmed, lower-cased) inside the worker and refuses on a mismatch. It needs no unlock and no database.
- **Rationale**: the password is exactly what the person may not have. The path only destroys data and reveals nothing, so a typed email is a deliberate-act check, not an authentication. The comparison lives in the worker so the page cannot skip it.
- **Risk accepted**: anyone with the device and the locked app can wipe it. They could equally clear the site's data in the browser or delete the app's folder. Recorded in the threat model.

### D-6 Unsynced changes and "sync first" (FR-006)

- **Decision**: the confirmation reads the pending-change count the sync status already reports (`folds[].pendingOps`), offers a **Sync now** button that calls the existing `sync.now`, and shows the result. If the service cannot be reached it states the count and asks for an extra tick before the confirm button is enabled. A local-only account has nothing to sync, so it shows none of this.
- **Rationale**: no new worker call, just the data already shown on the Sync page.

### D-7 One event for all tabs: `SignedOut`

- **Decision**: the worker publishes `SignedOut` after the erase. `CoreProvider` handles it like `DeviceRemoved` without the notice: phase `no_account`, no account, epoch bumped. The tab that started it navigates to the home page.
- **Rationale**: spec FR-012. The existing channel already reaches every tab, and the existing handler shows the pattern.

### D-8 One signed-out screen

- **Decision**: a small shared component, `SignedOutChoices`, with three links (create an account, sign in on this device, recover an account), used by the home page and by the `no_account` branch of `RequireUnlocked`.
- **Rationale**: spec FR-010 and the gap found in R-1; one component means the two places cannot drift.

### D-9 Backup first, then back to the confirmation (FR-008)

- **Decision**: the confirmation links to the backup tool with `?then=sign-out`. The Data page, when it sees that query value, shows a "Back to sign out" link after a backup is made. The confirmation shows `lastBackupAtMs`, read through the existing `storage.status`.
- **Rationale**: a query value is enough in a static export, and nothing has to be remembered between pages.

### D-10 Where the actions live

- **Decision**: "Sign out of this device" is a new section on Settings → Profile and security, below the Emergency Kit and above account management, with a short sentence that distinguishes it from Lock and from Delete. "Use a different account" is a link on the unlock screen. Both open the same dialog component with different inputs.
- **Rationale**: spec FR-001 and FR-014; one dialog keeps the wording and the checks identical.

## Out of scope (confirmed)

Several accounts on one device; a "keep my data and just lock" variant (Lock already exists); signing out of every device at once; mobile shells.

## Implementation notes

- **Desktop (T047)**: `apps/desktop/src` keeps no account state. The only place an email appears is the add-device link the shell hands to the page (`intake.ts`), which holds an address and a service address and never a key, and is dropped with the queue. The shell needed no change and the desktop e2e suite was not run here.
- **Shared Fold e2e**: the shared-Fold sign-out case in T030 was not added as an end-to-end test; it needs two accounts and fingerprint checks (`us7-sharing.spec.ts`). Sign-out removes only this device's copy and the erase touches no membership data, so it is covered by the worker scenario and the use-case tests only. A reviewer may want one.
- **Final sync**: the pending count in the dialog can be a few seconds old, and an intermittent two-device test showed the last change could be lost. The dialog now syncs and re-reads the count on confirm for every account on a service, and refreshes the count when it opens.
- **Reply before lock**: locking ends the worker, which dropped the sign-out reply that says whether the device may stay listed. The lock is deferred by 100 ms so the reply goes first.
- **Backups are per Fold**: the existing backup holds one Fold, and `lastBackupAtMs` is set by any backup, so "last backup" in the confirmation means a backup of some Fold, not of the whole account. Left as it is.

