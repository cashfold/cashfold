# Data Model: Local-Only Sign-Up

No new tables, records, wire types or storage keys. One stored field gains a value.

## Account sync mode

Stored as `DeviceCredentials.registration` (IndexedDB, key `current`, in the clear because it is routing information).

| Value | Meaning | `server` | Sync engine |
|---|---|---|---|
| `local` (new) | The person chose to keep everything on this device. | `''`, never read | Started in the "not registered" state, never connects, never refreshes rates |
| `pending` | A relay was chosen but could not be reached at sign-up. | the chosen address | As today |
| `done` | Registered with the relay. | the address | As today |

### Transitions

```
sign-up (no address)        → local
sign-up (address, offline)  → pending
sign-up (address, reachable)→ done
local   ──connect──▶ done      (sync.enable with an address and the password)
pending ──connect──▶ done      (as today)
local   ──connect fails──▶ local   (nothing changes)
```

There is no transition out of `done`, and none from `pending` or `done` to `local` (out of scope).

### Validation rules

- `local` ⇒ `server === ''`. `pending` and `done` ⇒ `server` is a normalised relay address (existing rule).
- Connecting from `local` requires a valid address in the request; the stored empty value is never used as a default.
- Existing records only hold `pending` or `done`, so no migration is needed. A build older than this feature that reads a `local` record is not supported (pre-1.0, 0.x).

## Relay address

The optional service address. Absent (`''`) for `local`. Surfaced in four places that must handle absence:

| Place | Behaviour when `local` |
|---|---|
| `UserAccount.server` (domain view) | `''`; the account stays in state `draft` until it is registered |
| Emergency Kit (`KitDetails.server`) | `''`; the Service row reads "Stored only on this device" and the add-device link/QR are omitted |
| Sync identity passed to the sync engine | Carries `server: ''`, which the engine never reads: it stays idle and nothing syncs |
| Settings → Profile and security | The address row is hidden and the Registration row says "Local only" |

## Derived UI state (not stored)

| State | Derived from | Used by |
|---|---|---|
| "Local only" | `sync.status.registration === 'local'` | Sync indicator, Sync settings, sharing notice, Getting started backup step |
| Backup step done | A backup exists (`lastBackupAtMs > 0`) or the account is registered | Getting started card and Help dialog |

## Existing data that must be unchanged by connecting

Folds, accounts, transactions, transfers, categories, budgets, schedules, goals, attachments and the local operation log. Connecting changes only the sealed credentials, the address and the registration value, as `registerExisting` does today. The sync engine then publishes the existing operations.
