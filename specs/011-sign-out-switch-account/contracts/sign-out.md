# Contract: Sign Out (page ↔ worker, and screen copy)

The relay API is unchanged: the only request involved is the existing `DELETE /devices/{id}` that "remove this device" already uses, and nothing in `packages/protocol` or `sync-api.openapi.yaml` changes. This file covers the calls between the page and the core worker, the event, and the strings.

## 1. Worker calls

### `account.signOut` (unlocked)

|              |                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| args         | `{ leaveService?: boolean }`. `leaveService` defaults to `true` and is ignored for an account with no service                                                                                                                                                                                                                                             |
| precondition | The app is unlocked. Otherwise the call fails with `locked`. With no account on the device it fails with `no_account` and changes nothing (the page then just shows the signed-out screen, as when the device was already removed from another device)                                                                                                    |
| effect       | 1. Write the pending-erase marker. 2. If the account is registered and `leaveService` is true, try to remove this device from the service, once, with a short time limit. 3. Close the open database. 4. Erase everything in `data-model.md`. 5. Publish `SignedOut`. 6. Remove the marker. 7. Lock the session, which wipes the keys and ends the worker |
| ok result    | `{ ok: true, value: { deviceStillListed: boolean } }`                                                                                                                                                                                                                                                                                                     |
| errors       | `locked`, `no_account`. Nothing else is reported: a failure to reach the service is not an error, it sets `deviceStillListed`                                                                                                                                                                                                                             |
| guarantees   | Idempotent. If the call is cut short, the next start finishes it. Secrets are wiped on every path. No email, key or data reaches the log                                                                                                                                                                                                                  |

### `account.signOutLocked` (lock screen)

|              |                                                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| args         | `{ email: string }`                                                                                                                                                                                                                      |
| precondition | An account exists on the device. It may be locked or unlocked                                                                                                                                                                            |
| effect       | The typed address is trimmed and lower-cased and compared with the stored one. On a match, steps 1 and 3 to 7 above run (no service is contacted, because there is no session to do it with; with no open database, step 3 does nothing) |
| ok result    | `{ ok: true, value: { deviceStillListed: boolean } }`, with `deviceStillListed` true for an account that was registered with a service                                                                                                   |
| errors       | `no_account`; `wrong_email` (nothing is erased)                                                                                                                                                                                          |

### `status` (changed)

Before it answers, it finishes a pending erase if a marker exists, and reports `finishedSignOut: true` when it had to. So does **every other call**: the worker finishes a pending erase before it runs any handler, so a call that arrives first (an unlock from a second tab, say) can never act on a half-erased account. A device that was signed out answers `{ phase: 'no_account' }`.

### `sync.status` and `storage.status` (unchanged)

The confirmation reads the pending-change count from `sync.status` (`folds[].pendingOps`) and the last backup time from `storage.status` (`lastBackupAtMs`). **Sync now** calls the existing `sync.now`. On confirm, when the service is reachable and changes are pending, the page calls `sync.now` itself and re-reads `sync.status` before it calls `account.signOut`; if changes are still pending it does not erase, and shows the unreachable-service warning with its extra tick instead.

### Event `SignedOut`

Published to every tab after the erase. A tab that receives it sets its phase to `no_account`, clears the account, and bumps its epoch, as it does for `DeviceRemoved`, but shows no "device was removed" notice. While a sign-out is running, the worker does not publish `DeviceRemoved` and does not erase a second time.

## 2. Screen behaviour (testable)

| Screen                                      | Condition                     | Required behaviour                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings → Profile and security             | An account is on the device   | A "Sign out of this device" section with one sentence that says it is not Lock and not Delete, and a button that opens the confirmation                                                                                                                                                       |
| Confirmation                                | Registered account            | States what is erased and what is not, and how to sign back in; shows the pending-change count and **Sync now** when there are changes; with the service unreachable and changes pending, an extra tick enables the button; Cancel is the default focus                                       |
| Confirmation                                | Local-only or pending account | First sentence says this is the only copy and signing out erases it for good; **Make a backup first**; shows when the last backup was made, or that there is none; the confirm button stays disabled until the account's email address is typed                                               |
| Unlock screen                               | An account exists             | A "Use a different account" link opens the same confirmation, with the email field required for every kind of account and no password field. For an account with no service the "Make a backup first" button is replaced by the hint `signout.lock.hint`, which links back to the unlock form |
| Backup page                                 | Opened with `?then=sign-out`  | After a backup is made, a "Back to sign out" link to `/settings/profile/#sign-out` returns to the confirmation, which opens when it finds that hash                                                                                                                                           |
| Signed-out screen (home and any gated page) | No account                    | Three links: create an account, sign in on this device, recover an account; nothing from the previous account                                                                                                                                                                                 |
| After sign-out                              | `deviceStillListed` is true   | A short message on the signed-out screen says the device may stay listed under the account until it is removed from another device                                                                                                                                                            |
| Every tab or window                         | Account signed out elsewhere  | Moves to the signed-out screen                                                                                                                                                                                                                                                                |

## 3. New message keys

Each key must exist in `en.json`, `uk.json` and `pl.json` (`catalogue-complete.test.ts` enforces this).

| Key                         | English                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signout.title`             | Sign out of this device                                                                                                                          |
| `signout.lede`              | Removes this account from this device. It is not Lock, which keeps the account here, and it is not Delete, which removes the account everywhere. |
| `signout.open`              | Sign out                                                                                                                                         |
| `signout.dialog.title`      | Sign out of this device?                                                                                                                         |
| `signout.service.erases`    | This device's copy of the account will be erased. Your account, its data and your other devices are not affected.                                |
| `signout.service.back`      | To use this account here again, add this device with your Secret Key and password.                                                               |
| `signout.local.only`        | This is the only copy of this account. Signing out erases it for good.                                                                           |
| `signout.local.backup`      | Make a backup first                                                                                                                              |
| `signout.lock.hint`         | You cannot make a backup while the app is locked. If you remember your password, unlock first and make a backup.                                 |
| `signout.local.lastBackup`  | Last backup: {date}                                                                                                                              |
| `signout.local.noBackup`    | You have not made a backup.                                                                                                                      |
| `signout.pending`           | {count, plural, one {# change has} other {# changes have}} not reached the service yet.                                                          |
| `signout.pending.sync`      | Sync now                                                                                                                                         |
| `signout.pending.offline`   | The service cannot be reached, so those changes will be lost.                                                                                    |
| `signout.pending.accept`    | Sign out anyway and lose those changes                                                                                                           |
| `signout.email.label`       | Type {email} to confirm                                                                                                                          |
| `signout.confirm`           | Sign out and erase this device's copy                                                                                                            |
| `signout.working`           | Signing out…                                                                                                                                     |
| `signout.error.generic`     | That did not work. Try again.                                                                                                                    |
| `signout.error.wrong_email` | That is not the email address of this account.                                                                                                   |
| `signout.listed`            | This device may still be listed under your account. Remove it from another device to tidy the list.                                              |
| `signout.different`         | Use a different account                                                                                                                          |
| `signout.different.lede`    | This erases this device's copy of the account for {email}.                                                                                       |
| `signedout.title`           | You are signed out                                                                                                                               |
| `signedout.create`          | Create an account                                                                                                                                |
| `signedout.signin`          | Sign in on this device                                                                                                                           |
| `signedout.recover`         | Recover an account                                                                                                                               |
| `signout.back`              | Back to sign out                                                                                                                                 |

Existing keys reused: `ledger.cancel`, `loading`, `gate.createAccount`, `storage.backup.link`.
