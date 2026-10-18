# Phase 0 Research: Secure Finance Core

Decisions for the TypeScript stack mandated by the constitution (v1.0.1). "ARCH" is [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md). Items marked **VERIFY** depend on library, runtime or browser facts that could not be confirmed offline and MUST be checked (and recorded in an ADR) when the dependency is first used.

## Resolved Technical Context

| Context item | Decision |
|---|---|
| Language | TypeScript strict, ES modules (R-01) |
| Monorepo | pnpm + Turborepo, five packages per the constitution (R-01) |
| Client | Next.js static export, Tailwind, Core Worker (R-09, R-11) |
| Server | NestJS (Fastify) + PostgreSQL + Kysely (R-13) |
| Money | `bigint` value objects (R-04) |
| Local DB | SQLite WASM on OPFS with encryption (R-07) |
| Crypto | WebCrypto + `@noble/*` + WASM for Argon2id and SRP (R-05) |
| Encoding | Deterministic CBOR (R-06) |
| Constitution | Ratified v1.0.1; gates evaluated in plan.md |

## R-01 Monorepo and tooling

- **Decision**: pnpm workspaces with Turborepo. Packages `core`, `crypto`, `protocol`, `apps/web`, `apps/server`. TypeScript project references; strict flags from the constitution; ESLint with `typescript-eslint` and `eslint-plugin-boundaries` for dependency rules; Prettier. Vitest everywhere. Lockfile frozen in CI.
- **Rationale**: Matches the constitution; Turborepo caching keeps CI fast; boundary rules make Clean Architecture mechanical.
- **Alternatives**: Nx (heavier, more opinionated; acceptable but not needed); npm/yarn workspaces (weaker supply-chain ergonomics than pnpm's strict `node_modules`).

## R-02 Domain structure (DDD, Clean Architecture)

- **Decision**: Six bounded contexts under `core/src/<context>/{domain,application,ports}`. Aggregates: `Account`, `Transaction`, `Transfer`, `Category`, `Budget (Envelope)`, `Goal`, `Schedule`, `Fold`, `Membership`. Aggregates reference each other by id. `shared-kernel` holds only value objects and result/error types. Domain code is pure and synchronous.
- **Rationale**: Constitution II/III; pure domain code is the cheapest to test and to run in a worker.
- **Alternatives**: One flat service layer (loses invariants' home); class-heavy OOP with decorators (harder to keep framework-free).
- **Guardrail**: no inheritance hierarchies for domain objects; use discriminated unions and factory functions. Keep aggregates small.

## R-03 CQRS and event sourcing pipeline

- **Decision**: Command handler → aggregate behaviour → field patches → signed, encrypted op appended to `op_log` and projections updated in one SQLite transaction. A pure `apply(op, state)` produces projection changes. Remote ops use the identical path after verification. Domain events are derived locally by diffing projection state around `apply`. Schemas are versioned with upcasters; replays are tested from frozen fixtures. A projection rebuild command replays the log into empty tables and is compared against live tables in a test (ARCH §11.9).
- **Rationale**: Single write path; deterministic projections; convergence follows from order-independent `apply`.
- **Alternatives**: Replicating domain events instead of field patches (breaks field-level merge and exposes intent semantics to merge rules); state-based CRDT snapshots only (no history, harder audit); Automerge/Yjs (generic document CRDTs; weak fit for field-group atomicity and for signed, encrypted per-op patches).
- **Risk**: derived domain events could drift from stored patches. Mitigation: events are never persisted or replicated; only patches are.

## R-04 Money and arithmetic

- **Decision**: `Money` = branded `bigint` minor units plus `CurrencyCode`; constructors validate range `[-2^63, 2^63−1]` and currency exponent. Arithmetic helpers return `Result`. A custom ESLint rule bans `number` types and numeric operators in files tagged as money code; a CI gate greps built output for `Math.*` in money modules. FX uses native `bigint` multiplication/division with half-even rounding (ARCH §3.8). The SQLite adapter binds and reads INTEGER as `bigint`; a test round-trips values above 2^53 and sums them.
- **Rationale**: Constitution VI; native `bigint` is exact and arbitrary precision. Money is not secret-dependent, so constant-time is not required here.
- **Alternatives**: `decimal.js`/`big.js` (decimal strings, different rounding semantics, no fixed wire format); storing strings (slow aggregates).
- **VERIFY**: that the chosen SQLite WASM API exposes 64-bit integers as `bigint` in both `bind` and column reads for the used statement APIs.

## R-05 Cryptography libraries and SRP

- **Decision**:
  - AES-256-GCM, HKDF-SHA256, PBKDF2-HMAC-SHA256 via WebCrypto (non-extractable keys where possible).
  - X25519 (inside HPKE), Ed25519, SHA-256/512 via `@noble/curves` and `@noble/hashes`. HPKE (RFC 9180) is implemented as a thin, test-vector-verified composition of audited primitives inside `crypto`, or via a vetted library if one is available (**VERIFY**).
  - Argon2id via a vetted WASM build (**VERIFY** library, license, and performance; candidates include `hash-wasm` and `argon2-browser`).
  - SRP-6a over RFC 3526 4096-bit group: a small, vetted, constant-time big-integer WASM module on the client for secret-exponent operations; Node's OpenSSL-backed `createDiffieHellman` on the server (ARCH §6.9). Public-value arithmetic and hashing in `bigint`. All behind the `Pake` port.
- **Rationale**: Constitution Technology Constraints and VIII. The split keeps secret-dependent exponentiation off native `BigInt`.
- **Alternatives**: OPAQUE (stronger, avoids SRP group pitfalls; revisit as a future ADR if a mature audited TypeScript implementation exists); a pure-JS constant-time bigint (slow and hard to guarantee).
- **Risk**: custom protocol assembly and WASM supply chain. Mitigations: known-answer and differential tests across client WASM, server OpenSSL and an independent reference; fuzzing parsers; pinned and hashed WASM artifacts; external review in M7.
- **VERIFY**: the Node/OpenSSL constant-time path for a custom 4096-bit prime with `computeSecret`, and that leading-zero stripping is handled (ARCH §6.9).

## R-06 Serialisation: deterministic CBOR

- **Decision**: A TypeScript CBOR encoder/decoder wrapped in `protocol/cbor` that enforces RFC 8949 §4.2 deterministic rules: shortest integers, definite lengths, sorted map keys, no floats, no tags except those listed, `bigint` for 64-bit integers, strict decoding that rejects duplicates, indefinite lengths and non-shortest forms. Frozen byte vectors guard the profile.
- **Rationale**: Signatures and AEAD associated data require byte-stable encodings; zod schemas validate decoded shapes.
- **Alternatives**: JSON (no canonical form, number precision loss); Protocol Buffers (non-canonical across implementations).
- **VERIFY**: select between an existing library configured for canonical output and a small in-house encoder (preferred if the library cannot enforce strict decoding). Decide in ADR-0003.

## R-07 Local database: encrypted SQLite on OPFS

- **Decision**: Official SQLite WASM in the Core Worker with an OPFS VFS. Encryption per ARCH §8.1: first choice, a WASM build of SQLite with a built-in authenticated cipher; fallback, a custom VFS wrapper doing per-page AES-256-GCM with page-number AAD and a write-counter. Schema and views as ARCH §8.2. A benchmark at 50,000 transactions runs in CI in a headless browser.
- **Rationale**: Whole-file encryption plus real SQL for exact aggregations and fast search; works offline.
- **Alternatives**: IndexedDB with application-level encryption of records (poor query and aggregation story, more bespoke code); plain OPFS SQLite (plaintext at rest); wa-sqlite (viable alternative VFS ecosystem; evaluate in the spike).
- **VERIFY**: availability, licence and maturity of the cipher build; OPFS SyncAccessHandle pool VFS behaviour across target browsers; performance of the custom-VFS fallback. Spike output: ADR-0002.

## R-08 Key storage, unlock and sessions

- **Decision**: Per ARCH §5.2: `LVK` derived from the password with Argon2id and a per-device salt protects the stored Secret Key and cached `SRP-x`. Optional quick unlock through WebAuthn PRF wraps `DUK`. Non-extractable Ed25519 device key where WebCrypto supports it. Auto-lock wipes secrets and terminates the worker.
- **Rationale**: Best available protection on the web without hardware key access; honest residual risk is documented.
- **Alternatives**: Storing the Secret Key unencrypted (rejected); requiring a password plus Secret Key on every unlock (poor UX, retained as the fallback when PRF is unavailable).
- **VERIFY**: WebAuthn PRF support matrix and user-gesture requirements.

## R-09 Next.js static export and routing

- **Decision**: `output: 'export'`; the application area uses client components only and no server actions or API routes. Dynamic entities (Fold, Account, Transaction) are addressed with fixed routes plus ids in the URL **fragment or query**, resolved client-side, because static export cannot enumerate dynamic segments for user data. Marketing and docs routes may be statically or server rendered. Environment config (service address) is user-selectable at runtime (FR-099), not baked in.
- **Rationale**: Constitution Technology Constraints; avoids any server rendering of user data; works from any static host and from Tauri.
- **Alternatives**: Plain Vite SPA (simpler, but the constitution fixes Next.js; the marketing site benefits from it); SSR (violates zero-knowledge).
- **Risk**: Next.js features that assume a server (image optimisation, middleware) are unavailable. Mitigation: use only static-export-compatible features; test the export in CI.

## R-10 Web delivery security

- **Decision**: Serve the static export with response headers: strict CSP (see ARCH §10), HSTS, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`/`Embedder-Policy` only if needed. Where headers are impossible (some static hosts), a CSP `<meta>` is the fallback and the self-hosting guide documents the limitation. Subresource Integrity on all scripts; service worker serves only the hashed asset set; build produces an SBOM, provenance attestation and published hashes; builds are reproducible. No third-party scripts, fonts or analytics.
- **Rationale**: Constitution VIII and ARCH §10; the main residual web risk is code delivery, which this reduces but cannot remove.
- **Alternatives**: Third-party CDNs for assets (rejected); relying on the host for headers without documenting.
- **Residual risk statement**: A compromised host can serve malicious code. The Tauri shell (M8) addresses this by bundling signed code.

## R-11 UI, accessibility, internationalisation

- **Decision**: Tailwind CSS with a design-token layer and logical properties for RTL; accessible primitives (e.g., Radix-style headless components, **VERIFY** licence/size) ; axe checks in CI; keyboard-first flows; a static-export-compatible i18n library (**VERIFY**: e.g., Lingui or i18next) with ICU message formats; `Intl` for number, currency and date formatting using integer-to-decimal-string helpers (never converting money to `number`).
- **Rationale**: Spec FR-094/FR-095; constitution makes accessibility part of done.
- **Alternatives**: UI kit with heavy runtime (bundle size); formatting via `Number` (forbidden for money).

## R-12 Browser support and performance budgets

- **Decision**: Target evergreen Chromium, Firefox and Safari releases that support OPFS (SyncAccessHandle), Web Workers, WebCrypto, and WASM. Feature-detect at start and show a clear unsupported-browser message. Set an initial JavaScript budget (target 250 KB gzipped for the shell plus a lazily loaded WASM set) enforced by the CI bundle-size gate; confirm numbers in M0.
- **Reference device (SC-008, FR-096)**: Chromium on a desktop-class machine with 4× CPU throttling stands in for a mid-range phone; the 50,000-transaction benchmark (T187) runs on this profile. Revisit with real-device measurements before release.
- **Rationale**: Constitution Quality Gates require a bundle budget; local-first needs OPFS.
- **VERIFY**: the exact minimum browser versions and the actual WASM sizes.

## R-13 Relay server (NestJS)

- **Decision**: NestJS with the Fastify adapter, modules per ARCH §9.10, DTO validation from `protocol` zod schemas, Kysely for typed SQL against PostgreSQL 16, migrations as ordered SQL files. Ordered delivery via a per-Fold sequence assigned in the push transaction. Object storage port for snapshots and attachments. Rate limits and lockout counters in PostgreSQL (Redis optional for large deployments). Scheduled job for rate publication. Structured logging with redaction.
- **Rationale**: Same language and shared schemas; thin adapter discipline per Constitution III; PostgreSQL is easy to self-host.
- **Alternatives**: Express (less structure); an ORM (hides SQL; less control over transactions and locking); SQLite server (viable later for tiny self-hosts).
- **Open item**: per-Fold sequence mechanism (locked counter row vs. sequence per Fold) to be chosen after load tests.

## R-14 Self-hosting and operator model (FR-099, FR-100)

- **Decision**: One container image and a Compose file (server + PostgreSQL + optional MinIO). Configuration via environment or file: database, listen address, secrets (email MAC key, fake-salt key), rate source or `disabled`, registration policy, storage settings. The hosted instance runs the identical build. Documentation in `docs/self-hosting.md`.
- **Rationale**: Clarified requirement; the relay's simplicity makes auditing and self-hosting realistic.
- **Consequence**: privacy tests also run against a hostile self-hosted server; the Emergency Kit includes the service address (ARCH §5.2).

## R-15 Exchange-rate publication (FR-103)

- **Decision**: The server fetches a configured upstream rate table on a schedule (default 24 h), parses decimal strings, stores one row, and serves it at `GET /v1/rates`. Clients never contact third parties. Custom rates always work.
- **Rationale**: No client fingerprinting by third parties; same behaviour for self-hosters.
- **VERIFY**: upstream source licensing for redistribution.

## R-16 Invitation history scope (FR-102)

- **Decision**: `full` seals all epoch keys to the new member; `from_join` rotates the epoch, seals only the new epoch, republishes the structural baseline and writes balance and rollover checkpoints (ARCH §7.6).
- **Rationale**: Confidentiality comes from the missing key, not server filtering.
- **Risk**: checkpoint consistency. Mitigation: property test that `checkpoint + later entries` equals the full-history balance for every account and date after join.

## R-17 Account deletion, migration, local wipe (FR-100, FR-101, FR-104)

- **Decision**: ARCH §7.7 and §9.9: deletion via fresh SRP proof with a tombstone so devices see `410 Gone` and wipe; removal and departure learned from the signed membership log; migration is client-driven by replaying the op log to a new service.
- **Residual**: a malicious server can suppress the notice; the UI states this.

## R-18 Testing strategy

- **Decision**:
  - Frozen vectors for primitives, 2SKD, SRP, CBOR, FX, recurrence, budgets.
  - fast-check properties: balance identity, sign rules, FX round-trip bound, half-even ties, overflow rejection, envelope carry-over, recurrence clamping, checkpoint equivalence.
  - Convergence simulator in `core/testing`: N replicas, random partitions, duplicates, reordering; identical state and identical `repair()` output.
  - Hostile-server harness: swap, drop, replay, reorder, forge, downgrade.
  - Playwright: each P1/P2 story, offline mode, two-browser sync, plaintext leak scan of OPFS, IndexedDB, console and network, axe checks.
  - Testcontainers for PostgreSQL in server integration tests; contract tests that validate server responses against `protocol` schemas and the OpenAPI file.
  - Coverage floors per the constitution (domain and crypto ≥ 95%, application ≥ 85%).
- **Rationale**: Constitution Quality Gates.

## R-19 CI, supply chain and release

- **Decision**: GitHub Actions: install with frozen lockfile, type-check, lint (boundaries, no-number-in-money), unit/property tests, build (static export and server), Playwright, Testcontainers, dependency audit, licence check, bundle-size gate, SBOM generation, provenance attestation, reproducible-build check. Conventional Commits enforced; squash merge; protected `main`.
- **Rationale**: Constitution Development Workflow and VIII.

## R-22 Offline app shell (service worker)

- **Decision**: A hand-written, minimal service worker in `apps/web/src/sw/` precaches the hashed static export and serves it cache-first. It handles only same-origin static assets, never API traffic, keys or user data. Updates install a new cache version in the background and activate only after the full precache succeeds, then prompt the user to reload. Each cached asset is checked against the build's published hash manifest. An end-to-end test loads the app once, goes offline, reloads and exercises the P1 flows.
- **Rationale**: Without it a reload offline fails, breaking FR-072 and Constitution VII; a small custom worker is easier to audit than a framework-generated one.
- **Alternatives**: Workbox (larger surface, acceptable if audited); no service worker (breaks offline reload).
- **Risk**: stale code and update races. Mitigations: version in the manifest, atomic activation, update test while offline.

## R-23 Email verification and invitation resolution (FR-105 to FR-107)

- **Decision**: A `mail` port with SMTP and log-only adapters. Registration sends a one-time verification link containing no financial content. Lookup by email is available only to verified, signed-in callers, is rate-limited (default 20 per day per account), and returns a public key bundle only for verified discoverable accounts; unknown and non-discoverable addresses return the same `404`. Discoverable defaults to on, is shown at sign-up and is changeable. Non-discoverable users share an invitation code that carries their public key bundle. Invitation notifications name only the sender.
- **Rationale**: Delivers "invite by email" without letting anyone enumerate accounts, and keeps a fallback with no server lookup at all.
- **Alternatives**: Open lookup (enumeration risk); invitation codes only (poor usability for families); server-side invitation storage keyed by email for unregistered users (requires holding pending invitations and is deferred).
- **Open**: discoverable-by-default and rate limits to be revisited after a pilot (ARCH §12 #12).

## R-24 Repository governance as code

- **Decision**: A script `scripts/apply-branch-protection.sh` (using the GitHub API through `gh`) and a documented checklist in `docs/repo-settings.md` set `main` protection: required status checks (all CI gates, including axe), required reviews (two for security-sensitive paths via CODEOWNERS plus a required-reviewers rule), linear history and squash merge, dismiss stale approvals, no force pushes. The script is reviewed but run only by a maintainer.
- **Rationale**: CODEOWNERS alone cannot enforce the constitution's two-reviewer rule.

## R-25 Deleted-record retention

- **Decision**: Tombstones carry their HLC wall time. A deterministic local job purges records deleted more than 30 days ago (rows, field clocks, history) on every device. The service discards its history only after every active device has acknowledged a snapshot taken after the purge point. A restore within the window clears the `deleted` register and propagates normally, including to devices that were offline.
- **Rationale**: Satisfies FR-052 without unbounded tombstone growth, and stays consistent with FR-082 snapshot pruning.
- **Risk**: a device offline for more than 30 days could resurrect a purged record. Mitigation: ops older than the purge horizon for a purged record are quarantined and shown in Needs attention.

## R-20 Future options (not decided)

- Replace SRP with OPAQUE if a mature audited implementation exists (new ADR and ARCH amendment).
- Hybrid post-quantum key sealing for Fold-key grants using the existing algorithm identifiers (ARCH §5.9).
- Tauri 2 shells with OS keychain `KeyStorePort` (M8).
- SQLite-backed relay for the smallest self-hosted deployments.

## R-21 Legal and compliance items to track

- Licence compatibility of every dependency, including WASM modules and any SQLite cipher build.
- Privacy policy listing exactly the routing metadata visible to the server (FR-012).
- Rate-data redistribution terms (R-15).
- Export or crypto-use declarations if required for distribution channels used later (app stores for Tauri builds).
