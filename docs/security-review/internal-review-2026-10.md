# Internal security review, 2026-10

**This is an internal review, not the independent external review.** Reviewer: Andrii Pohuliailo (maintainer). It was prepared with AI assistance and reviewed by the maintainer, who is not independent of the code. The maintainer marked the release gate in [status.md](status.md) complete on the strength of it (the project has no independent reviewer); the finding numbers there are INT-1 to INT-7. Treat every finding as "read in the code, not exploited" unless it says otherwise.

## Scope

Read in full: `apps/server/src` sign-in (`auth.service.ts`, `srp-server.ts`, `frame.ts`, `frame.guard.ts`, `sessions.ts`), rate limiting (`rate-limit.ts`, `config.ts`, `app.ts`), Fold routes (`folds.controller.ts`, `folds.service.ts`), attachments, error handling; `apps/desktop/src/main` (`protocol.ts`, `security.ts`, `ipc.ts`, `window.ts`, `update-verify.ts`, part of `updater.ts`) and the preload bridge; CSV export; the client side of snapshot opening.

**Not reviewed** (the external reviewer should start here): the cryptographic implementations in `packages/crypto` (key derivation, HPKE grants, op sealing), membership-log verification and role checks in `packages/core/src/sharing`, `account-crypto.ts` and the worker's handling of secrets, CSP and service-worker generation, the CSV import and backup parsers, the CBOR decoder, the PostgreSQL store, and the release workflows.

## Summary

| # | Severity | Area | Finding |
| --- | --- | --- | --- |
| 1 | Medium | Server sign-in | Response timing can tell an existing address from an unknown one |
| 2 | Medium | Desktop updater | A signed installer is not tied to the version the feed names (rollback by replay) |
| 3 | Medium | Server config | A mistyped `RATE_LIMIT_SCALE` silently turns all rate limiting off |
| 4 | Low–Medium | Server | `trustProxy: true` is unconditional, so per-address limits can be spoofed when the relay is exposed directly |
| 5 | Low–Medium | Sharing (to verify) | A snapshot is accepted from any known Fold device, whatever its role |
| 6 | Low | Server sign-in | The failed-attempt tracker never forgets entries; lockouts are checked only at the start and only in memory |
| 7 | Low | Server | The attachment quota is checked and then written, so parallel uploads can overshoot it |

No critical or high finding was found in the code that was read.

## Status of the findings

All seven were addressed on the branch `fix/security-review-findings`, one commit each. Two points stay open on purpose.

| # | Status | What changed |
| --- | --- | --- |
| 1 | Fixed | Sign-in does the same work for unknown and existing addresses (stand-in verifier and the recovery lookup always run); the failure write for a real account is no longer awaited. Tests count the calls. Network timing itself was not measured. |
| 2 | Fixed | The app refuses an installer unless its name is `<app>-<version>-<os>-<arch>.<ext>` for the version the feed offers. No change to the signature format. |
| 3 | Fixed | The relay refuses to start unless `RATE_LIMIT_SCALE` is a number greater than 0. |
| 4 | Fixed | `TRUST_PROXY` setting; the default trusts only loopback and private ranges. Check that your reverse proxy connects from such an address (a proxy on a public address needs `TRUST_PROXY` set to it). |
| 5 | Narrowed, open | A snapshot is refused unless its signer's member sees the whole history and has held the editor role. A snapshot carries no time, so a removed editor is still accepted; closing that needs a signed time in the snapshot format (a protocol change). |
| 6 | Fixed in part | Old entries are swept and handshakes re-check the lock. Lockouts are still kept in memory only, as the threat model says; the stored count is a record and is not read back. |
| 7 | Fixed | The store counts and writes under a per-Fold lock (PostgreSQL) in one step. |

## Findings

### 1. Sign-in timing differs for unknown and existing addresses (Medium)

The design says an unknown address must be indistinguishable from a wrong password, and asks the reviewer to test timing (README, "What we would like tested"). Two places do extra work for only one of the two cases:

- `apps/server/src/modules/auth/auth.service.ts:74`: `recovery?.srpVerifier ?? real?.srpVerifier ?? srp.verifierFrom(stand.verifierSeed)`. The `??` skips `verifierFrom` for a real account, so an unknown address pays for one 4096-bit modular exponentiation that a real account does not. Measured on this machine, one such exponentiation is about **0.5 ms**.
- `auth.service.ts:107`: on a failed proof for a real account the server awaits `store.accounts.recordFailure(...)` (a database write) before answering. An unknown address skips the write, so a wrong guess on a real account answers measurably slower.
- `auth.service.ts:62`: for `credential: 'recovery'` the server makes an extra `store.recovery.get` query only when the account exists.

Attack: send hellos and wrong proofs for a list of addresses and compare response times. Network jitter is larger than 0.5 ms, so it needs many samples per address. The limits (10 hellos per minute per address, back-off on failures) slow this down but do not prevent it.

