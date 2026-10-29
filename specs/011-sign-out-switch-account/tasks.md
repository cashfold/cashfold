---
description: "Task list for Sign Out and Switch Account"
---

# Tasks: Sign Out and Switch Account

**Input**: Design documents from `/specs/011-sign-out-switch-account/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sign-out.md, quickstart.md

**Tests**: Included. The constitution requires test-first work for core and worker code and Playwright coverage for every P1 and P2 story, and the spec requires the three catalogues to stay complete (FR-016), accessible dialogs (FR-016) and no residue (SC-003).

**Organization**: Grouped by user story. Message keys (in `apps/web/src/ui/i18n/messages/{en,uk,pl}.json`, parity enforced by `catalogue-complete.test.ts`) are all added once in T002, with the English text in `contracts/sign-out.md` §3 (28 keys, including `signout.lock.hint`).

**Implementation note (found in testing)**: with the service reachable, signing out must send pending changes first, not only offer to; otherwise the last change can be lost (a two-device test failed intermittently on exactly that). The confirmation does this on confirm, and treats a sync that did not finish like an unreachable service (view input `syncFailed`).

**Deviations from the task text**: (1) T018 does not drive a fake relay link that raises `DeviceRemoved`; the guard is unit-tested (T014) and the revoke-then-event path is covered end to end against the real relay (T030). (2) The shared-Fold sign-out case in T030 was not added as an end-to-end test (it needs two accounts and fingerprint checks); see `research.md`. (3) The view tests for the `local` and `locked` branches (T031, T040) were written together with the view (T026) and were green on arrival. (4) The `local` and `locked` dialog branches (T035, T042) were built with the dialog (T027). (5) The worker bundle budget was raised from 278 to 282 KiB after the two lazy-loads (see `scripts/check-bundle-size.mjs`). (6) T049, the hand walk-through, is left for a person.

**Test environment**: the web package has no DOM test environment. Component logic is therefore kept in small pure modules or components that take `t` as a prop (render with `renderToStaticMarkup`, as `apps/web/src/ui/shell/HelpDialog.test.tsx` does), and interactions are covered by Playwright. Worker behaviour is tested in a real browser through scenarios in `apps/web/src/adapters/sqlite-opfs/test-scenarios.ts`, run by `us1.browser.test.ts` with `pnpm --filter @cashfold/web test:browser` (run browser tests with `env -u ELECTRON_RUN_AS_NODE`).

**Stored values** (data-model.md): one transient marker, written first and removed last. Account-tied settings reset: `quickUnlock.enabled`, `kitReminderDismissed`, `lastBackupAtMs`, `backupNagDismissedAtMs`. Kept: `autoLockMinutes`, `hiddenGraceSeconds`, `quickUnlock.maxIdleMinutes`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 sign out of an account on a service, US2 sign out of a local-only account, US3 switch to another account, US4 use a different account from the lock screen

## Phase 1: Setup

- [X] T001 Read `apps/web/src/worker/app-handlers.ts` (`eraseEverything`, the `DeviceRemoved` branch of the sync `publish`, `status`, `account.delete` wiring), `apps/web/src/worker/core-worker.ts`, `apps/web/src/worker/account-handlers.ts`, `packages/core/src/identity/domain/device-settings.ts`, `packages/core/src/identity/application/delete-account.ts`, `apps/web/src/ui/prefs/{schema,store}.ts`, `apps/web/src/adapters/notifications/browser.ts`, `apps/web/src/adapters/keystore-idb/{idb,device-settings,quick-unlock-store}.ts`, `apps/web/src/ui/core/{CoreProvider,RequireUnlocked}.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/ui/auth/UnlockForm.tsx`, `apps/web/src/ui/settings/{ProfileSecurity,DataAndStorage}.tsx` and the `Dialog` in `apps/web/src/ui/kit/dialog.tsx`. Confirm each matches `research.md` R-1 (in particular that `eraseEverything` only destroys an open database, that `eraseLocalData` is never wired, and that a Web Worker has no `localStorage`); note any difference in `specs/011-sign-out-switch-account/research.md` before coding.

## Phase 2: Foundational (blocks all stories)

**Goal**: one tested erase that leaves nothing of the account, a worker call for each entry point, the `SignedOut` event, and the signed-out screen.

- [X] T002 [P] Add the 28 message keys from `contracts/sign-out.md` §3 (all `signout.*` and `signedout.*` keys, including `signout.lock.hint`) in English, Ukrainian and Polish in `apps/web/src/ui/i18n/messages/en.json`, `uk.json`, `pl.json`. Reuse the vocabulary of `signup.server.*` and `syncenable.*` in each language (the word for "service") and the existing words for Lock and Delete. Keep the plural forms of `signout.pending` in the ICU style the catalogue already uses. `catalogue-complete.test.ts` must pass.
- [X] T003 [P] Write failing tests in `packages/core/src/identity/domain/device-settings.test.ts` for a new `resetAccountTied(settings)`: it sets `quickUnlock.enabled` to false, `kitReminderDismissed` to false, `lastBackupAtMs` to 0 and `backupNagDismissedAtMs` to 0, and returns `autoLockMinutes`, `hiddenGraceSeconds` and `quickUnlock.maxIdleMinutes` unchanged, whatever they were.
- [X] T004 In `packages/core/src/identity/domain/device-settings.ts` implement and export `resetAccountTied(settings: DeviceSettings): DeviceSettings` per T003 (reuse `DEFAULT_SETTINGS` for the reset values). Make T003 pass.
- [X] T005 [P] Write failing tests in `apps/web/src/ui/prefs/reset-account.test.ts` for a new `resetAccountPrefs(prefs)`: it returns `recents` and `firstRun` as in `DEFAULT_PREFS` and keeps `theme`, `language`, `moreDetailsOpen`, `optionalFields`, `overview`, `plan`, `hints` and `lists` exactly as given.
- [X] T006 Create `apps/web/src/ui/prefs/reset-account.ts` exporting `resetAccountPrefs(prefs: Prefs): Prefs` per T005. Make T005 pass.
- [X] T007 [P] Extend `apps/web/src/adapters/notifications/notify.test.ts`: a new `forgetShownReminders(storage)` removes the `cashfold.reminders.shown` key from a `KeyValueStorage`, does nothing when it is absent, and never throws when the storage throws.
- [X] T008 In `apps/web/src/adapters/notifications/browser.ts` implement and export `forgetShownReminders(storage?: KeyValueStorage)` (default `window.localStorage`, absent while prerendered) per T007. Make T007 pass.
- [X] T009 In `packages/core/src/identity/ports/index.ts` add `PendingEraseMarkerPort` (`set(): Promise<void>`, `isSet(): Promise<boolean>`, `clear(): Promise<void>`) and `LocalEraserPort` (`eraseAll(): Promise<void>`, which must be safe to repeat and must not need an open database), each with a doc comment saying what it holds and that nothing in it is secret.
- [X] T010 [P] Write failing tests in `packages/core/src/identity/application/sign-out.test.ts` with fakes for the ports, following `delete-account.test.ts`:
  - `signOut`: the calls happen in this order, marker `set`, then `revokeThisDevice`, then `closeDatabase`, then `eraser.eraseAll`, then `afterErase` (which the worker uses to publish `SignedOut`), then marker `clear`, then `session.lock` last (locking ends the worker, so nothing may be left to do after it); the result is `{ ok: true, value: { deviceStillListed: false } }` when the device was removed, and `true` when `revokeThisDevice` returns false, throws, or does not answer within `timeLimitMs` (use fake timers; default 5000).
  - A stored `registration` of `local` or `pending` never calls `revokeThisDevice`, and gives `deviceStillListed: false`. `leaveService: false` skips it for a registered account too.
  - When `eraser.eraseAll` throws after the marker is set, the marker stays set, the error is rethrown, and `finishPendingErase` then runs the erase again, clears the marker, and a second `finishPendingErase` does nothing.
  - `signOutLocked({ email })`: a different address (trim and lower-case before comparing) returns `wrong_email` with no marker, no erase and no lock; the matching address erases without calling `revokeThisDevice`, and `deviceStillListed` is true only for a `done` account; no stored account returns `no_account`.
  - A locked session (`signOut` when the session is not unlocked) returns `locked` and changes nothing. With no stored account `signOut` returns `no_account` and changes nothing.
  - `signOutLocked` with no open database calls `closeDatabase` as a no-op and still erases.
  - Logger entries never contain the email.
- [X] T011 Create `packages/core/src/identity/application/sign-out.ts` with `signOut`, `signOutLocked` and `finishPendingErase` per T010 and `contracts/sign-out.md` §1 (deps: `marker`, `eraser`, `credentials`, `session`, `closeDatabase`, `afterErase?`, `revokeThisDevice?`, `timeLimitMs?`, `timers?`, `logger?`; error type `DomainError<'locked' | 'no_account' | 'wrong_email'>`; the order is the one in T010), and export it from `packages/core/src/index.ts`. Make T010 pass.
- [X] T012 [P] Write a failing browser test `apps/web/src/adapters/keystore-idb/pending-erase.browser.test.ts` (follow `credential-store.browser.test.ts`): `isSet` is false at first, true after `set`, false after `clear`; `set` twice is fine; the marker is stored under its own key in the `device` store and `credentials.load()` is unaffected by it.
- [X] T013 Create `apps/web/src/adapters/keystore-idb/pending-erase.ts` exporting `createIdbPendingErase(factory?: IDBFactory): PendingEraseMarkerPort`, storing `{ startedAtMs }` under the key `pending-erase` in the `device` store (no schema change). Make T012 pass.
- [X] T014 [P] Write failing tests in `apps/web/src/worker/sign-out-guard.test.ts` for a new `createSignOutGuard()`: `begin()` then `ignores('DeviceRemoved')` is true; other event types are never ignored; after `end()` nothing is ignored; `begin()` twice and `end()` once still ends it.
- [X] T015 Create `apps/web/src/worker/sign-out-guard.ts` per T014. Make T014 pass.
- [X] T016 [P] Write a failing browser test `apps/web/src/adapters/local-erase.browser.test.ts` for a new local eraser, using a real runtime (`loadRuntime`) with some files in the pool, credentials, a quick-unlock record and settings in IndexedDB: after `eraseAll()` the pool has no file; `credentials.load()` and the quick store are empty; settings equal `resetAccountTied` of what they were (lock policy kept); running it twice is fine; it needs no key and no open database.
- [X] T017 Create `apps/web/src/adapters/local-erase.ts` exporting `createLocalEraser(deps: { runtime: () => Promise<SqliteRuntime>; credentials: CredentialStorePort; quickStore: QuickUnlockStorePort; settings: DeviceSettingsPort }): LocalEraserPort`: unlink every file in `runtime.pool.getFileNames()` (the pool belongs to Cashfold alone; the caller has already closed the open database, and the test closes it before calling), clear credentials and quick unlock, then save `resetAccountTied(await settings.load())`. Make T016 pass.
- [X] T018 Write a failing real-browser scenario `signOut` in `apps/web/src/adapters/sqlite-opfs/test-scenarios.ts` with its test in `us1.browser.test.ts`, following the `localOnly` scenario (spec 010): with a fake `registration` and `relayAuth`, create an account with data, make a backup time and a dismissed kit reminder, then `account.signOut` and expect: `{ ok: true, value: { deviceStillListed: false } }`, `status` is `no_account`, the pool has no file, stored credentials and the marker are gone, settings keep the lock policy and lose the account-tied fields, and `sync.status` makes no further calls. Also: `account.signOutLocked` with a wrong email erases nothing and with the right one erases while locked (the pool is emptied although no database is open); a marker written by hand before building the handlers is finished by the first `status` call, which then reports `finishedSignOut: true`; and with a fake relay link that removes the device and then raises `DeviceRemoved`, there is no second erase and no `DeviceRemoved` event reaches `publish`. Also: `account.signOut` with no stored account returns `no_account` and changes nothing; the whole sign-out, run with an open session and a service that answers at once, finishes within 2 seconds; and with a hand-written marker, the **first call being `unlock`** (not `status`) finishes the erase and answers as for no account, so a call that arrives first never acts on a half-erased account.
- [X] T019 In `apps/web/src/worker/app-handlers.ts` add the dependencies `pendingErase: PendingEraseMarkerPort` and `localEraser: LocalEraserPort` to `AppHandlerDeps`, and: (1) handlers `account.signOut` (args `{ leaveService?: boolean }`) and `account.signOutLocked` (args `{ email: string }`) built on `signOut` from core, with `revokeThisDevice` calling the existing device manager's `revoke(thisDevice)` through the live sync link (it returns false when there is none); (2) a `createSignOutGuard()` that is begun for the duration of a sign-out, and makes the sync `publish` drop `DeviceRemoved` and skip its `eraseEverything` while it is on; (3) publish `{ type: 'SignedOut' }` through `afterErase`, before the marker is cleared and the session locked; (4) every handler, not only `status`, first awaits a shared `finishPendingErase` (wrap the handler table once, so no handler can run on a half-erased account), and `status` includes `finishedSignOut: true` when it had work to do; `closeDatabase` is the session's existing close step (`webSession.stop()`), which must be safe to run twice, and `afterErase` publishes `{ type: 'SignedOut' }`; (5) make `eraseEverything` use `localEraser.eraseAll()` so device removal and "Delete my account" erase fully too. Make T018 pass.
- [X] T020 In `apps/web/src/worker/core-worker.ts` pass `pendingErase: createIdbPendingErase()` and `localEraser: createLocalEraser({ runtime: () => loadRuntime(), credentials, quickStore, settings })` to `createAppHandlers`, reusing the stores it already creates.
- [X] T021 In `apps/web/src/ui/core/CoreProvider.tsx` handle the `SignedOut` event like `DeviceRemoved` but without `setRemoved`: phase `no_account`, account cleared, epoch bumped. On `SignedOut`, and whenever `status` reports `finishedSignOut`, call `prefsStore.update(resetAccountPrefs)` and `forgetShownReminders()`. Expose `signedOutNotice: { deviceStillListed: boolean } | undefined` and `dismissSignedOutNotice()` on the core value, set by the sign-out call's result (used by US3).
- [X] T022 [P] Create `apps/web/src/ui/auth/SignedOutChoices.tsx` exporting a presentational `SignedOutChoicesView({ t })` and a `SignedOutChoices` wrapper: a heading `signedout.title` and three links, `signedout.create` to `/sign-up/`, `signedout.signin` to `/add/` and `signedout.recover` to `/recover/`, and nothing that names the previous account. Add `SignedOutChoices.test.tsx` rendering the view with `renderToStaticMarkup`: the three links and their targets are present, and no email address appears.
- [X] T023 In `apps/web/src/ui/core/RequireUnlocked.tsx` (the `no_account` branch) and `apps/web/src/app/page.tsx` replace the single "Create account" link with `SignedOutChoices`, keeping the existing `data-testid="phase"` and `h1` behaviour of the home page. Depends on T022.

**Checkpoint**: `pnpm vitest run packages/core apps/web` and the browser tests are green; the app can be signed out through the worker and shows the signed-out screen, with nothing of the account left.

## Phase 3: User Story 1 - Sign out of an account that is also on a service (Priority: P1) 🎯 MVP

**Goal**: a person with a registered account can sign out from Settings, understands what will happen, and ends on the signed-out screen with nothing left on the device and the account intact elsewhere.

**Independent Test**: sign in with an account on the test relay, make a change, sign out, confirm nothing of the account is on the device, and the account is intact on a second device (spec User Story 1, SC-003, SC-005).

### Tests for User Story 1 (write first; they must fail)

- [X] T024 [P] [US1] Create `apps/web/src/ui/auth/sign-out-view.test.ts` for a pure `signOutView(input)` that decides what the dialog shows. `input` is `{ kind: 'service' | 'local', locked: boolean, email: string, typedEmail: string, pending: number, online: boolean, acceptLoss: boolean, lastBackupAtMs: number, working: boolean }`. Cases for a registered, unlocked account: the first block is `service` (erases this copy, account and other devices unaffected, how to come back); with `pending: 0` there is no sync section; with `pending: 3` it shows the count and a sync-now action; with `pending: 3` and `online: false` the confirm button needs `acceptLoss` and no email; with `pending: 0` the confirm button is enabled without an email; `working: true` disables everything; `cancelFocused` is always true. The cases for `kind: 'local'` and `locked: true` are added in T031 and T040.
- [X] T025 [P] [US1] Create `apps/web/src/ui/settings/SignOutSection.test.tsx` rendering a presentational `SignOutSectionView({ t, onOpen })` with `renderToStaticMarkup`: it has the heading `signout.title`, the sentence `signout.lede` that names Lock and Delete, and a button `signout.open`.

### Implementation for User Story 1

- [X] T026 [US1] Create `apps/web/src/ui/auth/sign-out-view.ts` with `signOutView` per T024 (pure, no React). Make T024 pass.
- [X] T027 [US1] Create `apps/web/src/ui/auth/SignOutDialog.tsx`: a kit `Dialog` driven by `signOutView`, taking `{ open, onClose, email, kind, locked }`. It reads `sync.status` for the pending count and connection (`useSyncStatus`), offers **Sync now** (`useSyncStatus().syncNow`, text `signout.pending.sync`), shows the explanations from `signout.*`, uses `autoFocus` on Cancel, calls `account.signOut` through `useCore().call` on confirm, then sets `core.signedOutNotice` from `deviceStillListed` and navigates to `/` with `router.replace`; a `no_account` result is treated like success (the device is already signed out). An error shows `signout.error.generic` in a `role="alert"`. Leave the `local` and `locked` branches for T035 and T042.
- [X] T028 [US1] Create `apps/web/src/ui/settings/SignOutSection.tsx` (the `SignOutSectionView` from T025 and a wrapper that owns the dialog's open state) and render it in `apps/web/src/ui/settings/ProfileSecurity.tsx` below the Emergency Kit section and above `AccountSection`. Make T025 pass.
- [X] T029 [US1] Create `e2e/fixtures/residue.ts` exporting `residue(page)`, which returns what the app has stored for the origin: the file names in the OPFS pool (`navigator.storage.getDirectory()`, recursively), the keys and counts of the three stores of the `cashfold-credentials` IndexedDB database, and the `localStorage` values of `cashfold.ui` (`recents`, `firstRun`) and `cashfold.reminders.shown`. Also export `expectNoResidue(page)`, which asserts no OPFS file, empty `device` and `quick` stores, `recents` empty, `firstRun.dismissed` false, no shown reminders, and `settings` with the account-tied fields at their defaults.
- [X] T030 [US1] Create `e2e/us11-sign-out.spec.ts` (follow `e2e/us10-local-only.spec.ts` and the relay setup of `e2e/us4-sync.spec.ts`; Chromium and Firefox, skip WebKit as the other specs do) with the User Story 1 tests: Settings → Profile and security has the section, distinct from Lock and Delete; the confirmation says what is erased and what is not, and Cancel has the focus; offline with one unsent change it shows the count and needs the extra tick; after **Sync now** and confirm the device shows the signed-out screen with three ways in; `expectNoResidue` passes; a second browser context that signs in with the account's Secret Key sees every record, including the change synced just before; that second device's list no longer shows the first as an active device; no "device was removed" notice appeared on the first (SC-003, SC-005, FR-009). Run axe on the confirmation. Also: with a second page open in the same context (as in `e2e/multitab.spec.ts`), signing out in one moves the other to the signed-out screen with no "device was removed" notice (FR-012); after sign-out the existing `leakScan` fixture, seeded with the account's email and Fold name, finds no plaintext in storage (the constitution's required leak scan); and an account that owns a shared Fold (follow `e2e/us7-sharing.spec.ts`) can sign out, after which the other member still sees the Fold, while an account that is only a member signs out the same way.

**Checkpoint**: a registered account can be signed out completely, from Settings, and the same account can be signed back in elsewhere.

## Phase 4: User Story 2 - Sign out of an account that exists only on this device (Priority: P1)

**Goal**: a local-only (or unregistered) account can be left deliberately: the only-copy warning, a backup first, a typed email, and no residue.

**Independent Test**: make a local-only account with data, start to sign out, see the warning and the backup offer, type the email, confirm, and find nothing left; restore the backup into a new account (spec User Story 2, SC-004).

### Tests for User Story 2 (write first; they must fail)

- [X] T031 [P] [US2] Extend `apps/web/src/ui/auth/sign-out-view.test.ts` for `kind: 'local'`, `locked: false`: the first block is `local` (`signout.local.only`, the only copy, before anything else); a backup action is shown with `?then=sign-out`; with `lastBackupAtMs: 0` it shows `signout.local.noBackup`, and with a time it shows `signout.local.lastBackup` and that time; the confirm button is disabled until `typedEmail` equals `email` after trimming and lower-casing, whether or not a backup exists; there is no sync section and no `acceptLoss` for a local account even when `pending` is 3.
- [X] T032 [P] [US2] Create `apps/web/src/ui/settings/sign-out-return.test.ts` for a pure `returnsToSignOut(search: string): boolean` that is true only for a query string with `then=sign-out` and false for anything else, including repeated or malformed values.

### Implementation for User Story 2

- [X] T033 [US2] Create `apps/web/src/ui/settings/sign-out-return.ts` per T032, and in `apps/web/src/ui/settings/DataAndStorage.tsx` show a link `signout.back` to `/settings/profile/` (where the section and dialog are) after a backup has been made, only when `returnsToSignOut(location.search)` is true. Make T032 pass.
- [X] T034 [US2] In `apps/web/src/ui/auth/sign-out-view.ts` add the `local` branch per T031. Make T031 pass.
- [X] T035 [US2] In `apps/web/src/ui/auth/SignOutDialog.tsx` render the `local` branch: `signout.local.only` first, the **Make a backup first** link (`signout.local.backup`, a `Link` to `/settings/data/?then=sign-out`), the last-backup line from `storage.status` (`lastBackupAtMs`), and the typed-email field (`signout.email.label` with the email, a `TextField`). Reopen the dialog when the person returns: `SignOutSection` opens it when `location.hash` is `#sign-out`, and the back link from T033 targets `/settings/profile/#sign-out`.
- [X] T036 [US2] Extend `e2e/us11-sign-out.spec.ts` with the User Story 2 tests: a local-only account (sign up with the keep-everything choice) shows the only-copy warning first; the confirm button stays disabled until the email is typed; **Make a backup first** leads to the backup tool, a backup is made, **Back to sign out** returns with the dialog open and the backup time shown, and the email is still required; confirming signs out, `expectNoResidue` passes and `leakScan` seeded with the email and an account name finds nothing; the backup restores into a new account and the data is back (SC-004, US2.5).

