# Contract: Local-Only Account (page ↔ worker, and screen copy)

The relay API is unchanged: `specs/001-secure-finance-core/contracts/sync-api.openapi.yaml` and `packages/protocol` need no edit, and nothing here crosses the network. This file covers the two interfaces the feature does change: the calls between the page and the core worker, and the strings the screens need.

## 1. Worker calls

### `createAccount`

| | Before | After |
|---|---|---|
| args | `{ email, password, server, discoverable, foldName?, baseCurrency?, categoryNames? }` | `server` and `discoverable` are optional. `server` absent or `''` means local-only |
| ok result | `{ secretKeyText, accountId, fold, registration: 'done' \| 'pending' }` | `registration: 'done' \| 'pending' \| 'local'` |
| errors | `invalid_email`, `invalid_server`, `email_taken`, `registration_rejected`, `weak_password`, `invalid_fold_name`, `unknown_currency` | Same. `invalid_server` and `email_taken` cannot occur when `server` is absent |

Local-only guarantees: no registration request is made, the sync service is told the account is `local` and stays idle (it never connects, never refreshes rates and sends nothing), the credentials are saved with `registration: 'local'` and `server: ''`, and a failure rolls back exactly as today.

### `sync.status`

`registration` widens from `'pending' | 'done'` to `'pending' | 'done' | 'local'`. `server` is `''` or `undefined` for `local`. `available` is unchanged.

### `sync.enable`

| | Before | After |
|---|---|---|
| args | `{ password, server?, inviteCode? }` | Adds `discoverable?: boolean` (default `true`, as today, when omitted). `server` is **required** when the stored account is `local`. The Sync settings form always sends `discoverable` for a local account, unchecked by default |
| precondition | stored `registration !== 'done'` | Same; `local` and `pending` both qualify |
| errors | `no_account`, `already_registered`, `invalid_server`, `wrong_password`, `offline`, `email_taken`, `rejected`, `invite_required`, `rate_limited` | Same. A missing address for a `local` account returns `invalid_server` |
| failure | stored credentials unchanged | Same: the account stays `local` |
| success | stored `registration: 'done'`, address saved, sync started | Same |

### `storage.status`

Unchanged. `onService` stays `registration === 'done'`, so `local` counts as "data only on this device" and the existing backup reminder applies.

## 2. Screen behaviour (testable)

| Screen | Condition | Required behaviour |
|---|---|---|
| Sign-up | no default relay in the build | "Keep everything on this device for now" is checked; address and "find me by email" are hidden |
| Sign-up | default relay in the build | Unchecked; address pre-filled; behaviour as today |
| Sign-up | checked | Submit sends no address; the email field hint says it stays on this device |
| Sign-up completion | `registration === 'local'` | Shows a backup suggestion (text only: a link would leave the screen before the Secret Key is saved); the kit's Service row reads "Stored only on this device" and it has no add-device link or QR |
| Header sync indicator | `registration === 'local'` | "Local only", neutral tone, links to `/settings/sync/`; never an offline, error or attention state |
| Settings → Sync and devices | `registration === 'local'` | Only the explanation, a link to backups and the connect form with the address required and a "find me by email" box unchecked by default. No devices list, sync panel or offline alert, which would read as a fault |
| Settings → Profile and security | `registration === 'local'` | No service-address row; the Registration row says "Local only" (never an empty address or "Pending") |
| Sharing (Folds and sharing) | `registration === 'local'` | The per-Fold sharing button is disabled and described by "Sharing needs a service." with a link to `/settings/sync/`; that notice stands in for the invitations list and the invitation code, which also need a service |
| Getting started and Help | `registration === 'local'` | A fourth step "Make a backup", done when a backup exists |

## 3. New message keys

Each key must exist in `en.json`, `uk.json` and `pl.json` (`catalogue-complete.test.ts` enforces this).

| Key | English |
|---|---|
| `signup.local.label` | Keep everything on this device for now |
| `signup.local.hint` | Nothing is sent to any service and your devices do not sync. You can connect a service later in Settings. Make a backup so a lost device is not the end of your data. |
| `signup.email.localHint` | Stays on this device unless you connect a service later. |
| `secretkey.local` | This account is stored only on this device. Make an encrypted backup in Settings → Data and storage. |
| `kit.doc.local` | Stored only on this device. There is no service address. |
| `sync.state.local_only` | Local only |
| `synclocal.title` | Stored on this device only |
| `synclocal.lede` | Your data is stored only on this device and nothing syncs. To keep several devices in step or to share a Fold, connect a service. Enter your password again: it is used to prepare the registration here and is never sent. |
| `synclocal.backup` | Until you connect, an encrypted backup is the only second copy of your data. A forgotten password cannot be recovered, and changing it or making a Recovery Key needs a service. |
| `sharing.relayNeeded` | Sharing needs a service. |
| `sharing.relayNeeded.link` | Connect to a service |
| `firstrun.step.backup` | Make a backup |

Existing keys reused: `signup.server.*`, `signup.discoverable.*`, `syncenable.*`, `unlock.password.label`, `adddevice.working`, and `sync.state.local_only` for the Registration row.
