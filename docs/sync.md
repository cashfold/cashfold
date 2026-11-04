# Sync across devices

How a person's devices stay in step through a relay that sees only ciphertext. The rules come from
[`ARCHITECTURE.md`](ARCHITECTURE.md) §6 and §9 and the contracts in `specs/001-secure-finance-core/contracts/`; this page
records the decisions those leave open, and the limits you should know about.

## How it works in short

1. Every change is an **operation**: a small, per-field patch with a hybrid logical clock. The device
   signs it, then encrypts it. Nothing readable leaves the device.
2. The device sends the sealed operation to the **relay**, which checks the signature and the structure and stores it. It cannot
   read it.
3. Your other devices pull new operations, **verify** them, and apply them in the same way as their own, so every device
   reaches the same state whatever order the operations arrive in.
4. Offline, a device keeps working. When it is online again it catches up.

## The moving parts

| Part                                                               | Where                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| SRP sign-in, sealed frames                                         | `packages/crypto/src/{pake,transport}`, `apps/server/src/modules/auth` |
| Relay (accounts, devices, Folds, ops, snapshots, rates)            | `apps/server`                                                          |
| Sync client (push, pull, gap and order checks)                     | `packages/core/src/sync/application/sync-client.ts`                    |
| Background service in the Core Worker                              | `apps/web/src/worker/sync-service.ts`                                  |
| New-device sign-in, device management, registering a local account | `packages/core/src/identity/application/`                              |
| Whole-stack tests (two devices through the real relay)             | `tests/stack`, `e2e/us4-sync.spec.ts`                                  |

## The rules sync follows

**Fold keys reach a new device as grants.** When a Fold is created on the service (at sign-up, or when sync is first turned on), the
owner's device uploads a grant of the first Fold key: HPKE-sealed to the account's own encryption key and signed with the account's
signing key (`packages/crypto/src/hpke/fold-key-grant.ts`). A new device signs in with the password and Secret Key, opens the key set,
then fetches and opens the grants. The relay stores them and cannot open them. Sharing a Fold with other people uses the same format
with other recipients.

**The account's keys live on each device, sealed.** The credentials blob holds the Secret Key, SRP-x, the device signing key and the
account's encryption and signing keys, all under the Local Vault Key. They are in memory only while unlocked. A device set up before sync
existed has none of them; turning sync on re-derives them from the password and Secret Key (`registerExisting`).

**Other devices' operations are verified with keys from the relay's device list.** The relay lists the account's devices with their
public keys, and the client keeps them (`device` table). An operation from a device not yet known is not stored or quarantined: the pull
stops there without moving the cursor, the list is refreshed and the round runs again. Once the key is known the operation applies like
any other.

**Order is never trusted.** The sync client skips an operation only because it lies at or below where the page started, never because
a later one was seen first. A device's operations must arrive gapless; a missing one stops the pull before the cursor moves and is
reported as `gap`. Operations that fail verification are quarantined and shown in Needs attention without stopping the rest.

**A removed device finds out only after proving the password.** Until the SRP proof is right, a removed device looks exactly like a
wrong password. After it, the relay answers `device_revoked`; the device erases its data and says so. The relay also ends the removed
device's sessions at once.

**Snapshots** are sealed on the client (signed first, then encrypted, bound to Fold, epoch and position). The relay prunes operations
below one only when every active device has acknowledged it. A new device starts from the newest snapshot that verifies; one that does
not is ignored and the device syncs from the log.

**Exchange rates** are read from the user's own service (`GET /rates`) as decimal text, stored as service rates keyed by currency and
time (so every device writes the same records), and refreshed every six hours while online.

## Limits

- **Worker size.** The worker bundle has a gzip budget that `pnpm check:bundle` enforces. Importing the protocol package's zod schemas
  into the worker costs several hundred kilobytes, so the worker uses hand-written decoders for the operation envelope, key set and
  Fold-key grant (`packages/protocol/src/schemas/record-wire.ts`, exported as `@cashfold/protocol/wire`). Differential tests
  (`record-wire.test.ts`) check they accept and reject exactly what the zod schemas do. Do not import `@cashfold/protocol` (the index)
  from the worker.
- **Rate limits.** The relay limits sign-in, registration and verification attempts per address and per account. `RATE_LIMIT_SCALE`
  (default 1) multiplies every limit; leave it at 1 on a real service. The end-to-end relay sets it to 100 because many tests sign up
  from one address.
- **Sizes are visible.** The relay can see how large each encrypted payload is. Payloads are not padded in this release. See
  [what the service can see](privacy.md).
- **A late restore can diverge.** A record purged 30 days after deletion is gone for good, and a late operation for it is quarantined.
  A restore made just inside the window on one device can therefore reach a device that already purged it. See
  [Deleted records](ledger.md#deleted-records).
- **Fold creation is retried per connection.** Retrying a Fold's creation on the service while offline is per connection; there is no
  persisted queue beyond the operation log.
