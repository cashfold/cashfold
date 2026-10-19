# Sync across devices (user story 4)

How a person's devices stay in step through a relay that sees only ciphertext. The rules come from
[`ARCHITECTURE.md`](ARCHITECTURE.md) §6 and §9 and the contracts in `specs/001-secure-finance-core/contracts/`; this page records the
decisions those leave open and what is not built yet.

## The moving parts

| Part | Where |
|---|---|
| SRP sign-in, sealed frames | `packages/crypto/src/{pake,transport}`, `apps/server/src/modules/auth` |
| Relay (accounts, devices, Folds, ops, snapshots, rates) | `apps/server` |
| Sync client (push, pull, gap and order checks) | `packages/core/src/sync/application/sync-client.ts` |
| Background service in the Core Worker | `apps/web/src/worker/sync-service.ts` |
| New-device sign-in, device management, registering a local account | `packages/core/src/identity/application/` |
| Whole-stack tests (two devices through the real relay) | `tests/stack`, `e2e/us4-sync.spec.ts` |

## Decisions

**Fold keys reach a new device as grants.** When a Fold is created on the service (at sign-up, or when sync is first turned on), the
owner's device uploads a grant of the first Fold key: HPKE-sealed to the account's own encryption key and signed with the account's
signing key (`packages/crypto/src/hpke/fold-key-grant.ts`). A new device signs in with the password and Secret Key, opens the key set,
then fetches and opens the grants. The relay stores them and cannot open them. Sharing with other people (user story 7) uses the same
format with other recipients.

**The account's keys live on each device, sealed.** The credentials blob holds the Secret Key, SRP-x, the device signing key and, now,
the account's encryption and signing keys, all under the Local Vault Key. They are in memory only while unlocked. A device set up before
sync existed has none of them; turning sync on re-derives them from the password and Secret Key (`registerExisting`).

**Other devices' ops are verified with keys from the relay's device list.** The relay lists the account's devices with their public
keys; the client keeps them (`device` table). An op from a device not yet known is not stored or quarantined: the pull stops there
without moving the cursor, the list is refreshed and the round runs again. Once the key is known the op applies like any other.
(Membership-log certification of device keys arrives with sharing.)

**Order is never trusted.** The sync client skips an op only because it lies at or below where the page started, never because a later
one was seen first. A device's ops must arrive gapless; a missing one stops the pull before the cursor moves and is reported as
`gap`. Ops that fail verification are quarantined and shown in Needs attention without stopping the rest.

**A removed device finds out only after proving the password.** Until the SRP proof is right, a removed device looks exactly like a
wrong password. After it, the relay answers `device_revoked`; the device erases its data and says so. The relay also ends the removed
device's sessions at once.

**Snapshots.** Sealed on the client (signed first, then encrypted, bound to Fold, epoch and position). The relay prunes ops below one
only when every active device has acknowledged it. A new device starts from the newest snapshot that verifies; one that does not is
ignored and the device syncs from the log.

**Exchange rates** are read from the user's own service (`GET /rates`) as decimal text, stored as service rates keyed by currency and
time (so every device writes the same records), and refreshed every six hours while online.

## Not built yet

* Membership log and role changes (user story 7): devices of one account are the only writers.
* Rotating a Fold key (epochs above 1) and re-granting; grants are created for epoch 1.
* Restoring a snapshot's "purged record" markers on a device that starts from it: a record purged after its 30-day window can come
  back from a device that still holds an old op for it.
* Offline-first retry of a Fold's creation on the service is per connection; there is no persisted queue beyond the op log.
* The browser-only Firefox and WebKit runs of the sync specs; Firefox and WebKit are skipped where OPFS access handles are unverified.
