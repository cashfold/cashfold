# Research: Local-Only Sign-Up

Date: 2026-10-28. No `NEEDS CLARIFICATION` items were open after `/speckit-clarify`; this file records what the code already does and the decisions that follow.

## R-1 What the code already does

| Finding | Where | Consequence |
|---|---|---|
| Sign-up already creates everything on the device first and registers last; if the service is unreachable the account is saved with `registration: 'pending'`. | `packages/core/src/identity/application/create-account.ts` | Local-only is "skip the last step", not a new flow. |
| Only the sign-up form and `normaliseServerAddress` force an address. `createAccount` rejects an empty address with `invalid_server`. | `SignUpForm.tsx`, `create-account.ts` | The check becomes conditional. |
| `registerExisting` (behind the worker call `sync.enable`) registers a stored account with a service from the password and the Secret Key, then the sync engine uploads existing Folds. It refuses only `registration === 'done'`. | `register-existing.ts`, `app-handlers.ts` | Connecting later needs no new use case. It must accept a stored account with no address, and the caller must supply one. |
| `SyncSection` already shows the address, password and invite form while `registration === 'pending'`. | `SyncSection.tsx` | Reused for local-only, with a different intro and the address required. |
| `DeviceCredentials.registration` is `'pending' \| 'done'`; `server` is a required string. | `ports/index.ts`, `credential-store.ts` (plain IndexedDB record, no schema version) | Adding a value is backward compatible with existing records. |
| `SyncService.start(identity, reg)` treats anything but `'done'` as `not_registered` and never connects. Rates are refreshed only after a connection. | `sync-service.ts` | No network use for a local-only account, as long as it never reaches the connect path. |
| `SyncIndicator` shows "Not syncing yet" for `not_registered`, with an attention tone. | `SyncIndicator.tsx` | Local-only needs its own wording and a neutral tone. |
| A backup reminder already exists (`decideBackupNag`): for a device-only account with data and no backup in 30 days it is "strong", snoozable for 7 days. `lastBackupAtMs === 0` counts as never. | `backup-nag.ts`, `StorageNotice.tsx` | Local-only accounts already get a firm, recurring reminder once they have data. The spec's no-recurring-prompt assumption was corrected. |
| Getting started is `checklistState({folds, accounts, transactions})` and is shared with the Help dialog. | `checklist.ts`, `checklist-status.ts` | A conditional fourth step goes in the shared definition so the card and Help agree. |
| The Emergency Kit prints the service address and builds an "add another device" link from it. | `emergency-kit/kit.ts`, `SecretKeyScreen.tsx` | Both must be omitted when there is no service. |
| Sharing UI is `FoldsAndSharing` → `SharingPanel`, `InvitationsSection`, `MyCode`, `InviteForm`. | `ui/sharing/`, `ui/settings/FoldsAndSharing.tsx` | One notice component, used where the sharing entry points are. |

## Decisions

### D-1 Represent local-only as `registration: 'local'`

- **Decision**: `DeviceCredentials.registration` becomes `'pending' | 'done' | 'local'`. For `'local'`, `server` is the empty string and is never read.
- **Rationale**: `registration` is already the single field the worker, sync status and backup logic branch on. A third value keeps the change in one place and needs no data migration, because existing records only ever hold the other two values.
- **Alternatives**: (a) Make `server` optional. With `exactOptionalPropertyTypes` this ripples through the credential store, the kit and the sync identity for no gain. (b) A separate `localOnly` boolean. It can disagree with `registration`, which creates an invalid state ("local" and "done").

### D-2 `createAccount` takes an optional address

- **Decision**: `CreateAccountInput.server` becomes optional. Absent or empty means local-only: skip address validation and `registration.register`, save `registration: 'local'`, return `registration: 'local'`.
- **Rationale**: The "everything on the device first" part is already there. The explicit choice lives in the form (D-4), so the use case can treat "no address" as unambiguous.
- **Alternatives**: A separate `createLocalAccount` use case. It would duplicate the key, Fold and rollback logic.

### D-3 Connect later through the existing `sync.enable`

- **Decision**: `registerExisting` already accepts anything but `'done'`, so it should work for `'local'` unchanged: with a stored address of `''` and no address in the request, `normaliseServerAddress` returns `invalid_server`. The tests (T029, T030) prove this before any change. On success it saves `registration: 'done'` and the address, as now.
- **Rationale**: This is exactly the case the use case was written for ("an account made offline"). The one real change is the discoverability input below.
- **Discoverability**: `registerExisting` currently registers with `discoverable: true` for every account. Local-only sign-up never asked, so silently making the account findable by email would be a privacy surprise. Decision: `registerExisting` takes an optional `discoverable` input (default `true`, so accounts that are merely pending behave as today), `sync.enable` passes it through, and the Sync settings form for a local account shows the "find me by email" box unchecked by default (spec FR-008a). The person can change it later in Settings.

### D-4 Sign-up form: an explicit choice

