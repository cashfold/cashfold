# External security review package

What a reviewer needs to assess Cashfold: scope, where to look, how to build and run it, and what we already know is weak. The result goes in [status.md](status.md); a release is blocked until that says the review is complete.

## Scope

In scope, in the order we would like them looked at:

1. **Cryptographic protocol and its implementation** (`packages/crypto`, `packages/protocol`): the two-secret key derivation (password + Secret Key, Argon2id), the key set, SRP-6a sign-in and the sealed transport frame, op sealing and signing, Fold-key grants (HPKE), the signed hash-chained membership log, snapshot and attachment sealing, the Recovery Key, backups.
2. **Authentication and authorisation on the service** (`apps/server`): the sign-in handshake and its failure behaviour (indistinguishable unknown address / wrong password / no Recovery Key), session and frame handling, role and epoch checks, account deletion and tombstones, the lookup endpoint.
3. **Sharing and history scope** (`packages/core/src/sharing`): membership-log verification, authorisation of operations by the role in force at their time, key rotation on removal, `from_join` baselines and checkpoints.
4. **Client handling of secrets** (`apps/web/src/worker`, `apps/web/src/adapters`): what lives in the worker, locking, wiping, the credentials blob, quick unlock, the Emergency Kit, how passwords cross the worker boundary.
5. **Web delivery** (`apps/web`): CSP, subresource integrity, the service worker's asset pinning, headers, the reproducible build.
6. **Parsers of untrusted input**: CBOR and wire schemas, CSV import, backups, operations and membership entries from the service or other members.
7. **Desktop shell** (`apps/desktop`, `packages/platform`, release workflows): the main process, the preload bridge and its IPC validation, the `app://` protocol handler and header application, navigation and permission lockdown, the updater and its Ed25519 update-signature check (ADR-0010), installer scripts, and the release workflows (`.github/workflows/release*.yml`, `desktop-*.yml`) including how signing secrets are handled.

Out of scope: the hosting environment of any particular operator, third-party libraries beyond their use here (`@noble/*`, `hash-wasm`, SQLite3 Multiple Ciphers; they are listed in `THIRD_PARTY_NOTICES.md`), denial of service by volume.

## Documents to read first

| Document                                   | What it gives you                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [threat-model.md](../threat-model.md)      | Assets, adversaries, trust boundaries, accepted residual risks                                                             |
| [privacy.md](../privacy.md)                | Exactly what the service can see                                                                                           |
| [ARCHITECTURE.md](../ARCHITECTURE.md)      | §5 keys and sign-in, §6 sync, §7 sharing, §9 service, §10 client hardening                                                 |
| [protocol.md](../protocol.md)              | The generated API reference (from the OpenAPI and CDDL contracts)                                                          |
| `specs/001-secure-finance-core/contracts/` | The wire contracts: `op-envelope.cddl`, `sync-api.openapi.yaml`, `auth-srp.md`                                             |
| [adr/](../adr/)                            | Why the stack is what it is (SQLite cipher, CBOR, Argon2 in WASM, SRP in WASM, the Fold sequence)                          |
| `vectors/`                                 | Frozen known-answer and cross-implementation vectors: `kat/` (primitives), `2skd/`, `srp/`, `ops/`, `cbor/`, `recurrence/` |

## Building and running it

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint
pnpm vitest run                       # unit and property tests
pnpm --filter @cashfold/web test:browser   # OPFS / WASM adapter tests (needs a browser)
pnpm test:e2e                         # end-to-end, with accessibility checks (builds the app and starts a relay)
pnpm --filter @cashfold/server test:integration   # the same service tests against PostgreSQL (needs Docker)
node scripts/build-verify.mjs         # builds the web app twice and checks the files are identical
```

A released build's file hashes are published with the release (`SHA256SUMS.tree` for the web app's files, `SHA256SUMS` for every download, and the digest of the whole tree). Rebuilding the tagged commit with `BUILD_ID=<commit>` must give the same digest.

## What we would like tested

- Can the service, or a member with a lower role, do anything the protocol says it cannot (forge or alter an operation, act above a role, replay, re-order, truncate an attachment, learn existence of an account)?
- Does anything secret leave the worker, or stay reachable after a lock? (There is a plaintext-leak scanner in `e2e/fixtures/leak-scan.ts`.)
- Are the failure responses of sign-in, recovery and lookup truly uniform, including timing?
- Can a hostile file (CSV, backup) or hostile service response cause more than a clean refusal?
- The soundness of the Recovery Key construction (second SRP credential plus keys wrapped under a key derived from it).

## Known weaknesses and open questions

All listed in the threat model under _Residual risks_. Notably: the JavaScript memory-erasure limit; web code delivery; no detection of whole-database rollback; operation and attachment sizes are not padded; the database cipher is not independently audited; QR codes are shown but never scanned; QR/fingerprint comparison is manual.

## Contact

Findings go in [status.md](status.md) as rows, with the reviewer's severity, and the reviewer's own report is linked from there.