**Checkpoint**: a local-only account can be left safely; the data is recoverable only from the backup, and the person was told so.

## Phase 5: User Story 3 - Switch to another account (Priority: P1)

**Goal**: after signing out, the person creates a new account or signs in to another, sees nothing of the old one, and keeps their device preferences.

**Independent Test**: sign out of account A, create account B and, separately, sign in to an existing account C; confirm only that account's data shows, nothing from A is found on the device, and language and theme are unchanged (spec User Story 3, SC-002, SC-003).

### Tests for User Story 3 (write first; they must fail)

- [X] T037 [P] [US3] Extend `apps/web/src/ui/auth/SignedOutChoices.test.tsx`: with a notice `{ deviceStillListed: true }` the view shows `signout.listed` in a `role="status"`; without one, or with `deviceStillListed: false`, it shows nothing extra.

### Implementation for User Story 3

- [X] T038 [US3] In `apps/web/src/ui/auth/SignedOutChoices.tsx` render `signout.listed` when `core.signedOutNotice?.deviceStillListed` is true, with a dismiss button that calls `dismissSignedOutNotice()`; the notice also clears when the person starts any of the three ways in. Make T037 pass.
- [X] T039 [US3] Extend `e2e/us11-sign-out.spec.ts` with the User Story 3 tests: after signing out of A the three ways in work from the home page and from a gated page such as `/accounts/`; creating account B starts empty, shows its own Getting started card and Emergency Kit reminder, and no Fold, account, name or email of A appears anywhere; signing in to an existing account C with its Secret Key and password shows only C after sync; signing back in to A restores A with its data; the language chosen before sign-out (switch to Українська first) and the theme are unchanged afterwards; with the service stopped, signing out of a registered account still works and the signed-out screen shows the "may still be listed" message (FR-009).