- **Decision**: A checkbox "Keep everything on this device for now". Checked hides the address and the "find me by email" option and sends no address. It is checked by default only when the build has no default relay (FR-013); with a default relay it is unchecked and the address is pre-filled (FR-012).
- **Rationale**: An explicit choice avoids treating an empty or forgotten field as consent to store nothing off-device, and it keeps the existing "required address" validation for the relay path.
- **Alternatives**: Treat an empty address as local-only. Rejected: a half-typed form would silently become local-only.

### D-5 Sync indicator and Settings

- **Decision**: The worker keeps reporting `registration` through `sync.status`. `SyncIndicator` shows "Local only" with the neutral tone when `registration === 'local'`, before any connection logic. `SyncSection` shows a local-only intro plus the same form with the address required.
- **Rationale**: The state is derived in one place the UI already reads. No new connection state in the sync engine.

### D-6 Backups

- **Decision**: (1) A paragraph on the sign-up completion screen (`SecretKeyScreen`) for local-only accounts suggesting an encrypted backup, with a link to Settings → Data. This is the one-time suggestion. (2) A fourth Getting started step "Make a backup", present only while `registration === 'local'`, done once a backup exists. (3) The existing reminder is unchanged.
- **Rationale**: Right after sign-up there is no data, so the existing reminder would not fire yet; the sign-up screen is the only moment everyone sees. The step makes the same nudge visible on Overview and Help.
- **Alternatives**: A separate modal after sign-up. More UI, same effect.

### D-7 Emergency Kit

- **Decision**: For local-only, the kit omits the "Service" line and the add-device link and QR, and says the account is stored only on this device.
- **Rationale**: A link carrying an empty `server=` would break adding a device and look like a fault. Without a relay a second device cannot be added at all.

### D-8 Sharing

- **Decision**: A small notice component "Sharing needs a relay" with a link to `/settings/sync/`, shown in place of the share and invite controls while `registration === 'local'`, which are rendered disabled where they stay visible.
- **Rationale**: Matches FR-007b without changing sharing logic.

### D-10 Account actions that need a registered account

- **Decision**: Changing the password, creating a Recovery Key and deleting the account through the service stay unavailable for a local-only account, exactly as they are for any account that is not registered (`credential-change.ts`, `recovery.ts`, `delete-account.ts` refuse unless `registration === 'done'`, and the matching Settings sections are hidden). The Sync settings text says so next to the backup advice, and a local Recovery Key is a possible follow-up.
- **Rationale**: A Recovery Key is a second verifier held by the service, so it cannot exist without one. Changing this is a separate feature.

### D-11 Settings → Profile and security

- **Decision**: `ProfileSecurity.tsx` shows `core.account.server` and maps any `registration` other than `done` to "Pending". For `local` it hides the address row and shows `sync.state.local_only` in the Registration row (spec FR-006a).

### D-9 Documentation and threat model

- **Decision**: Update `docs/privacy.md` (a local-only account sends nothing to any service), `docs/threat-model.md` (new note: no service adversary, device loss without a backup is total loss, accepted) and `apps/web/README.md`/`docs/self-hosting.md` (the default-relay setting now only pre-selects the relay path).
- **Rationale**: The constitution requires a threat-model note for sign-up and sync changes. No cryptography, protocol or wire format changes, so no ADR is needed.

## Out of scope (confirmed)

Switching relays; going from a relay back to local-only; optional email; mobile; sharing without a relay; rate refresh without a relay.

## Implementation notes

- **Desktop (T042)**: `apps/desktop/src` has no reference to a relay, a default server or the sign-up flow, so the shell needed no change. Only its e2e helpers (`apps/desktop/e2e/fixtures.ts`, `sync-parity.spec.ts`) signed up with an address and now untick "Keep everything on this device for now" first. The Electron e2e suite was not run here.
- **Test environment**: the web package has no DOM test environment, so component logic was moved into small pure modules (`sign-up-choice.ts`, `indicator-view.ts`, `account-details.ts`, `RelayNeededView`) with unit tests, and the interactions are covered by `e2e/us10-local-only.spec.ts`. The worker handlers are tested in a real browser through the `localOnly` scenario in `apps/web/src/adapters/sqlite-opfs/test-scenarios.ts`.
- **Kit**: for a local account the kit keeps its "Service" row, which reads "Stored only on this device", rather than dropping the row. It has no add-device link or QR.
- **Sync page**: `DevicesScreen` would show an "offline" alert and an empty device list for a local account, which read as a fault (FR-006), so `SyncAndDevices` shows only the explanation and the connect form for it.
- **Bug found by e2e**: unticking the choice and leaving the address empty reached core, which treats an empty address as "no service", so it silently made a local account. The form now reports a missing address first (`missingAddress`).
- **Existing e2e**: about 25 sign-up helpers filled in the service address; with local-only the default for a build with no default relay, they now untick the choice first (a no-op when a build has a default relay).