Fix: do the same work in both cases. Compute the stand-in verifier always (or precompute it per address in a cache), and do an equivalent write or delay for unknown addresses; run the recovery lookup for every address. Then measure with a timing test against a local relay.

### 2. The update signature does not bind the version (Medium)

`scripts/lib/update-signature.mjs` signs `cashfold-update-v1\n<file name>\n<sha512>`. In the app, `update-verify.ts:27-40` builds the signature address from the version and the file name **that the feed names**, and `updater.ts:179` takes the first non-blockmap file of the feed. Nothing checks that the file name contains the feed's version.

Attack (needs write access to a release or the feed, for example a stolen maintainer token): publish a feed that offers version 9.9.9 whose file is an older, genuinely signed installer with a known vulnerability, and upload that installer and its old `.sig` under a `v9.9.9` release. The signature is valid for that name and hash, so the app installs the old build. `allowDowngrade = false` compares only the feed's claimed version.

Fix: include the version in the signed message and have the app check that the installer name contains the feed version; or reject a verified file whose embedded version differs from the offered one.

### 3. `RATE_LIMIT_SCALE` is not validated (Medium)

`apps/server/src/config.ts:50` does `Number(flag(env['RATE_LIMIT_SCALE'], '1'))`. A value like `abc` gives `NaN`, and `rate-limit.ts:28` (`recent.length >= limit * scale`) is then always false: **nothing is ever rate limited**. `0` blocks everything. This is a silent failure of the main brute-force defence on a one-character typo.

Fix: require a finite number of at least 1 (or refuse to start), and consider refusing values other than 1 unless `NODE_ENV` is `test`.

### 4. `trustProxy: true` is unconditional (Low–Medium)

`apps/server/src/app.ts:90` trusts `X-Forwarded-For` from anyone. The self-hosting docs say to put the relay behind a reverse proxy on 127.0.0.1, so this only matters for a deployment that exposes the relay directly: then every per-address limit (`hello:ip`, `proof:ip`) can be bypassed by sending a different header each time. Per-address-hash and per-account limits still hold.

Fix: make it a setting (`TRUST_PROXY`, default off or a hop count) and document it.

### 5. Snapshot authority is not tied to a role (Low–Medium, needs verification)

`packages/crypto/src/snapshot/snapshot-sealer.ts:58-67` accepts a snapshot signed by any device for which `keys.signerPublicKey(fold, dev)` returns a key. The relay only lets roles 1 and 2 upload (`folds.controller.ts:114-119`), but a malicious or compromised relay can serve any validly signed snapshot it has, and the client does not check the signer's role at the snapshot's position. A snapshot replaces the log below it for a new device, and the log is pruned after acknowledgements. I did not read the membership code to see whether `signerPublicKey` already filters by role or removal; this needs checking.

Fix (if confirmed): verify the signer's role at that point from the verified membership log before installing a snapshot.

### 6. Failure tracker and lockouts (Low)

- `rate-limit.ts:49` (`createFailureTracker`): the `failures` map is cleared only on a successful sign-in of a real account, so entries for unknown addresses are never removed. Memory grows without bound, slowly because of the hello limits.
- `auth.service.ts:67`: the lockout is checked only when a handshake starts; handshakes opened earlier can still be completed for up to 60 seconds. Guessing stays capped by the 10-per-minute hello limit.
- Lockout state is in memory; `recordFailure` writes it to the store but `hello` never reads it back, so a restart clears lockouts.

Fix: sweep old entries, re-check the lockout in the proof steps, and read the stored state at start-up.

### 7. Attachment quota race (Low)

`attachments.controller.ts:38` reads the chunk count and then writes in separate steps, so parallel uploads can exceed `FOLD_CHUNK_QUOTA`. The overshoot is bounded by the concurrency, so this is cosmetic.

## What looked good

- The sealed transport frame: AES-256-GCM with a counter nonce, the session id, direction, counter and length bound as additional data, strict replay rejection, idle and absolute expiry, and the inner method and path checked against the real request.
- SRP server: degenerate inputs are refused identically, the secret exponent is used only inside OpenSSL's constant-time code, the proof is compared in constant time, and an exchange is single use.
- Error handling: refusals are a status and a short code, sealed in the session; 500s log only the error type.
- Desktop: sandbox on, context isolation on, no Node in the page, one frozen bridge object, strict argument and answer schemas, sender check on every channel, navigation and window-open lockdown, downloads only from the app's own `blob:` URLs through a save dialog, an `app://` handler that rejects dot segments, encoded separators and anything outside the web root, and a pinned external-link policy.
- CSV export prefixes cells that would start a spreadsheet formula.
- The update signature check hashes the file on disk, not the value from the feed, and refuses anything that is not a valid signature.

## Suggested order

1. Fix 3 and 4 (small configuration changes), then 2.
2. Make sign-in work identical for unknown and existing addresses (1) and add a timing test.
3. Check 5 against the membership code.
4. Keep the README's list of what was not reviewed here with this file, so a later reviewer knows where to start.