**Checkpoint**: changing account works end to end, the reason for the request.

## Phase 6: User Story 4 - Use a different account from the lock screen (Priority: P2)

**Goal**: a locked device offers a way out that needs no password, with the same erasing confirmation and a typed email.

**Independent Test**: lock the app, choose "Use a different account", see that no password is asked, that a wrong email erases nothing, and that the right one signs out (spec User Story 4, FR-014).

### Tests for User Story 4 (write first; they must fail)

- [X] T040 [P] [US4] Extend `apps/web/src/ui/auth/sign-out-view.test.ts` for `locked: true`: for every kind the email is required and there is no password and no sync section; for `kind: 'service'` the first block names the account's email and says this copy will be erased; for `kind: 'local'` the first block is the only-copy warning, the backup button is replaced by `signout.lock.hint` linking back to the unlock form, and there is no `?then=sign-out` link (a backup cannot be made while locked).

### Implementation for User Story 4

- [X] T041 [US4] In `apps/web/src/ui/auth/sign-out-view.ts` add the `locked` rules per T040. Make T040 pass.
- [X] T042 [US4] In `apps/web/src/ui/auth/SignOutDialog.tsx` render the locked variant per `signOutView`, calling `account.signOutLocked` with the typed email instead of `account.signOut`; a `wrong_email` result shows `signout.error.wrong_email` and erases nothing. In `apps/web/src/ui/auth/UnlockForm.tsx` add a `signout.different` link under the password field that opens the dialog, using the stored account (`core.account.email`, and `kind` from its `registration`: `done` is `service`, anything else is `local`), and show `signout.different.lede`.
- [X] T043 [US4] Extend `e2e/us11-sign-out.spec.ts` with the User Story 4 tests: after Lock the unlock screen has "Use a different account"; its dialog has an email field and no password field; a wrong address shows the error and the account still unlocks afterwards with the password; for a local-only account it shows the only-copy warning and the unlock-first hint instead of a backup button; the right address signs out with `expectNoResidue`; for a registered account no request is sent to the relay.

