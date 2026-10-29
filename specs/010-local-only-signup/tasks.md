---

description: "Task list for Local-Only Sign-Up"
---

# Tasks: Local-Only Sign-Up

**Input**: Design documents from `/specs/010-local-only-signup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/local-only-account.md, quickstart.md

**Tests**: Included. The constitution requires test-first work for core and worker code and Playwright coverage for every P1 and P2 story, and the spec requires the three catalogues to stay complete (FR-014) and accessible screens (FR-015).

**Organization**: Grouped by user story. Message keys (in `apps/web/src/ui/i18n/messages/{en,uk,pl}.json`, parity enforced by `catalogue-complete.test.ts`) are all added once in T004: `signup.local.label`, `signup.local.hint`, `signup.email.localHint`, `secretkey.local`, `kit.doc.local`, `sync.state.local_only`, `synclocal.title`, `synclocal.lede`, `synclocal.backup`, `sharing.relayNeeded`, `sharing.relayNeeded.link`, `firstrun.step.backup`. English wording is in `contracts/local-only-account.md` §3.

**Implementation note**: the web package has no DOM test environment, so tasks that said to test a component (T008, T016, T017, T018, T021) were done as pure-function or static-markup unit tests plus Playwright coverage in `e2e/us10-local-only.spec.ts`; the worker tests (T006, T007, T033) are one real-browser scenario, `localOnly`, in `apps/web/src/adapters/sqlite-opfs/`. T044 (the hand walk-through) is left for a person.

**Stored value** (data-model.md): `DeviceCredentials.registration` is `'pending' | 'done' | 'local'`. For `local`, `server` is `''` and is never read.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 create without a relay, US2 know the device is on its own, US3 connect later, US4 builds with a default relay

## Phase 1: Setup

- [X] T001 Read `packages/core/src/identity/application/create-account.ts`, `register-existing.ts`, `apps/web/src/worker/app-handlers.ts` (`createAccount`, `startSync`, `sync.enable`, `sync.status`, `storage.status`), `apps/web/src/worker/sync-service.ts` (`start`), `apps/web/src/ui/auth/SignUpForm.tsx`, `SecretKeyScreen.tsx`, `apps/web/src/ui/settings/SyncSection.tsx`, `apps/web/src/ui/sync/SyncIndicator.tsx`, `apps/web/src/ui/firstrun/checklist.ts` and `checklist-status.ts`, and `apps/web/src/ui/shell/HelpDialog.tsx`. Confirm each matches the plan's assumptions (in particular that `registerExisting` only refuses `registration === 'done'`, and that `HelpDialog` reads the shared checklist status). Note any difference in `specs/010-local-only-signup/research.md` before coding.

## Phase 2: Foundational (blocks all stories)

**Goal**: the new stored value exists in every type that carries it, and all new text exists in three languages.

- [X] T002 [P] In `packages/core/src/identity/ports/index.ts` widen `DeviceCredentials.registration` to `'pending' | 'done' | 'local'` and document that `local` means `server === ''` and the server is never read. Run `pnpm typecheck` and list every error it raises in the T003 files; do not fix them here.
- [X] T003 [P] Widen the same union to include `'local'` in `apps/web/src/ui/core/CoreProvider.tsx` (`AccountInfo.registration` and the `status` call's result type), `apps/web/src/ui/auth/SecretKeyScreen.tsx` (`CreatedAccount.registration`), `apps/web/src/ui/sync/useSyncStatus.ts` (`SyncView.registration`), and in `apps/web/src/worker/sync-service.ts` the `registration` parameter of `start` (the existing `reg !== 'done'` branch already keeps a `local` account from connecting; add no new behaviour) and in `apps/web/src/worker/app-handlers.ts` the `startSync` parameter. After T002 and this task, `pnpm typecheck` must pass.
- [X] T004 [P] Add the 12 message keys listed above, with the English text from `contracts/local-only-account.md` §3, in English, Ukrainian and Polish in `apps/web/src/ui/i18n/messages/en.json`, `uk.json`, `pl.json`. Reuse the vocabulary already used by `signup.server.*` and `syncenable.*` in each language (the word for "service"). Keep the existing key order convention. `catalogue-complete.test.ts` must pass.

**Checkpoint**: types compile; keys exist in all three languages.

## Phase 3: User Story 1 - Create an account without a relay (Priority: P1) 🎯 MVP

**Goal**: sign-up works with no address: the account, Secret Key, Emergency Kit and first Fold are created, and nothing is sent to any service.

**Independent Test**: in a build with no default relay, sign up with "Keep everything on this device for now" checked, reach Overview, and see no request to any service (spec User Story 1, SC-001, SC-002).

### Tests for User Story 1 (write first; they must fail)

- [X] T005 [P] [US1] Extend `packages/core/src/identity/application/create-account.test.ts`: with `server` absent, and with `server: ''`, the result is ok with `registration: 'local'`; `registration.register` is called zero times; the saved credentials are `{ registration: 'local', server: '' }`; the first Fold exists; the password is wiped; `invalid_server` and `email_taken` are never returned; `discoverable` has no effect. Cases with a server keep their existing results (`done`, `pending`, `email_taken` rollback). A failure while creating the Fold still rolls back everything.
- [X] T006 [P] [US1] Extend `apps/web/src/worker/worker.test.ts`: `createAccount` called without `server` makes no registration request and no rates request, `sync.status` then reports `registration: 'local'` and `server` empty, and the starter categories are seeded as for any account.
- [X] T007 [US1] Extend `apps/web/src/worker/worker.test.ts` for FR-011: create a local account, lock, unlock, and also restart the worker from the stored credentials; each time `sync.status` still reports `registration: 'local'`, the sync service stays idle, and no registration, sync or rates request is made.
- [X] T008 [P] [US1] Create `apps/web/src/ui/auth/SignUpForm.test.tsx` (follow the pattern of `apps/web/src/ui/shell/HelpDialog.test.tsx`) for a build with no default relay: the "Keep everything on this device for now" box is checked; the address field and the "find me by email" option are not rendered; the email field shows the `signup.email.localHint` hint; submitting calls `createAccount` with `server: ''`; unchecking shows a required address field, and submitting with it empty shows the existing invalid-address error, not a local account. Typing an address and then ticking the box submits `server: ''`, and the typed address is not sent anywhere.
- [X] T009 [P] [US1] Extend `apps/web/src/ui/emergency-kit/kit.test.ts`: when `server` is absent, `buildEmergencyKitHtml` contains no Service line and no add-device link, contains the `kit.doc.local` text, and a `server`-bearing kit is unchanged. No QR is produced for the add-device link when there is no server.

### Implementation for User Story 1

- [X] T010 [US1] In `packages/core/src/identity/application/create-account.ts` make `CreateAccountInput.server` optional and add `'local'` to `NewAccount.registration`. When `server` is absent or `''`: skip `normaliseServerAddress`; save credentials with `registration: 'local'` and `server: ''`; skip `registration.register`; build the `UserAccount` with `server: ''` (it stays `draft`); log `account.created` with `registration: 'local'`. Keep the rollback and password-wipe paths identical. Document `''` in `packages/core/src/identity/domain/user-account.ts` (`UserAccount.server`). Make T005 pass.
- [X] T011 [US1] In `apps/web/src/worker/app-handlers.ts` make `createAccount`'s `server` and `discoverable` args optional, pass them through, and tell the sync service the account is local with `startSync(..., 'local')` (an empty `server`, which the service never reads: it stays idle, never connects and never refreshes rates). Return `registration: 'local'`. Make T006 pass.
- [X] T012 [P] [US1] In `apps/web/src/ui/emergency-kit/kit.ts` make `KitDetails.server` optional; when absent omit the Service line and the add-device link and QR, and print `kit.doc.local`. Check every caller of `buildEmergencyKitHtml`, `downloadKit`, `printKit` and `addDeviceUrl` (search `apps/web/src`) passes the server only when the account has one. Make T009 pass.
- [X] T013 [US1] In `apps/web/src/ui/auth/SecretKeyScreen.tsx` accept an optional `server`; build `kit` without it for a local account; show `secretkey.local` (the one-time backup suggestion, FR-007a) with a link to `/settings/data/` instead of `secretkey.pending` when `created.registration === 'local'`. Depends on T012.
- [X] T014 [US1] In `apps/web/src/ui/auth/SignUpForm.tsx` add the checkbox (`signup.local.label` with the `signup.local.hint` under it) using the kit `CheckboxField`, `Checkbox` and `Label` as the discoverable option does. Initial value: checked when `DEFAULT_SERVER === ''`, otherwise unchecked with the address pre-filled (FR-012, FR-013). When checked: do not render `ServerAddress` or the discoverable option, send `server: ''`, and show `signup.email.localHint` as the email field's hint. When unchecked: behave exactly as today. Pass `server` to `SecretKeyScreen` only when not local. Make T008 pass. Depends on T010, T011, T013.
- [X] T015 [US1] Create `e2e/us10-local-only.spec.ts` (follow `e2e/us1-account.spec.ts` and the fixtures in `e2e/fixtures/`): sign up with the box checked, confirm no address field and no "find me by email", complete the Secret Key step, reach Overview with the first Fold, and assert with `page.on('request')` that no request leaves the app's own origin during sign-up and a session of adding an account and a transaction, locking, unlocking and reloading the page (FR-011, SC-002). Run the plaintext-leak scan fixture at the end.

**Checkpoint**: a person with no relay can sign up and use the app. On its own this still shows "Not syncing yet", which is why User Story 2 ships with it.

## Phase 4: User Story 2 - Know that this device is on its own (Priority: P1)

**Goal**: the app says plainly that data lives only on this device, never mistakes it for a fault, and guides people to back up and to connect.

**Independent Test**: sign up local-only and check the header indicator, Sync settings, sharing screens, the Getting started card and Help in every language (spec User Story 2, FR-006, FR-007, FR-007a, FR-007b).

### Tests for User Story 2 (write first; they must fail)

- [X] T016 [P] [US2] Create `apps/web/src/ui/sync/SyncIndicator.test.tsx`: `registration: 'local'` shows `sync.state.local_only`, a neutral tone, no attention text, a link to `/settings/sync/`, and `data-sync-state="local"`, whatever `connection` and `overall` say (even `offline` or `error`); `pending` still shows `sync.state.not_registered`; `done` is unchanged.
- [X] T017 [P] [US2] Create `apps/web/src/ui/settings/SyncSection.test.tsx`: for `local` it shows `synclocal.title`, `synclocal.lede` and `synclocal.backup`, a link to `/settings/data/`, and the connect form with a required address field, the password field and a "find me by email" box (`signup.discoverable.label`) that is unchecked by default; `synclocal.backup` says a forgotten password cannot be recovered; `pending` keeps today's text; `done` shows `syncenable.done` and the email section.
- [X] T018 [P] [US2] Create `apps/web/src/ui/sharing/RelayNeeded.test.tsx`: it renders `sharing.relayNeeded` and a link named `sharing.relayNeeded.link` to `/settings/sync/`, and the controls it replaces are disabled, not removed, and described by it (`aria-describedby`).
- [X] T019 [P] [US2] Extend `apps/web/src/ui/firstrun/checklist.test.ts`: without the local option the steps and `complete` are exactly as today; with `local: true` there is a fourth step `backup`, done only when `backedUp` is true, and `complete` needs it.
- [X] T020 [P] [US2] Extend `apps/web/src/ui/shell/HelpDialog.test.tsx`: for a local account with the three steps done and no backup, Help still offers "Show the getting-started card" and does not say it is finished; after a backup it says it is finished.

### Implementation for User Story 2

- [X] T021 [P] [US2] Create `apps/web/src/ui/settings/ProfileSecurity.test.tsx` (spec FR-006a): for `registration: 'local'` the page has no service-address row and the Registration row reads `sync.state.local_only`, never an empty value or `settings.account.pending`; for `pending` and `done` it is unchanged.
- [X] T022 [US2] Create `apps/web/src/ui/sync/useLocalOnly.ts` exporting `useLocalOnly(): boolean | undefined` built on `useSyncStatus` (`undefined` until the status is known, `true` when `registration === 'local'`). Used by T023 to T029.
- [X] T023 [US2] In `apps/web/src/ui/sync/SyncIndicator.tsx` handle `registration === 'local'` first, before any connection logic: text `sync.state.local_only`, the neutral tone, no attention suffix, `data-sync-state="local"`. Make T016 pass. Depends on T022.
- [X] T024 [US2] In `apps/web/src/ui/settings/SyncSection.tsx` add the local branch: heading `synclocal.title`, `synclocal.lede`, `synclocal.backup` with a link to `/settings/data/`, and the same connect form as `pending` (address required, password, invite code). Add the "find me by email" box (`signup.discoverable.label` and `signup.discoverable.hint`), unchecked by default, and send its value as `discoverable` with `sync.enable` (FR-008a). Keep the `pending` and `done` branches unchanged (no box, no `discoverable`). Make T017 pass.
- [X] T025 [P] [US2] Create `apps/web/src/ui/sharing/RelayNeeded.tsx`: a small notice with `sharing.relayNeeded` and a link (`sharing.relayNeeded.link`) to `/settings/sync/`; give it an `id` so disabled controls can reference it. Make T018 pass.
- [X] T026 [US2] In `apps/web/src/ui/settings/FoldsAndSharing.tsx` and `apps/web/src/ui/sharing/` (`SharingPanel.tsx`, `InvitationsSection.tsx`, `MyCode.tsx`, `InviteForm.tsx`) use `useLocalOnly()`: when true show `RelayNeeded` and render the share, invite and code controls disabled with `aria-describedby` pointing at it; nothing may throw, hide silently, or call the worker. Depends on T022 and T025.
- [X] T027 [P] [US2] In `apps/web/src/ui/firstrun/checklist.ts` add `'backup'` to `StepId` and an optional `local?: boolean` and `backedUp?: boolean` to `checklistState`'s counts; add the fourth step only when `local` is true. Make T019 pass.
- [X] T028 [US2] In `apps/web/src/ui/firstrun/checklist-status.ts` read whether the account is local (T022) and whether a backup exists (`storage.status` `lastBackupAtMs > 0`) and pass them to `checklistState`; re-read when the ledger changes as today. Both the Overview card and `HelpDialog` use this, so they cannot disagree. Make T020 pass. Depends on T022 and T027.
- [X] T029 [US2] In `apps/web/src/ui/firstrun/FirstRunChecklist.tsx` show the `backup` step (`firstrun.step.backup`) with a link to `/settings/data/` while it is not done, in the same style as the other steps.
- [X] T030 [US2] In `apps/web/src/ui/settings/ProfileSecurity.tsx` (the dl around the `signup.server.label` and `settings.account.registration` rows), hide the address row when `core.account.registration === 'local'` and show `sync.state.local_only` in the Registration row; leave `pending` and `done` as they are. Make the test above pass.
- [X] T031 [US2] Extend `e2e/us10-local-only.spec.ts`: after a local sign-up the header says "Local only" (no offline, error or attention state), toggling the browser offline and online changes nothing, Folds and sharing shows the disabled controls with the sentence and link, the Getting started card has "Make a backup" and ticks after a backup is made in Settings → Data, and Help agrees. Repeat the header and sharing checks in Українська and Polski.

**Checkpoint**: a local-only account is clearly labelled and guided; no sync-related warning ever appears for it.

## Phase 5: User Story 3 - Connect to a relay later (Priority: P2)

**Goal**: from Settings, a local-only account registers with a relay and starts syncing without losing anything.

**Independent Test**: sign up local-only, add data, connect to a test relay, and see every record on the device and on a second device (spec User Story 3, FR-008 to FR-010, SC-003).

### Tests for User Story 3 (write first)

- [X] T032 [P] [US3] Extend `packages/core/src/identity/application/register-existing.test.ts`: a stored `local` account with `server: ''` and an input `server` registers with that server and saves `registration: 'done'` with the address; `register` receives `discoverable: false` when the input says false and `true` when the input omits it (as today for `pending`); with no input `server` it returns `invalid_server`, calls `register` zero times and changes nothing stored; `offline`, `email_taken`, `invite_required`, `rate_limited` and `rejected` each leave the stored credentials as `{ registration: 'local', server: '' }`; a `done` account still returns `already_registered`.
- [X] T033 [P] [US3] Extend `apps/web/src/worker/worker.test.ts`: `sync.enable` on a local account with a valid address and `discoverable: false` makes `sync.status` report `registration: 'done'` and the new `server`, registers as not discoverable, and starts sync; a failed attempt leaves it `local` and usable.

### Implementation for User Story 3

- [X] T034 [US3] Make T032 and T033 pass. In `packages/core/src/identity/application/register-existing.ts` add the optional `discoverable` input (default `true`, so `pending` accounts behave as today) and pass it to `registration.register` instead of the hard-coded `true`; update the header comment to say it also serves accounts created local-only. Its other behaviour (it refuses only `done`; an empty stored address fails validation) is expected to need no change, and the T032 cases for it should already pass. In `apps/web/src/worker/app-handlers.ts` make `sync.enable` accept and pass `discoverable`. Fix anything T033 shows red.
- [X] T035 [US3] In `apps/web/src/ui/settings/SyncSection.tsx` check the success path for a `local` account: after `sync.enable` succeeds `core.refresh()` and `refresh()` must flip the header from "Local only", the section to `syncenable.done`, the sharing screens to enabled and the Getting started backup step away, without a reload. Add the assertions for this to `apps/web/src/ui/settings/SyncSection.test.tsx`, and the three error messages (unreachable, invalid address, email already used) leaving the section in its local state.
- [X] T036 [US3] Extend `e2e/us10-local-only.spec.ts` using the relay setup from `e2e/us4-sync.spec.ts`: sign up local-only, add an account and three transactions, try an unreachable address (specific message, still local, data intact), then connect to the test relay; assert the connect form's "find me by email" box is unchecked by default and the choice can be changed afterwards in Settings, the header shows normal sync states, every record is present with no duplicates (the transaction count is the same before and after), and a second browser context signed in to the account sees the same records (SC-003).

**Checkpoint**: "for now" is true: nothing is lost by choosing local-only.

## Phase 6: User Story 4 - Builds with a default relay behave as today (Priority: P2)

**Goal**: a build that ships a default relay address keeps today's sign-up, and the local-only choice stays available.

**Independent Test**: build with `NEXT_PUBLIC_DEFAULT_SERVER` set and confirm the address is pre-filled, the box is unchecked and sign-up registers as before; ticking the box gives a local account (spec User Story 4, FR-012, SC-006).

- [X] T037 [US4] In `apps/web/src/ui/auth/SignUpForm.test.tsx` add a case for a build with a default relay (stub `process.env.NEXT_PUBLIC_DEFAULT_SERVER`, reset modules and import the form afresh, because the value is read at module load): the box is unchecked, the address is pre-filled and required, submit sends it, and the number of steps is unchanged; ticking the box hides the address and submits `server: ''`.
- [X] T038 [US4] Confirm `SignUpForm.tsx` from T014 satisfies T037 and fix any difference. Update `apps/web/.env.example` and the `NEXT_PUBLIC_DEFAULT_SERVER` row in `apps/web/README.md` to say it pre-selects the relay path, and that an empty value makes local-only the default. Update the matching sentence in `docs/self-hosting.md` (near the `NEXT_PUBLIC_DEFAULT_SERVER=` example).

**Checkpoint**: hosted and organisation builds are unchanged for their users.

## Phase 7: Polish and cross-cutting

- [X] T039 [P] In `docs/privacy.md` state that a local-only account sends nothing to any service and that connecting later is what introduces the service (FR-016). Keep the exact-list style of the page.
- [X] T040 [P] In `docs/threat-model.md` add a short note for local-only accounts: there is no service adversary, losing the device without a backup is total loss, and this is an accepted risk mitigated by the backup suggestion, the Getting started step and the existing reminder. The constitution requires this note for sign-up and sync changes.
- [X] T041 [P] Extend `e2e/a11y.spec.ts` (axe) to the local-only sign-up form, the local Sync settings and the sharing notice, and `e2e/i18n.spec.ts` (or `pseudo-walk.spec.ts`) to the same screens in Українська and Polski, so no key is shown raw (SC-005).
- [X] T042 [P] Check `apps/desktop` for anything that assumes a relay at first run or sign-up (search for `server`, `relay` and the default-server setting); expect none. Record the result in `specs/010-local-only-signup/research.md`. Then run the quickstart's desktop pass.
- [X] T043 Run `pnpm verify`, `pnpm check:no-float`, `pnpm check:bundle` and `pnpm test:e2e`; fix what fails.
- [ ] T044 Walk through every row of `specs/010-local-only-signup/quickstart.md` by hand on the web build and the desktop app, and tick each against the spec requirement it names. Record anything that differs.

## Dependencies and order

- **Phase 1 → Phase 2 → stories**. T002, T003 and T004 can run in parallel; every story needs all three.
- **US1** has no dependency on other stories. Within it: tests T005 to T009 first (T007 follows T006 because both edit `worker.test.ts`), then T010 → T011, T012 → T013 → T014, then T015.
- **US2** needs Phase 2 and, for its end-to-end check, US1. Its unit work is independent of US1. Within it: tests T016 to T021, then T022 first, then T023, T024, T025, T027 and T030 (T025 and T027 in parallel; T030 needs only T021), then T026, T028, T029, then T031.
- **US3** needs US1 (a local account to connect) and T024 (the connect form). T032 and T033 in parallel, then T034, T035, T036.
- **US4** needs T014. T037 then T038.
- **Polish** needs the stories it documents or tests. T039 to T042 can run in parallel; T043 and T044 last.

## Parallel examples

- After Phase 2: T005, T006, T008 and T009 together (four different test files), with T007 right after T006.
- In US2: T016 to T021 together (six different test files); then T025, T027 and T030 together.
- In Polish: T039, T040, T041 and T042 together.

## Implementation strategy

- **MVP**: User Story 1 together with User Story 2. Both are P1, and US1 alone would show a local account as "Not syncing yet" with an attention tone, which reads as a fault. Stop here, run T043, and ship if needed.
- **Then**: US3 (connect later) and US4 (default relay). US4 is mostly a test and documentation pass, because the default rule is built into T014.
- **Order inside the MVP**: types and messages, core, worker, kit, sign-up form, then the indicator, Settings, sharing and Getting started. Each task leaves the repository type-checking and the tests green.
- **Reviews**: this touches sign-up and sync, so the pull request needs two reviewers and the threat-model note from T040. No cryptography, protocol or wire format changes, so no ADR.