**Checkpoint**: no one is stuck behind a password screen they cannot pass.

## Phase 7: Polish and cross-cutting

- [X] T044 [P] In `docs/privacy.md` add a short section "When you sign out": it erases this device's copy (the database, keys, credentials, quick unlock and unsent changes), removes the device from the service's device list when it can be reached, leaves the account, its data and other devices as they are, and sends nothing for the lock-screen path. Keep the exact-list style of the page (FR-018).
- [X] T045 [P] In `docs/threat-model.md` add a note for sign-out (spec 011): what it removes and what it keeps (preferences); the pending-erase marker and why every step is repeatable; the lock-screen path that needs only the typed email (anyone with the locked device can wipe it, as they could by clearing the browser's data, accepted); and that the worker, not the page, checks the address. Add the usual threat/mitigation table (a half-finished erase; a wipe by someone without the password; a stale device left on the service; residue in settings, preferences and reminders). The constitution requires this note for authentication changes.
- [X] T046 [P] Extend `e2e/us11-sign-out.spec.ts` for accessibility and language: axe on the confirmation (service, local, locked), the lock-screen link and the signed-out screen; keyboard only through the dialog (open, Tab to the email field and the buttons, Escape cancels, Cancel has the initial focus); the same flows in Українська and Polski with no raw message key visible (use the check from `e2e/us10-local-only.spec.ts`) (FR-016, SC-007).
- [X] T047 [P] Check `apps/desktop/src` and `apps/desktop/e2e` for anything that keeps account state outside the web storage (credentials, recent files tied to an account, a stored email) or assumes an account is present at start; expect none. Record the result in `specs/011-sign-out-switch-account/research.md`. Add the desktop sign-out check to `apps/desktop/e2e/` only if an existing spec already drives the unlocked app; otherwise leave it to T049.
- [X] T048 Run `pnpm verify`, `pnpm check:no-float`, `pnpm check:bundle`, `pnpm check:docs`, the browser tests (`env -u ELECTRON_RUN_AS_NODE pnpm --filter @cashfold/web test:browser`) and `pnpm test:e2e --workers=3` (one Playwright run at a time); fix what fails.
- [ ] T049 Walk through every row of `specs/011-sign-out-switch-account/quickstart.md` by hand on the web build and the desktop app, and tick each against the spec requirement it names. Record anything that differs.

## Dependencies and order

- **Phase 1 → Phase 2 → stories**. In Phase 2: T002, T003, T005, T007, T009, T010, T012, T014, T016 are independent test or interface tasks and can run in parallel; each is followed by its implementation (T003→T004, T005→T006, T007→T008, T010→T011 after T009, T012→T013, T014→T015, T016→T017 after T009). T018 needs T011, T013, T015 and T017; T019 makes it pass; T020 follows T019. T021 needs T006, T008 and T019. T022 can run any time after T002; T023 needs T022.
- **US1** needs Phase 2. Tests T024 and T025 first (parallel), then T026 → T027 → T028; T029 can start at any point in the phase; T030 last.
- **US2** needs T027 (the dialog) and T026. T031 and T032 in parallel, then T033, T034, T035, T036.
- **US3** needs T021 and T022. T037, then T038; T039 needs US1 and US2 to exist for its flows.
- **US4** needs T027. T040, then T041, T042, T043.
- **Polish** needs the stories it documents or tests. T044 to T047 can run in parallel; T048 and T049 last.

## Parallel examples

- Foundational start: T002, T003, T005, T007, T009, T010, T012, T014 and T016 together (eight different test or interface files).
- In US1: T024 and T025 together.
- In Polish: T044, T045, T046 and T047 together.

## Implementation strategy

- **MVP**: Phase 2 and User Story 1. It gives a registered account a real sign-out with a complete erase, and it is useful on its own because it is the case the request describes. Stop here, run T048, and ship if needed.
- **Then**: User Story 2 (a local-only account is only safe to leave with its warning), which should ship with the MVP if feature 010 is merged, because that feature creates accounts that can be left no other way. After that, User Story 3 (the end-to-end switch) and User Story 4 (lock screen).
- **Order inside Phase 2**: tested pure pieces first (settings reset, prefs reset, reminders, guard), then the use case, the adapters, the worker handlers and the real-browser scenario, then the event and the signed-out screen. Each task leaves the repository type-checking and the tests green.
- **Reviews**: this touches authentication and the sync session, so the pull request needs two reviewers and the threat-model note from T045. No cryptography, protocol or wire format changes, so no ADR. Commit text must follow the project rule (no attribution lines), as for feature 010.
