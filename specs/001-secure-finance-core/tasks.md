---
description: "Task list for Secure Finance Core"
---

# Tasks: Secure Finance Core

**Input**: Design documents from `/specs/001-secure-finance-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md; governed by `.specify/memory/constitution.md` v1.0.1

**Tests**: REQUIRED. The constitution mandates test-first development for domain, crypto and sync code (Quality Gates) and requires known-answer, property, hostile-server, contract, end-to-end and leak-scan suites. Within each phase, test tasks come first and MUST fail before the matching implementation. Implementation tasks for domain, crypto and sync code depend on a preceding failing-test task; reviewers check that the test commit precedes the implementation in the PR history. Every Playwright spec also runs once under an RTL locale and asserts logical layout order (Constitution Workflow: accessibility and i18n are part of done).

**Organization**: Tasks are grouped by user story (spec priorities P1, P2, P3) so each story can be implemented and tested independently. Paths follow the monorepo layout in plan.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: User story label (US1…US9). Setup, Foundational and Polish tasks have none.
- `(depends on Txxx)` marks an explicit dependency beyond phase order.
- `Refs:` lists the spec requirements (FR-/SC-), constitution principles or research items each task serves, so coverage can be traced.

## Path Conventions

`packages/core`, `packages/crypto`, `packages/protocol`, `apps/web`, `apps/server`, `e2e/`, `vectors/`, `deploy/`, `docs/`. Contexts inside `core`: `shared-kernel`, `identity`, `ledger`, `budgeting`, `scheduling`, `sharing`, `sync` (each with `domain/`, `application/`, `ports/`).

## Scope Note

The spec covers the whole v1 product, so this list is large. Recommended first release scope: Phases 1–5 (Setup, Foundational, US1–US3), which is the P1 MVP. Phases 6–7 add P2 (sync and budgets). Phases 8–11 add P3. Requirement coverage is verified by `/speckit-analyze`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo, tooling and CI gates mandated by the constitution (no business logic).

- [X] T001 Create the pnpm workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc` (frozen lockfile, strict peer deps) and `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and ES modules — Refs: Constitution Tech
- [X] T002 [P] Scaffold `packages/core`, `packages/crypto`, `packages/protocol` with `package.json`, `tsconfig.json`, Vitest config and empty `src/index.ts` — Refs: Constitution Tech
- [X] T003 [P] Scaffold `apps/web` as Next.js (App Router) with Tailwind CSS, `output: 'export'` in `apps/web/next.config.ts`, no API routes or server actions, in `apps/web/` — Refs: Constitution Tech; R-09
- [X] T004 [P] Scaffold `apps/server` as NestJS with the Fastify adapter, Kysely and PostgreSQL config in `apps/server/` — Refs: Constitution Tech; R-13
- [X] T005 Configure ESLint (`typescript-eslint`, `eslint-plugin-boundaries`) in `eslint.config.js` encoding the boundary rules from plan.md (domain imports only shared-kernel; `core` never imports `apps/*`; `apps/server` never imports `core`; `crypto` never imports `core`; `protocol` imports nothing) — Refs: Constitution III
- [X] T006 Write the custom ESLint rule `eslint-rules/no-number-in-money.js` banning floating-point literals, `parseFloat`, `Math.*` and `number`-typed values that carry money (identifiers or types named amount, balance, rate, total, minor) in files under `**/money/**`, `**/ledger/**`, `**/budgeting/**`, `**/scheduling/**`, sync patch builders, `packages/protocol` amount fields, `apps/web/src/ui/**` amount components and `shared-kernel` money files; counts, indices and durations remain allowed, with rule tests in `eslint-rules/no-number-in-money.test.js` — Refs: Constitution VI; FR-037
- [X] T007 [P] Configure Vitest workspace and fast-check defaults (seed logging, 1000 runs on CI) in `vitest.workspace.ts`; configure coverage floors (domain and crypto ≥ 95% lines and branches, application ≥ 85%) in `vitest.config.ts` — Refs: Constitution Quality Gates
- [X] T008 [P] Configure Playwright (Chromium, Firefox, WebKit, offline fixtures, axe, an RTL-locale project) in `e2e/playwright.config.ts` and `e2e/fixtures/` — Refs: Constitution Quality Gates
- [X] T009 Create `.github/workflows/ci.yml` running frozen install, type-check, lint, unit/property tests, build (static export and server), Playwright with blocking axe accessibility assertions (WCAG 2.2 AA), Testcontainers, coverage floors, dependency audit, licence check, bundle-size gate, SBOM and provenance steps — Refs: Constitution Quality Gates
- [X] T010 [P] Add the bundle-size gate (`scripts/check-bundle-size.mjs`), licence check (`scripts/check-licenses.mjs`) and a CI grep gate for floating-point/`number` in built money modules (`scripts/check-no-float.mjs`) — Refs: Constitution Quality Gates; FR-037
- [X] T011 [P] Create `docs/adr/0000-template.md` and write `docs/adr/0001-typescript-stack.md` recording the stack decision, the constitution, and the conflicts resolved in ARCHITECTURE.md — Refs: Constitution Workflow
- [X] T012 [P] Add Conventional Commits enforcement (`commitlint.config.js`, git hook config), `.github/pull_request_template.md` (with a mandatory threat-model note section for crypto, auth, sync and sharing changes), `CONTRIBUTING.md`, `SECURITY.md` and `.github/CODEOWNERS` requiring two reviewers for `packages/crypto/`, `packages/core/src/sync/`, `packages/core/src/sharing/` — Refs: Constitution Workflow
- [X] T013 [P] Write `scripts/apply-branch-protection.sh` (GitHub API via `gh`) and `docs/repo-settings.md` setting `main` protection: required status checks including axe, required reviews (two for security-sensitive paths), linear history and squash merge, dismissed stale approvals, no force pushes; the script is reviewed but run only by a maintainer — Refs: Constitution Workflow
- [X] T014 [P] Create `deploy/compose.dev.yml` (PostgreSQL and optional MinIO) and `deploy/Dockerfile.server` skeletons — Refs: FR-099
- [X] T015 [P] Define the static-hosting security headers (CSP per ARCH §10, HSTS, Referrer-Policy, Permissions-Policy) in `apps/web/headers.config.ts` and a CSP `<meta>` fallback generator in `apps/web/scripts/gen-csp-meta.mjs` — Refs: Constitution VIII
- [X] T198 [P] Create the `docs/threat-model.md` stub (assets, trust boundaries, the JavaScript memory-erasure limit, web code-delivery residual risk) so security-sensitive PRs can append their threat-model notes from the start; T192 finalises it — Refs: Constitution VIII; Constitution Workflow

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared kernel, cryptographic primitives, wire format, the CQRS/event-sourcing pipeline, encrypted storage and the Core Worker. No user story can start before this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T016 [P] Write failing property and unit tests for `Money` in `packages/core/src/shared-kernel/money.test.ts`: range `[-2^63, 2^63-1]`, currency exponents 0–8, overflow returns an error never wraps, add/subtract/negate, half-to-even rounding on `.5` ties — Refs: FR-037, FR-038
- [X] T017 Implement branded `bigint` `Money`, `CurrencyCode`, `Rate` (`rate_e12`), `Result` and typed errors in `packages/core/src/shared-kernel/money.ts`, `currency.ts`, `rate.ts`, `result.ts` (depends on T016) — Refs: FR-037, FR-038
- [X] T204 [P] Write failing tests for the currency exponent table (every code has an exponent 0–8, including BTC=8, BHD=3, CLF=4, JPY=0) in `packages/core/src/shared-kernel/currency-table.test.ts` — Refs: FR-038
- [X] T018 [P] Add the vendored currency exponent table (every code exponent 0–8, including BTC=8, BHD=3, CLF=4, JPY=0) in `packages/core/src/shared-kernel/currency-table.ts` (depends on T204) — Refs: FR-038
- [X] T205 [P] Write failing tests for exact decimal-text parsing and formatting (more fractional digits than the currency exponent rejected, no float intermediates, locale separators) in `packages/core/src/shared-kernel/amount-text.test.ts` — Refs: FR-037
- [X] T019 Implement exact decimal-text parsing and formatting for amounts (reject more fractional digits than the currency exponent, no float intermediates, locale separators) in `packages/core/src/shared-kernel/amount-text.ts` (depends on T205) — Refs: FR-037
- [X] T206 [P] Write failing tests for FX conversion, including the round-trip bound `|convert(convert(a, X→Y), Y→X) − a| ≤ 1` for `rate_e12 ≥ 10^6`, USD pivot and range check in `packages/core/src/shared-kernel/fx.test.ts` — Refs: FR-040
- [X] T020 Implement FX conversion `y = round_half_even(a * 10^eY * R_Y / (10^eX * R_X))` with a single `bigint` division, USD pivot, and range check in `packages/core/src/shared-kernel/fx.ts` (depends on T206) — Refs: FR-040
- [X] T207 [P] Write failing tests for `LocalDate` civil-date arithmetic, `daysInMonth` and `Id` (UUIDv4, UUIDv5, UUIDv7) in `packages/core/src/shared-kernel/local-date.test.ts` and `id.test.ts` — Refs: FR-035
- [X] T021 [P] Implement `LocalDate` (integer `yyyymmdd`), civil-date arithmetic, `daysInMonth`, and `Id` (UUIDv4, UUIDv5, UUIDv7) in `packages/core/src/shared-kernel/local-date.ts` and `id.ts` (depends on T207) — Refs: FR-035
- [X] T022 Define crypto ports `Aead`, `Kdf`, `Hkdf`, `Hpke`, `Signer`, `Pake`, `Rng`, `SecretBuf` in `packages/crypto/src/ports/index.ts`; `SecretBuf` has no `toString`/`toJSON`/serialisation and exposes `use(fn)` and `wipe()` — Refs: Constitution VIII
- [X] T023 [P] Write failing known-answer tests with frozen vectors in `vectors/` and `packages/crypto/src/**/*.kat.test.ts` for HKDF-SHA256 (RFC 5869), PBKDF2-HMAC-SHA256, AES-256-GCM (NIST SP 800-38D), Argon2id (RFC 9106 §5.3), X25519 (RFC 7748 §6.1), Ed25519 (RFC 8032 §7.1) and HPKE (RFC 9180 A.1) — Refs: Constitution Quality Gates
- [X] T024 Implement WebCrypto adapters for AES-256-GCM (96-bit random nonce, 128-bit tag), HKDF-SHA256 and PBKDF2 (non-extractable keys where possible) in `packages/crypto/src/adapters/webcrypto/` (depends on T022, T023) — Refs: FR-011
- [X] T025 [P] Implement X25519 and Ed25519 adapters over `@noble/curves` with strict verification and WebCrypto Ed25519 detection in `packages/crypto/src/adapters/noble/` (depends on T022) — Refs: FR-011
- [X] T026 [P] Integrate the vetted Argon2id WASM build with parameter floors `m ≥ 32768 KiB`, `t ≥ 2`, `p ≥ 1` (reject lower, throw `KdfBelowFloor`) in `packages/crypto/src/adapters/argon2-wasm/`; record the library choice, licence and benchmark in `docs/adr/0004-argon2id-wasm.md` — Refs: FR-004, FR-019
- [X] T027 Implement HPKE base mode DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM as a vector-verified composition in `packages/crypto/src/hpke/hpke.ts` (depends on T024, T025); if a vetted library is chosen instead record it in `docs/adr/0005-hpke.md` — Refs: FR-083
- [X] T028 Implement record encryption (`RK = HKDF(FK, salt=record_id, info="cashfold.rec.v1")`, random 96-bit nonce, AAD = CBOR["cashfold.rec.v1", fold_id, record_id, table, epoch, schema]) in `packages/crypto/src/record/record-crypto.ts` with swap/tamper tests in `record-crypto.test.ts` (depends on T024) — Refs: FR-011, FR-018
- [X] T029 [P] Write failing tests and frozen byte vectors for the deterministic CBOR profile (shortest ints, definite lengths, sorted keys, no floats, `bigint` for 64-bit, reject duplicates/indefinite/non-shortest) in `packages/protocol/src/cbor/cbor.test.ts` and `vectors/cbor/` — Refs: FR-018
- [X] T030 Implement the deterministic CBOR encoder/decoder wrapper in `packages/protocol/src/cbor/` and record the library-or-in-house decision in `docs/adr/0003-cbor.md` (depends on T029) — Refs: FR-018
- [X] T031 Implement zod schemas for `OpEnvelope`, `OpPayload`, `KeySet`, `FoldKeyGrant`, `LogEntry`, `Snapshot`, transport `Frame` mirroring `specs/001-secure-finance-core/contracts/op-envelope.cddl` in `packages/protocol/src/schemas/` (depends on T030) — Refs: FR-018
- [X] T032 [P] Add a contract test that validates `specs/001-secure-finance-core/contracts/sync-api.openapi.yaml` against the zod schemas and fails on drift in `packages/protocol/src/schemas/openapi-contract.test.ts`; also generate `docs/protocol.md` from the schemas in CI (`scripts/gen-protocol-docs.mjs`) — Refs: Constitution Quality Gates
- [X] T033 [P] Add structured fuzz tests (fast-check) for the CBOR decoder and op-envelope parser in `packages/protocol/src/cbor/cbor.fuzz.test.ts` and `schemas/op.fuzz.test.ts` — Refs: Constitution Quality Gates
- [X] T034 [P] Write failing tests for the hybrid logical clock (monotonic, receive rule, reject remote wall time > now + 24 h, counter overflow advances wall time) in `packages/core/src/sync/domain/hlc.test.ts` — Refs: FR-079
- [X] T035 Implement HLC `(wall_ms: u48, ctr: u16)` ordered by `(wall, ctr, dev_id)` in `packages/core/src/sync/domain/hlc.ts` (depends on T034, T021) — Refs: FR-074, FR-079
- [X] T036 [P] Write failing property tests for merge in `packages/core/src/sync/domain/merge.test.ts`: LWW per field, add-wins OR-Set, field-group atomicity, tombstone (`deleted` register 0xFFFF) semantics, commutativity/associativity/idempotence over random permutations and duplicates — Refs: FR-073, FR-074, FR-075
- [X] T037 Implement field registers, OR-Set deltas, field groups and tombstones in `packages/core/src/sync/domain/merge.ts` and `field-clock.ts` (depends on T035, T036) — Refs: FR-073, FR-074, FR-075
- [X] T038 Define ports `OpLogStore`, `ProjectionStore`, `ClockPort`, `RandomPort`, `KeyStorePort`, `TransportPort` in `packages/core/src/sync/ports/` — Refs: FR-072
- [X] T039 Implement the pure `apply(op, state)` projection driver, the single write path (command → patches → signed encrypted op → append + project in one transaction) and the rebuild-from-log command in `packages/core/src/sync/application/` (depends on T037, T038, T028, T031) — Refs: FR-072, FR-077, FR-070
- [X] T208 [P] Write failing tests for the upcaster registry using frozen schema-version fixtures in `vectors/ops/` in `packages/core/src/sync/application/upcasters.test.ts` — Refs: Constitution V
- [X] T040 [P] Implement the upcaster registry and replay-fixture test harness (schema versions, frozen fixtures in `vectors/ops/`) in `packages/core/src/sync/application/upcasters.ts` (depends on T208) — Refs: Constitution V
- [X] T209 [P] Write failing tests for the deterministic op-free `repair()` framework and the `NeedsAttention` read model in `packages/core/src/sync/application/repair.test.ts` — Refs: FR-078, FR-097
- [X] T041 Implement the deterministic, op-free `repair()` framework (orphans, category depth, currency mismatch, endpoint deleted) and the `NeedsAttention` read model in `packages/core/src/sync/application/repair.ts` (depends on T209, T039) — Refs: FR-078, FR-097
- [X] T210 [P] Write failing tests for the command bus, query bus, role authorisation and domain-event derivation in `packages/core/src/sync/application/buses.test.ts` — Refs: Constitution IV
- [X] T042 Implement the command bus, query bus, authorisation check (role) and domain-event derivation by projection diff in `packages/core/src/sync/application/buses.ts` (depends on T210, T039) — Refs: Constitution IV
- [X] T043 Build `packages/core/src/testing/`: in-memory ports, N-replica simulator (random partitions, duplicates, reordering) and hostile-server harness (swap, drop, replay, reorder, forge, downgrade); export via subpath `@cashfold/core/testing`, excluded from production bundles (depends on T039) — Refs: SC-004, SC-006
- [X] T044 [P] Add architecture fitness tests in `packages/core/src/architecture.test.ts`: boundary lint passes, `core` imports nothing from React/Next/Nest/DOM/Node-only modules, and replaying the op log into empty projections equals live projections — Refs: Constitution III
- [X] T045 Spike and decide encrypted SQLite on OPFS (built-in cipher WASM build vs custom per-page AES-GCM VFS) with benchmarks at 50,000 rows and tamper/rollback tests; record in `docs/adr/0002-encrypted-sqlite-opfs.md` with code under `apps/web/src/adapters/sqlite-opfs/` — Refs: FR-016
- [X] T046 Implement the `sqlite-opfs` adapter: open with `DBK`, bind and read 64-bit INTEGER as `bigint`, run ordered migrations from `apps/web/src/adapters/sqlite-opfs/migrations/` containing the DDL of ARCH §8.2, with a test that inserts and sums values above 2^53 in `sqlite-opfs.test.ts` (depends on T045) — Refs: FR-016, FR-037
- [X] T047 Write the initial migration files `0001_sync_plumbing.sql` (fold, fold_key, op_log, sync_quarantine, field_clock) and `0002_domain.sql` (account, account_group, account_group_member, category, payee, tag, txn, txn_tag, transfer, budget and scope tables, goal, schedule, fx_rate, import_batch, checkpoint, and the views `ledger_entry`, `account_balance`) in `apps/web/src/adapters/sqlite-opfs/migrations/` (depends on T046) — Refs: FR-072
- [X] T048 Implement the Core Worker entry with typed RPC, single-writer Web Locks, `BroadcastChannel` change notifications, leader proxying and lifecycle (lock terminates the worker) in `apps/web/src/worker/` (depends on T046, T042) — Refs: FR-017
- [X] T211 [P] Write failing tests for the redacting logger (secrets and amounts never appear in output) in `packages/core/src/shared-kernel/logger.test.ts` — Refs: FR-016, FR-098
- [X] T049 [P] Implement the structured logger with type-based redaction (`Redacted<T>`), no content in logs, metrics or traces, in `packages/core/src/shared-kernel/logger.ts` and `apps/web/src/adapters/logger.ts` (depends on T211) — Refs: FR-016, FR-098
- [X] T050 [P] Build the application shell: Tailwind design tokens, logical-property RTL support, route skeleton, unsupported-browser gate (OPFS, WebCrypto, Workers, WASM feature detection), error boundary, i18n setup (static-export compatible, ICU messages) in `apps/web/src/app/` and `apps/web/src/ui/` — Refs: FR-094, FR-095
- [X] T051 [P] Write the failing Playwright test `e2e/offline-reload.spec.ts` (@offline-reload): load once, go offline, reload and reopen the browser, app opens and P1 flows work (FR-072) — Refs: FR-072, SC-007
- [X] T052 Implement the service worker that precaches the hashed static export, serves it cache-first, activates a new version only after a full precache, verifies assets against the hash manifest, and handles no API traffic, in `apps/web/src/sw/service-worker.ts` and `apps/web/src/sw/register.ts` (depends on T051, T050) — Refs: FR-072, SC-007
- [X] T053 [P] Write failing property tests for Fold isolation: a record encrypted for Fold A cannot be decrypted with any key of Fold B, and no projection query without `fold_id` returns cross-Fold rows (FR-021) in `packages/core/src/sync/application/fold-isolation.test.ts` — Refs: FR-021
- [X] T212 [P] Write failing tests for the error catalogue (no amounts, names, notes or key material in any message) in `apps/web/src/ui/errors/catalogue.test.ts` — Refs: FR-098
- [X] T054 [P] Create the user-facing error catalogue (plain-language message keys for every error in contracts/core-api.md, no amounts, names, notes or key material) in `apps/web/src/ui/errors/catalogue.ts` (depends on T212) — Refs: FR-098
- [X] T055 [P] Create the Playwright plaintext-leak scan fixture (seeded names, notes and amounts searched in OPFS files, IndexedDB, console and network captures) in `e2e/fixtures/leak-scan.ts` — Refs: SC-002, SC-015

**Checkpoint**: Foundation ready; user story implementation can begin.

---

## Phase 3: User Story 1 - Create a private account and a first Fold (Priority: P1) 🎯 MVP

**Purpose**: Sign-up with a generated Secret Key, Emergency Kit, lock/unlock, quick unlock and a default Personal Fold. Registration with a relay is a port with an in-memory fake here; the real relay arrives in US4.

- [ ] T056 [P] [US1] Write failing tests for the Secret Key (`C1-AAAAAA-…`, 26 secret chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 5 bits per char, 130 bits entropy, hyphens stripped) in `packages/crypto/src/secret-key/secret-key.test.ts` — Refs: FR-002
- [ ] T057 [P] [US1] Write failing 2SKD tests with a frozen cross-implementation vector, including password `"Å"` as U+212B, U+00C5 and U+0041 U+030A producing identical bytes under NFKD and trimming of leading/trailing whitespace, in `packages/crypto/src/two-skd/two-skd.test.ts` and `vectors/2skd/` — Refs: FR-004, FR-005
- [ ] T058 [P] [US1] Write failing key-set tests (encrypt/decrypt private keys under AUK, AAD binding, wrong-AUK failure) in `packages/crypto/src/keyset/keyset.test.ts` — Refs: FR-002
- [ ] T059 [P] [US1] Write failing tests for the password policy: `password ≥ 12 characters after normalisation and not in a common-password list` (FR-001), in `packages/core/src/identity/domain/password-policy.test.ts` — Refs: FR-001
- [ ] T060 [P] [US1] Write failing Playwright test `e2e/us1-account.spec.ts`: sign up offline, Secret Key shown once, Emergency Kit saved, lock hides all data, financial content is covered when the page is hidden or loses focus (FR-007), unlock restores the empty Personal Fold, no financial content or secrets observed by the leak scan, axe assertions pass — Refs: FR-001, FR-003, FR-007
- [ ] T061 [P] [US1] Write failing tests that the password buffer is wiped right after key derivation (including on error paths), derived keys (`K_pw`, `K_sk`, `AUK`) are wiped after use, and `lock()` wipes every `SecretBuf` and terminates the worker (FR-017) in `packages/crypto/src/two-skd/wipe.test.ts` and `packages/core/src/identity/application/lock.test.ts` — Refs: FR-017
- [ ] T062 [US1] Implement Secret Key generation and parsing in `packages/crypto/src/secret-key/secret-key.ts` (depends on T056, T022) — Refs: FR-002
- [ ] T063 [US1] Implement 2SKD (`S_eff = HKDF(salt=lower(email), IKM=salt16, info="cashfold.2skd.v1|salt|"+purpose)`, `K_pw = Argon2id(NFKD(trim(password)), S_eff)` or PBKDF2 650,000 iterations fallback, `K_sk = HKDF(salt=account_id, IKM=secret26, info="cashfold.2skd.v1|sk|"+purpose+"|C1")`, `K = K_pw XOR K_sk`, purposes `auk` and `srp`) in `packages/crypto/src/two-skd/two-skd.ts` (depends on T057, T026, T062) — Refs: FR-004, FR-005
- [ ] T064 [US1] Implement the personal key set (X25519 and Ed25519 key pairs, private keys under AUK with AES-256-GCM, `encrypted_by: "mp"`) in `packages/crypto/src/keyset/keyset.ts` (depends on T058, T063) — Refs: FR-002
- [ ] T065 [US1] Implement the Identity & Access domain (`UserAccount`, `Device`, state `Draft → Registered → Active`, `KeySet` references) and ports `RegistrationPort`, `CredentialStorePort` in `packages/core/src/identity/domain/` and `ports/` — Refs: FR-001
- [ ] T066 [US1] Implement the password policy and common-password list check in `packages/core/src/identity/domain/password-policy.ts` (depends on T059) — Refs: FR-001
- [ ] T067 [US1] Implement local secret storage: `device_salt`, `LVK = Argon2id(password, device_salt)`, Secret Key and cached `SRP-x` encrypted under `LVK` with AAD `cashfold.dukblob.v1`, plus the non-extractable device signing key, in `apps/web/src/adapters/keystore-idb/` (depends on T063) — Refs: FR-006
- [ ] T068 [US1] Implement optional quick unlock with WebAuthn PRF wrapping `DUK`, feature detection and password-only fallback in `apps/web/src/adapters/keystore-idb/quick-unlock.ts`; password always required after browser restart — Refs: FR-006
- [ ] T070 [US1] Implement the `Fold` aggregate and commands create/rename/delete with `name ≤ 80 chars`, `epoch u32 ≥ 1`, `base_currency` valid code, and the confirmation consequence message (FR-020…FR-022) in `packages/core/src/sharing/domain/fold.ts` and `application/fold-commands.ts` — Refs: FR-020, FR-021, FR-022
- [ ] T069 [US1] Implement the `createAccount` command (generate Secret Key, derive AUK, create key set, generate device key, create default *Personal* Fold, register through `RegistrationPort`) in `packages/core/src/identity/application/create-account.ts` (depends on T065, T064, T066, T070, T042) — Refs: FR-001, FR-002, FR-020
- [ ] T071 [US1] Implement `unlock`, `unlockQuick` and `lock` (derive `DBK = HKDF(LVK or DUK, salt=device_id, info="cashfold.db.v1")`, hand it to the SQLite adapter, wipe all `SecretBuf`s on lock, close database, terminate the worker), auto-lock policy (timeout default 5 min, hidden-tab grace default 1 min, `pagehide`), and the neutral content cover on `visibilitychange`/`blur`/`pagehide`/`freeze` (FR-007), in `packages/core/src/identity/application/lock.ts`, `apps/web/src/worker/lifecycle.ts` and `apps/web/src/ui/privacy-cover.tsx` (depends on T061); local escalating delay after repeated wrong passwords, with a configurable inactivity period setting (FR-006) — Refs: FR-007, FR-017
- [ ] T072 [P] [US1] Implement the Emergency Kit generator (account id, email, server address, Secret Key, blank password field, QR of the fragment-form add-device URL `https://<app-host>/add#email=…&server=…&key=C1-…`) as a printable/downloadable document in `apps/web/src/ui/emergency-kit/` (select and record a vetted QR library, VERIFY licence); any clipboard copy of the Secret Key requires an explicit user action and is cleared after 60 seconds (FR-016) — Refs: FR-003
- [ ] T073 [US1] Build the sign-up, sign-in, lock and unlock screens, a visible discoverable-by-email choice at sign-up (FR-106), Secret Key display-once screen with warning, password-strength meter and weak-password explanation, Emergency Kit reminder banner, and quick-unlock and auto-lock period settings in `apps/web/src/app/(auth)/` and `apps/web/src/ui/auth/` — Refs: FR-001, FR-003, FR-106
- [ ] T074 [P] [US1] Build the Fold list, create/rename/delete (with consequence confirmation) screens in `apps/web/src/app/folds/` and `apps/web/src/ui/folds/` and the per-Fold base-currency picker (FR-039) — Refs: FR-020, FR-022; FR-039
- [ ] T075 [P] [US1] Add the service-address selector (hosted default read from the build-time setting `NEXT_PUBLIC_DEFAULT_SERVER` documented in `apps/web/.env.example`, user-changeable, never hard-coded; FR-099) in `apps/web/src/ui/settings/server-address.tsx` and `packages/core/src/identity/application/server-address.ts` — Refs: FR-099

**Checkpoint**: User Story 1 is fully functional and independently testable (SC-001, SC-015 partial).

---

## Phase 4: User Story 2 - Track accounts, categories and transactions offline (Priority: P1)

**Purpose**: Accounts, groups, categories, payees, tags, transactions, balance adjustment, deletion/restore, search and reports basics, all offline.

- [ ] T076 [P] [US2] Write failing aggregate tests for `Account` in `packages/core/src/ledger/domain/account.test.ts`: kinds checking|savings|credit_card|cash|goal|loan, `name 1–80 chars`, currency immutable once any entry exists, `credit_limit_minor` only for credit_card and loan, archived accepts no new entries, goal accepts only transfers and adjustments — Refs: FR-023, FR-024, FR-025, FR-029
- [ ] T077 [P] [US2] Write failing tests for `Category` (direction 1 expense|2 income; `parent_id` null or a root category of the same direction; depth ≤ 2; no cycles) in `packages/core/src/ledger/domain/category.test.ts` — Refs: FR-047
- [ ] T078 [P] [US2] Write failing tests for `Transaction` in `packages/core/src/ledger/domain/transaction.test.ts`: `expense ⇒ amount_minor < 0`, `income ⇒ amount_minor > 0`, adjustment any non-zero, currency equals account currency, `tag_ids ≤ 8`, `note ≤ 2,000`, `place` lat/lon as 1e-7 integers, status pending|posted|void, `local_date` derived from `(utc_ms, tz_offset_min)` — Refs: FR-030, FR-031, FR-032
- [ ] T079 [P] [US2] Write failing property tests `balance = opening + Σ posted entries ≤ as_of` over 10,000 random sequences including values above 2^53, adjustment-to-target, pending excluded, projection equals recomputation, in `packages/core/src/ledger/application/balance.property.test.ts` — Refs: FR-028, FR-033, FR-070
- [ ] T080 [P] [US2] Write failing tests for filter/search/sort (account, category, payee, tag, amount range, date range, status, text; local only) in `packages/core/src/ledger/application/queries/search.test.ts` — Refs: FR-036
- [ ] T081 [P] [US2] Write failing Playwright test `e2e/us2-ledger.spec.ts` in offline mode (including reload while offline) with axe assertions: create two accounts, ten transactions, edit/delete/restore, balance exactness, too-many-decimals rejected, archive hides account, third category level rejected; destructive actions require confirmation (FR-051) — Refs: FR-023, FR-030, FR-072
- [ ] T082 [P] [US2] Write failing tests for deleted-record retention: restorable within 30 days on every device including one offline during the delete, purged after 30 days by a deterministic job keyed on the tombstone HLC wall time, late ops for purged records quarantined and shown in Needs attention, in `packages/core/src/ledger/application/retention.test.ts` (FR-052) — Refs: FR-052
- [ ] T083 [US2] Implement the `Account` aggregate, `AccountGroup`, commands (create, update, archive/unarchive, exclude from net worth, delete cascading its transactions and transfers after a warning that states what is removed) in `packages/core/src/ledger/domain/account.ts` and `application/account-commands.ts` (depends on T076) — Refs: FR-023, FR-024, FR-025, FR-026, FR-027
- [ ] T084 [P] [US2] Implement `Category`, the default category set from `specs/001-secure-finance-core/contracts/default-categories.md` (two-level, income and expense, ids `UUIDv5(fold_id, key)`), merge categories (reassign references), `Payee` and `Tag` in `packages/core/src/ledger/domain/category.ts`, `payee.ts`, `tag.ts` and `application/` commands (depends on T077) — Refs: FR-047, FR-048, FR-049, FR-050
- [ ] T085 [US2] Implement the `Transaction` aggregate and commands add/update/delete/restore (Recently deleted ≥ 30 days), pin, refund flag, status transitions `Pending → Posted → Void`, `Void → Posted`, attachment reference, last-changed device and time (FR-053) in `packages/core/src/ledger/domain/transaction.ts` and `application/transaction-commands.ts` (depends on T078, T083, T084) — Refs: FR-030, FR-031, FR-032, FR-033, FR-052, FR-053
- [ ] T086 [US2] Implement the retention purge job (rows, field clocks, history after 30 days; offline-device restore path; quarantine of late ops) in `packages/core/src/ledger/application/purge-deleted.ts` (depends on T082, T085) — Refs: FR-052
- [ ] T087 [US2] Implement `adjustBalance` (creates `direction=0` entry for `target − balance(account, date)`, marked as adjustment) in `packages/core/src/ledger/application/adjust-balance.ts` (depends on T085) — Refs: FR-034
- [ ] T088 [US2] Implement ledger projections and the `ledger_entry`/`account_balance` read models plus `accountBalance`, `netWorth`, `listTransactions`, `search`, `spendingByCategory`, `incomeVsExpense`, `dayEndBalances`, `recentlyDeleted`, `needsAttention` queries, honouring `adjustments_as_income_expense` and `transfers_as_income_expense` options, in `packages/core/src/ledger/application/projections/` and `queries/` (depends on T079, T080, T085) — Refs: FR-028, FR-035, FR-069, FR-071
- [ ] T213 [P] [US2] Write failing tests for the ledger repair rules (orphan transaction, category depth/cycle, currency mismatch, `expense` with positive amount) in `packages/core/src/ledger/application/repair-rules.test.ts` — Refs: FR-078
- [ ] T089 [P] [US2] Register repair rules for orphan transaction, category depth/cycle, currency mismatch and `expense` with positive amount in `packages/core/src/ledger/application/repair-rules.ts` (depends on T213, T041) — Refs: FR-078
- [ ] T095 [P] [US2] Write failing tests for base-currency snapshot (`base_amount_minor` frozen at entry using the nearest prior `as_of`, `fx_rate_id` stored, explicit `revalue` re-snapshots) in `packages/core/src/ledger/application/fx-snapshot.test.ts` — Refs: FR-041
- [ ] T214 [P] [US2] Write failing tests for `ExchangeRate` (`rate_e12 > 0`, source, uniqueness on `(quote, as_of)`, nearest-prior lookup, custom rates) in `packages/core/src/ledger/domain/exchange-rate.test.ts` — Refs: FR-042
- [ ] T098 [P] [US2] Implement `ExchangeRate` records, custom rates and nearest-prior lookup in `packages/core/src/ledger/domain/exchange-rate.ts` and `application/rate-commands.ts` (`rate_e12 > 0`, `source ∈ {service, custom}`, unique on `(quote, as_of)`) (depends on T214) — Refs: FR-042
- [ ] T099 [US2] Implement base-amount snapshotting on transaction entry/edit and the `revalue` command in `packages/core/src/ledger/application/fx-snapshot.ts` (depends on T095, T098, T020, T085) — Refs: FR-041
- [ ] T090 [US2] Build account list/detail, group and ordering, create/edit/archive screens, amount input component using exact decimal text parsing, in `apps/web/src/app/accounts/` and `apps/web/src/ui/ledger/` — Refs: FR-024, FR-037
- [ ] T091 [US2] Build the transaction list (grouped by `local_date`), add/edit form (category, payee, tags, note, place, attachment field shown only once attachments are available in US9, refund, pin, status), filters/search, Recently deleted, balance-adjustment dialog, and the Needs-attention area in `apps/web/src/app/transactions/`, `apps/web/src/ui/ledger/` (depends on T090); show when and on which device each record was last changed (FR-053); confirmation dialogs for destructive actions (FR-051) — Refs: FR-030, FR-036, FR-051, FR-097; FR-053
- [ ] T092 [P] [US2] Build the dashboard (balances, net worth in the base currency, period income minus expense, spending by category/tag, trend, day-end balance, selectable periods including all time and custom) in `apps/web/src/app/dashboard/` (depends on T088, T099) — Refs: FR-069
- [ ] T199 [US2] Build the category tree manager (two-level, income and expense, icon, colour, order, archive), payee and tag management with derived usage counts, and the merge flow for categories, payees and tags in `apps/web/src/app/categories/` and `apps/web/src/ui/ledger/` (depends on T084, T090) — Refs: FR-047, FR-049, FR-050

**Checkpoint**: User Stories 1 and 2 work independently (SC-003 partially demonstrated).

---

## Phase 5: User Story 3 - Move money between accounts and currencies (Priority: P1)

**Purpose**: Atomic transfers, cross-currency amounts, FX snapshots and custom rates.

- [ ] T093 [P] [US3] Write failing tests for `Transfer` in `packages/core/src/ledger/domain/transfer.test.ts`: `from_account_id ≠ to_account_id`, both amounts `> 0`, same-currency amounts equal, cross-currency amounts both explicit, single field group `{from_account_id, to_account_id, from_amount_minor, to_amount_minor, fx_rate_id}`, edit/delete/restore affects both sides — Refs: FR-043, FR-044, FR-045
- [ ] T094 [P] [US3] Write failing tests that concurrent edits of a transfer on two replicas converge to one whole version of the amount group (never half applied) using the simulator in `packages/core/src/ledger/application/transfer.convergence.test.ts` — Refs: FR-045, FR-075
- [ ] T096 [P] [US3] Write failing Playwright test with axe assertions `e2e/us3-transfers.spec.ts`: USD 100.00 → EUR 91.37 exact on both sides, edit/delete both sides together, same-account rejected, transfers excluded from income/expense unless the toggle is on, goal account progress — Refs: FR-043, FR-046
- [ ] T097 [US3] Implement the `Transfer` aggregate and commands (add, update, delete, restore) emitting one op with the amount group register in `packages/core/src/ledger/domain/transfer.ts` and `application/transfer-commands.ts` (depends on T093, T094, T085) — Refs: FR-043, FR-044, FR-045
- [ ] T100 [US3] Extend projections so transfers materialise as `out`/`in` ledger entries and honour the transfers toggle in `packages/core/src/ledger/application/projections/transfer-entries.ts` (depends on T097, T088) — Refs: FR-046
- [ ] T215 [P] [US3] Write failing tests for the repair rule "transfer endpoint deleted ⇒ hidden and flagged" in `packages/core/src/ledger/application/repair-rules.transfer.test.ts` — Refs: FR-078
- [ ] T101 [P] [US3] Register the repair rule "transfer endpoint deleted ⇒ hidden and flagged" in `packages/core/src/ledger/application/repair-rules.ts` (depends on T215) — Refs: FR-078
- [ ] T102 [US3] Build the transfer form (both amounts, same-currency auto-mirroring, rate helper that never overrides entered amounts), edit/delete, FX snapshot indicator, custom-rate manager, and revalue action in `apps/web/src/ui/ledger/transfer/` and `apps/web/src/app/transfers/` — Refs: FR-044, FR-042

**Checkpoint**: All P1 stories (US1–US3) are independently functional. This is the MVP.

---

## Phase 6: User Story 4 - Keep data in sync across my devices (Priority: P2)

**Purpose**: SRP sign-in, the NestJS relay, op push/pull, merge on the client, device enrolment and revocation, rate publication and self-host packaging.

- [ ] T103 [P] [US4] Write failing SRP tests in `packages/crypto/src/pake/srp.test.ts` and `apps/server/src/modules/auth/srp.test.ts`: fixed `a`,`b` vectors for `A,B,u,S,K,M1,M2` over the RFC 3526 4096-bit group with SHA-256, negative vectors (`A=0`, `A=N`, `B=0`, `u=0`, truncated/oversized), and 100 random exchanges cross-checked between client WASM, server OpenSSL path and an independent reference in `vectors/srp/` — Refs: FR-013
- [ ] T104 [P] [US4] Write failing test that recomputes the RFC 3526 4096-bit prime from `2^4096 − 2^4032 − 1 + 2^64·(⌊2^3966·π⌋ + 240904)` and checks safe-prime properties in `packages/crypto/src/pake/group.test.ts` — Refs: FR-013
- [ ] T105 [P] [US4] Write failing Testcontainers integration and contract tests for push (idempotent on `(fold, op)`, signature check, `seq` monotonic, ≤ 256 ops and 4 MiB), pull (`after`, `limit ≤ 500`), unknown-email fake salt indistinguishability, rate limiting and lockout in `apps/server/test/` — Refs: FR-014, FR-077
- [ ] T106 [P] [US4] Write failing hostile-server tests (blob swap between records/folds, dropped op via `seq` gap, replayed frame, reordered ops, forged membership entry, downgraded KDF below floor) in `packages/core/src/sync/application/hostile.test.ts` using the harness (T043) — Refs: FR-018, FR-080
- [ ] T107 [P] [US4] Write failing Playwright two-browser tests with axe assertions `e2e/us4-sync.spec.ts`: enrol a second browser from the fragment link, 5-second propagation measured on the reference connection from SC-005 (150 ms round-trip latency, 5 Mbit/s) over at least 100 changes (95th percentile), disjoint-field offline edits both preserved, same-field edit converges, interrupted sync resumes without duplicates, tampered update rejected with a notice, revoked device wipes and cannot sync — Refs: FR-076, SC-005
- [ ] T108 [US4] Vendor the RFC 3526 4096-bit group constants with build-time verification in `packages/crypto/src/pake/group.ts` (depends on T104) — Refs: FR-013
- [ ] T109 [US4] Select, build and pin a vetted constant-time big-integer WASM module for client secret-exponent operations with hash-pinned artifact and differential tests against OpenSSL; record in `docs/adr/0006-srp-wasm.md`; code in `packages/crypto/src/adapters/srp-wasm/` — Refs: FR-013
- [ ] T110 [US4] Implement the client `Pake` (SRP-6a: `x` from 2SKD purpose `srp`, `v = g^x`, `A`, `M1`, `M2` verification, degenerate-value rejection, transcript-bound session key) in `packages/crypto/src/pake/srp-client.ts` (depends on T103, T108, T109, T063) — Refs: FR-013
- [ ] T111 [US4] Implement the server SRP using Node `crypto.createDiffieHellman(N, g)` for secret-exponent operations with 512-byte left padding, plus a regression test for the constant-time path, in `apps/server/src/modules/auth/srp-server.ts` (depends on T103, T108) — Refs: FR-013, FR-014
- [ ] T112 [US4] Implement transport framing (`K_c2s`, `K_s2c` via HKDF over the transcript hash, nonce = 4 zero bytes ‖ u64 counter, AAD binds session, direction, counter, length; reject non-increasing counters; session expiry 30 min idle / 24 h absolute) in `packages/crypto/src/transport/frame.ts` and `apps/server/src/modules/auth/frame.guard.ts` (depends on T110) — Refs: FR-015
- [ ] T113 [US4] Implement NestJS `auth` and `devices` modules (`/auth/hello`, `/auth/proof-a`, `/auth/proof-m1`, `/accounts`, `/accounts/me/keyset`, `/devices`) with server-side rate limiting, deterministic fake salt via keyed MAC, uniform rejection, registration policy (open or invite-only from configuration), and Kysely migrations `apps/server/migrations/0001_accounts.sql` per ARCH §9.7 in `apps/server/src/modules/auth/` and `devices/` (depends on T111, T112) — Refs: FR-014, FR-010
- [ ] T114 [P] [US4] Write failing tests for email verification (one-time hashed token, expiry, single use, sharing features blocked until verified, verification disabled by configuration reported to the client) and for the `mail` port (SMTP and log-only adapters, messages contain no financial content) in `apps/server/test/mail.test.ts` — Refs: FR-105
- [ ] T115 [US4] Implement the NestJS `mail` module with SMTP and log-only adapters, `POST /accounts/verify-email`, `PUT /accounts/me/discoverable`, `email_verification` table and the `email_verified_at`/`discoverable` columns in migration `apps/server/migrations/0005_email.sql` (FR-105, FR-106) (depends on T114, T113) — Refs: FR-105, FR-106
- [ ] T116 [US4] Implement NestJS `folds`, `ops`, `snapshots` modules (`/folds`, `/folds/{id}/ops` POST/GET, `/folds/{id}/stream` WebSocket, snapshot PUT/GET), per-Fold `server_seq` assigned in the push transaction, signature and membership authorisation guards, and migration `0002_folds_ops.sql` in `apps/server/src/modules/folds/`, `ops/`, `snapshots/` (depends on T113) — Refs: FR-072, FR-080
- [ ] T117 [P] [US4] Implement the `rates` module: scheduled fetch from the configured upstream (decimal-string parsing, no floats), `rate_table` migration `0003_rates.sql`, `GET /v1/rates` unauthenticated and non-personalised, `disabled` mode returning 404, in `apps/server/src/modules/rates/` (FR-103) — Refs: FR-103
- [ ] T118 [P] [US4] Implement client-encrypted signed snapshots and server pruning only after every active device has acknowledged a verified checkpoint, including the retention-purge point (FR-082, FR-052) in `packages/core/src/sync/application/snapshot.ts` and `apps/server/src/modules/snapshots/prune.job.ts` — Refs: FR-082, FR-052
- [ ] T119 [US4] Implement the sync client use cases (push pending ops in `dev_seq` order, pull from `pull_cursor`, apply in `server_seq` order, verify signature then AEAD tag then schema, quarantine failures, `seq` gap detection and re-request, HLC sanity window, resume after interruption, idempotent re-delivery) in `packages/core/src/sync/application/sync-client.ts` (depends on T106, T039) — Refs: FR-072, FR-077, FR-080
- [ ] T120 [US4] Replace the in-memory `RegistrationPort` with the real relay registration and sign-in flow (SRP, fetch and decrypt key set, register device signing key) in `apps/web/src/adapters/transport/registration.ts` and `packages/core/src/identity/application/sign-in.ts` (depends on T110, T113) — Refs: FR-004, FR-013
- [ ] T121 [US4] Implement new-device enrolment (fragment add-link parsing, fragment removed from address bar and history after reading, password prompt, SRP-x and AUK derivation, key set decrypt, device key registration) and device list/rename/revoke in `packages/core/src/identity/application/enrol-device.ts` and `apps/web/src/ui/devices/` (depends on T120) — Refs: FR-004, FR-010
- [ ] T200 [US4] Register an existing local-only account with the relay on first sync (create the SRP verifier from the 2SKD `srp` purpose, upload the key set, register the device key, push the existing op log, choose the service address) in `packages/core/src/identity/application/register-existing.ts` (depends on T120, T116) — Refs: FR-004, FR-013, FR-099
- [ ] T216 [P] [US4] Write failing tests for rejecting server-supplied KDF parameters below the floors (`KdfBelowFloor`) in `packages/core/src/identity/application/kdf-policy.test.ts` — Refs: FR-019
- [ ] T122 [P] [US4] Reject any server-supplied KDF parameters below the floors and surface `KdfBelowFloor` (FR-019) in `packages/core/src/identity/application/kdf-policy.ts` (depends on T216) — Refs: FR-019
- [ ] T217 [P] [US4] Write failing tests for `refreshRates` (reads only the user's service, stores `as_of`, works offline from last values) in `packages/core/src/ledger/application/refresh-rates.test.ts` — Refs: FR-042, FR-103
- [ ] T123 [P] [US4] Implement `refreshRates` reading only the user's service `GET /v1/rates`, storing rates with `as_of`, working offline from last values, in `packages/core/src/ledger/application/refresh-rates.ts` and `apps/web/src/adapters/transport/rates.ts` (depends on T217) — Refs: FR-042, FR-103
- [ ] T124 [P] [US4] Implement sync status (synced, syncing, offline, error), last-synced time per Fold, and the extended Needs-attention items (quarantined ops, rejected changes, clock problems) in `packages/core/src/sync/application/status.ts` and `apps/web/src/ui/sync/` — Refs: FR-081, FR-097
- [ ] T218 [P] [US4] Write failing tests for quarantine of ops stamped beyond the 24 h safety window in `packages/core/src/sync/application/clock-guard.test.ts` — Refs: FR-079
- [ ] T125 [P] [US4] Implement quarantine for ops with wall time beyond the 24 h safety window with a user-visible notice in `packages/core/src/sync/application/clock-guard.ts` (FR-079) (depends on T218) — Refs: FR-079
- [ ] T126 [US4] Package the relay for self-hosting: production `deploy/Dockerfile.server`, `deploy/compose.yml` (server, PostgreSQL, optional MinIO), `deploy/example.config.yml` (database, listen address, secrets, rate source or `disabled`, registration policy, storage), and write `docs/self-hosting.md` (FR-099) — Refs: FR-099
- [ ] T127 [US4] Build the sign-in-on-new-device flow, device management, sync status indicator, conflict-resolved notice, and tamper-rejected notice screens in `apps/web/src/app/devices/` and `apps/web/src/ui/sync/` — Refs: FR-010, FR-081
- [ ] T201 [US4] Build the client email-verification flow (request, enter token, status banner), the notice shown when a self-hosted service disables verification (invitations then rely on out-of-band identity checks), and the discoverable-by-email setting changeable at any time, in `apps/web/src/ui/settings/` and `packages/core/src/identity/application/email-verification.ts` (depends on T115, T120) — Refs: FR-105, FR-106

**Checkpoint**: P2 sync works across browsers and against a self-hosted relay (SC-004, SC-005, SC-006).

---

## Phase 7: User Story 5 - Plan with envelope budgets (Priority: P2)

**Purpose**: Envelope and income budgets with rollover policies, spend velocity and consistent recalculation.

- [ ] T128 [P] [US5] Write failing tests for `Budget` in `packages/core/src/budgeting/domain/budget.test.ts`: `limit_minor ≥ 0`, `allocation_minor ≥ 0` (default = limit), `period_interval ≥ 1`, direction 1 expense|2 income, scope (account set or group, category set, tag set, `include_transfers`), rollover 0 none|1 carry_positive|2 carry_all — Refs: FR-054, FR-055, FR-056
- [ ] T129 [P] [US5] Write failing property and vector tests for `BudgetPeriod`: `carry_in` per policy, `available = carry_in + allocation − spent`, refunds reduce spent, currency conversion exact, and recomputation after editing/deleting/restoring old transactions on two replicas gives identical results, in `packages/core/src/budgeting/application/budget-period.test.ts` and `vectors/budgets/` — Refs: FR-057, FR-059, FR-061
- [ ] T130 [P] [US5] Write failing tests for velocity: `burn = round_half_even(spent / d_elapsed)`, `projected = round_half_even(spent × d_total / d_elapsed)`, `overspend ⇔ projected > carry_in + allocation`, `d_elapsed ≥ 1`, income budgets never warn, in `packages/core/src/budgeting/application/velocity.test.ts` — Refs: FR-058
- [ ] T131 [P] [US5] Write failing Playwright test with axe assertions `e2e/us5-budgets.spec.ts` for the Groceries scenario (300.00, carry positive, spend 120.00, month two shows 480.00; none shows 300.00; carry all after overspend reduces month two) using the test clock — Refs: FR-056, FR-057
- [ ] T132 [US5] Implement the `Budget` aggregate and commands create/update/delete with scope tables in `packages/core/src/budgeting/domain/budget.ts` and `application/budget-commands.ts` (depends on T128, T083, T084) — Refs: FR-054, FR-055, FR-056
- [ ] T133 [US5] Implement derived `BudgetPeriod` computation (never stored) from projections in `packages/core/src/budgeting/application/budget-period.ts` (depends on T129, T132, T088, T020) — Refs: FR-057, FR-059, FR-061
- [ ] T134 [P] [US5] Implement velocity and overspend warning in `packages/core/src/budgeting/application/velocity.ts` (depends on T130, T133) — Refs: FR-058
- [ ] T135 [P] [US5] Register the rule "concurrent rollover change ⇒ LWW and recompute" and budget-scope orphan handling in `packages/core/src/budgeting/application/repair-rules.ts` — Refs: FR-078
- [ ] T136 [US5] Build budget list with display modes (spent, limit, available, spent/limit), create/edit forms (period, scope, rollover), detail view with carry-in, allocation, spent, available, daily average, projection and warning, in `apps/web/src/app/budgets/` and `apps/web/src/ui/budgets/` — Refs: FR-060

**Checkpoint**: US5 is independently testable on top of US1–US3.

---

## Phase 8: User Story 6 - Automate recurring transactions (Priority: P3)

**Purpose**: Schedules with drift-free occurrences, convergent materialisation, confirmation, reminders and projected balances.

- [ ] T137 [P] [US6] Write failing vector and property tests for occurrence projection anchored to `begin` (31 Jan monthly ⇒ 28/29 Feb, 31 Mar, 30 Apr; yearly 29 Feb ⇒ 28 Feb in non-leap years; weekly; daily; interval ≥ 1; end date) in `packages/core/src/scheduling/domain/occurrence.test.ts` and `vectors/recurrence/` — Refs: FR-063
- [ ] T138 [P] [US6] Write failing convergence tests that three replicas offline across a due date produce exactly one transaction per occurrence (UUIDv5 of `(schedule_id, n)`), in `packages/core/src/scheduling/application/materialise.convergence.test.ts`; at least 500 randomised trials on 3 replicas including month-end and leap-day schedules (SC-012) — Refs: FR-064
- [ ] T139 [P] [US6] Write failing Playwright test with axe assertions `e2e/us6-schedules.spec.ts`: confirmation-required occurrence stays pending and excluded from posted balances, automatic posting on the due date, projected balances include future occurrences to the horizon (default 90 days), editing affects only future occurrences, finish stops new occurrences — Refs: FR-062, FR-065, FR-066
- [ ] T140 [US6] Implement the `Schedule` aggregate (kind transaction|transfer, template, `begin ≤ end`, unit day|week|month|year, `interval ≥ 1`, `requires_confirmation`, `reminder_min`, `completed_utc_ms`) and `Active → Completed` in `packages/core/src/scheduling/domain/schedule.ts` and `application/schedule-commands.ts` — Refs: FR-062
- [ ] T141 [US6] Implement `occurrence(n)` in `packages/core/src/scheduling/domain/occurrence.ts` (depends on T137, T021) — Refs: FR-063
- [ ] T142 [US6] Implement the idempotent materialiser (record id = UUIDv5(schedule_id, n), `origin = {schedule_id, n}`, pending when confirmation required, posted when `local_date ≤ today`) run on foreground and after each sync, with `confirmOccurrence` and `skipOccurrence`, in `packages/core/src/scheduling/application/materialise.ts` (depends on T138, T140, T141, T085, T097) — Refs: FR-064
- [ ] T219 [P] [US6] Write failing tests for the "include scheduled" projected balance and `upcoming` query in `packages/core/src/scheduling/application/projected-balance.test.ts` — Refs: FR-066
- [ ] T143 [P] [US6] Implement the "include scheduled" projected balance and `upcoming` query in `packages/core/src/scheduling/application/projected-balance.ts` (depends on T219, T141, T088) — Refs: FR-066
- [ ] T144 [P] [US6] Implement reminders through the Notifications API without amounts on the lock screen unless the user allows it, in `apps/web/src/adapters/notifications/` and `packages/core/src/scheduling/application/reminders.ts` — Refs: FR-062
- [ ] T145 [US6] Build schedule list (active, completed), create/edit/finish, upcoming list, and confirmation inbox in `apps/web/src/app/schedules/` and `apps/web/src/ui/schedules/` — Refs: FR-065

**Checkpoint**: US6 works independently (SC-012).

---

## Phase 9: User Story 7 - Share a Fold with family or colleagues (Priority: P3)

**Purpose**: Membership log, fingerprint-verified invitations, roles, history scope with baseline and checkpoints, rotation on removal and local wipe.

- [ ] T146 [P] [US7] Write failing tests for the signed, hash-chained membership log (genesis, `prev` hash, signer authorisation by role, at least one owner always, entry types add_member|remove_member|leave|change_role|add_device|revoke_device|rotate_epoch|set_server) in `packages/core/src/sharing/domain/membership-log.test.ts` — Refs: FR-087, FR-088
- [ ] T147 [P] [US7] Write failing tests for Fold-key grants (HPKE seal/open, AAD binds fold, epoch and role, per-epoch grants, signature check) in `packages/crypto/src/hpke/fold-key-grant.test.ts` — Refs: FR-083
- [ ] T148 [P] [US7] Write failing tests for history scope: `full` seals every epoch `1..e`; `from_join` rotates to `e+1`, seals only `e+1`, republishes the structural baseline, writes balance and rollover checkpoints, and for random histories `checkpoint + later entries` equals the full-history balance for every account and date after join, in `packages/core/src/sharing/application/history-scope.property.test.ts` — Refs: FR-102
- [ ] T149 [P] [US7] Write failing tests that a viewer's forged op is rejected by every client, an editor cannot promote themselves, the last owner cannot be removed or demoted, and a removed member cannot decrypt data from epochs they lack, in `packages/core/src/sharing/application/access.test.ts` using the hostile harness — Refs: FR-085, FR-086, FR-088
- [ ] T150 [P] [US7] Write failing Playwright test with axe assertions `e2e/us7-sharing.spec.ts`: fingerprint comparison, viewer read-only, promotion to editor, `from_join` and `full` invitations, removal with notice, voluntary leave with export offer, local copy deleted at next contact — Refs: FR-083, FR-084, FR-085, FR-086
- [ ] T151 [US7] Implement the membership log, role rules and verification from genesis in `packages/core/src/sharing/domain/membership-log.ts` (depends on T146, T070) — Refs: FR-087, FR-088
- [ ] T152 [US7] Implement Fold-key grants (`HPKE.Seal` to the member's X25519 key with `info = CBOR["cashfold.foldkey.v1", fold_id, epoch, member]`, signed by the granter) in `packages/crypto/src/hpke/fold-key-grant.ts` (depends on T147, T027) — Refs: FR-083
- [ ] T220 [P] [US7] Write failing tests for the fingerprint (20-byte truncation, 8 groups of 5 digits, frozen vector) in `packages/crypto/src/fingerprint.test.ts` — Refs: FR-084
- [ ] T153 [P] [US7] Implement the fingerprint (`SHA-256("cashfold.fp.v1" ‖ enc.pk ‖ sig.pk)` truncated to 20 bytes, shown as 8 groups of 5 digits, QR form) in `packages/crypto/src/fingerprint.ts` (depends on T220) — Refs: FR-084
- [ ] T154 [US7] Implement `inviteMember` (role, `history_scope`, fingerprint), `acceptInvitation`, `changeRole`, `removeMember`, `leaveFold`, `transferOwnership`, invitation states Pending|Accepted|Declined|Expired, mandatory fingerprint check for every shared Fold, notification of existing members on full-history invitations, in `packages/core/src/sharing/application/membership-commands.ts` (depends on T151, T152, T153) — Refs: FR-083, FR-084, FR-089
- [ ] T155 [US7] Implement history scope: epoch rotation on `from_join` invitations, baseline republish preserving original field clocks, `checkpoint` records (table 14), and visibility rules (hidden records, patches without base stay invisible) in `packages/core/src/sharing/application/history-scope.ts` (depends on T148, T154, T088, T133) — Refs: FR-102
- [ ] T156 [US7] Implement removal-triggered `rotate_epoch(e+1)`, sealing the new key to remaining members, optional background re-encryption, and the "already seen data cannot be recalled" notice in `packages/core/src/sharing/application/rotate-epoch.ts` — Refs: FR-086
- [ ] T157 [US7] Implement observation of `removed`/`left` in the membership log and deletion of the Fold's rows, `fold_key`, `op_log`, attachments and cached keys, with `FoldRemoved` event, in `packages/core/src/sharing/application/local-wipe.ts` (FR-104) — Refs: FR-104
- [ ] T158 [P] [US7] Write failing tests for invitation lookup: only verified signed-in callers, rate limit (default 20/day/account), unknown and non-discoverable addresses return identical `404` and timing within noise, discoverable accounts return their public key bundle, in `apps/server/test/lookup.test.ts` (FR-106) — Refs: FR-106
- [ ] T159 [P] [US7] Write failing tests that invitation notification emails name only the sender and contain no Fold name, member list or financial content, in `apps/server/test/invitation-mail.test.ts` (FR-107) — Refs: FR-107
- [ ] T160 [US7] Implement `POST /accounts/lookup` (rate-limited, uniform 404) and `POST /folds/{id}/invitations` with the notification email in `apps/server/src/modules/membership/lookup.controller.ts` and `invitations.controller.ts` (depends on T158, T159, T115) — Refs: FR-106, FR-107
- [ ] T161 [US7] Implement invitation codes (export a code/link/QR carrying the invitee's public key bundle; `inviteByCode`) and `lookupMember` in `packages/core/src/sharing/application/invitation-code.ts` and `lookup-member.ts` (FR-106) — Refs: FR-106
- [ ] T162 [US7] Implement the NestJS `membership` module (`GET/POST /folds/{id}/log`, `GET /folds/{id}/grants`, `GET /accounts/{id}/public-keys`), `fold_member` with `from_epoch`, withholding ops older than `from_epoch`, chain-mismatch `409`, and migration `0004_membership.sql` in `apps/server/src/modules/membership/` — Refs: FR-083, FR-102
- [ ] T163 [US7] Build invite flow (email lookup or invitation code, scope selector, fingerprint comparison with QR), invitation acceptance showing scope, member list with roles/history, role changes, remove/leave with export offer and limitation notice, in `apps/web/src/app/folds/[members]/` and `apps/web/src/ui/sharing/`; owner view of each member's devices — Refs: FR-084, FR-086, FR-102

**Checkpoint**: US7 works independently (SC-009).

---

## Phase 10: User Story 8 - Reach savings goals (Priority: P3)

**Purpose**: Goals backed by goal accounts.

- [ ] T164 [P] [US8] Write failing tests for `Goal` in `packages/core/src/budgeting/domain/goal.test.ts`: `target_minor > 0`, linked account kind `goal` with one goal per goal account, status active|achieved|overdue, `required_per_month = ceil(remaining / months_left)` with `months_left ≥ 1`, goal account accepts only transfers and adjustments — Refs: FR-067, FR-068
- [ ] T165 [P] [US8] Write failing Playwright test with axe assertions `e2e/us8-goals.spec.ts`: 6,000.00 due in 12 months, transfer 1,000.00 in, remaining 5,000.00 and the required monthly amount exact, achieved and overdue states — Refs: FR-068
- [ ] T166 [US8] Implement the `Goal` aggregate, commands add/update/delete and the `goalProgress` query in `packages/core/src/budgeting/domain/goal.ts` and `application/goal-commands.ts` (depends on T164, T083, T097) — Refs: FR-067, FR-068, FR-029
- [ ] T167 [US8] Build goal list/detail and create/edit screens with progress, remaining, percent, status and required monthly saving in `apps/web/src/app/goals/` and `apps/web/src/ui/goals/` — Refs: FR-068

**Checkpoint**: US8 works independently.

---

## Phase 11: User Story 9 - Recover access and move my data (Priority: P3)

**Purpose**: Recovery Key, credential changes, account deletion, service migration, encrypted backup, CSV import/export and attachments.

- [ ] T168 [P] [US9] Write failing tests for the Recovery Key (32 random bytes; `RK_auth`, `RK_enc`, `RK_uuid` via HKDF with `CASHFOLD_RECOVERY_KEY_AUTH_v1`, `…_ENC_v1`, `…_UUID`; wrapped key set; second SRP verifier) in `packages/crypto/src/recovery/recovery-key.test.ts` — Refs: FR-009
- [ ] T169 [P] [US9] Write failing tests for password change and Secret Key rotation (key set re-wrapped, verifier replaced atomically, other sessions invalidated, Folds remain accessible) in `packages/core/src/identity/application/credential-change.test.ts` — Refs: FR-008
- [ ] T170 [P] [US9] Write failing tests for account deletion (blocked with `OwnsSharedFold(folds)` until ownership transferred or Fold deleted; fresh identity check; server removes account, devices, key sets, sessions, grants and sole-member Folds; tombstone; `410 Gone` wipes other devices) in `packages/core/src/identity/application/delete-account.test.ts` and `apps/server/test/delete-account.test.ts` — Refs: FR-101
- [ ] T171 [P] [US9] Write failing tests for service migration (register with same credentials on the new service, replay membership logs, push the full op log preserving `dev`, `seq`, HLC, signed `set_server`, delete old account) in `packages/core/src/identity/application/migrate-server.test.ts` — Refs: FR-100
- [ ] T172 [P] [US9] Write failing tests for encrypted backup/restore (AES-256-GCM under HKDF(FK) or a passphrase via Argon2id with the same floors; restore equals original exactly) in `packages/core/src/sync/application/backup.test.ts` — Refs: FR-091
- [ ] T173 [P] [US9] Write failing tests for CSV import (column mapping date/time, currency, amount or separate income/expense columns, transaction type; preview; duplicate detection; per-row error report; whole-batch undo removes only imported records) and for CSV export requiring a fresh identity check, in `packages/core/src/ledger/application/import-csv.test.ts` and `export-csv.test.ts` — Refs: FR-090, FR-092
- [ ] T174 [P] [US9] Write failing tests for attachments (64 KiB frames, nonce = 4-byte random prefix ‖ 8-byte counter, AAD = attachment_id ‖ chunk_index ‖ is_last, truncation detected) in `packages/crypto/src/attachment/attachment.test.ts` — Refs: FR-093
- [ ] T175 [P] [US9] Write failing Playwright test with axe assertions `e2e/us9-recovery.spec.ts`: new profile sign-in from the Emergency Kit, Recovery Key sign-in with a new password, encrypted backup/restore, 5,000-row CSV preview ≤ 5 s and undo, account deletion block and wipe — Refs: FR-009, FR-090, FR-091, FR-101, SC-013, SC-014
- [ ] T176 [US9] Implement the Recovery Key and recovery sign-in in `packages/crypto/src/recovery/recovery-key.ts` and `packages/core/src/identity/application/recovery.ts` (depends on T168, T110) — Refs: FR-009
- [ ] T177 [US9] Implement `changePassword` and `rotateSecretKey` (atomic `PUT /accounts/me/keyset`) in `packages/core/src/identity/application/credential-change.ts` (depends on T169, T120) — Refs: FR-008
- [ ] T178 [US9] Implement `deleteAccount` (client) and `DELETE /accounts/me` plus `tombstone_account` and `410 Gone` middleware (server) in `packages/core/src/identity/application/delete-account.ts` and `apps/server/src/modules/auth/delete-account.ts` (depends on T170, T154) — Refs: FR-101
- [ ] T179 [US9] Implement `migrateToServer` and the signed `set_server` Fold setting in `packages/core/src/identity/application/migrate-server.ts` (depends on T171, T119, T151) — Refs: FR-100
- [ ] T180 [P] [US9] Implement encrypted backup and restore in `packages/core/src/sync/application/backup.ts` (depends on T172) — Refs: FR-091
- [ ] T181 [US9] Implement the CSV importer (mapping, preview, duplicate detection, row errors, `ImportBatch`, undo) and exporter in `packages/core/src/ledger/application/import-csv.ts`, `export-csv.ts` (depends on T173, T085) — Refs: FR-090, FR-092
- [ ] T182 [P] [US9] Implement attachment encryption/decryption streams and server chunk endpoints (`PUT/GET /folds/{id}/attachments/{attId}/chunks/{index}`) in `packages/crypto/src/attachment/attachment.ts` and `apps/server/src/modules/attachments/` (depends on T174) — Refs: FR-093
- [ ] T183 [US9] Build the attachment add/open/remove UI and wire it into the transaction form in `apps/web/src/ui/ledger/attachments.tsx` (FR-030, FR-093) (depends on T182, T091) — Refs: FR-030, FR-093
- [ ] T184 [US9] Build recovery sign-in, Recovery Key setup (shown once), password/Secret Key change, account deletion with owned-Fold blocking list, server migration wizard, backup/restore, CSV import wizard (mapping, preview, undo) and CSV export warning screens in `apps/web/src/app/settings/` and `apps/web/src/ui/portability/` — Refs: FR-008, FR-009, FR-090, FR-091, FR-092, FR-100, FR-101

**Checkpoint**: All user stories are independently functional.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, accessibility, performance, documentation and release readiness.

- [ ] T185 [P] Run and fix axe checks and keyboard-only and screen-reader flows for all primary tasks (WCAG 2.2 AA; SC-016) in `e2e/a11y.spec.ts` — Refs: FR-094, SC-016
- [ ] T186 [P] Add right-to-left layout verification and locale-correct number, currency and date formatting using integer-to-decimal-string helpers (no money-to-`number` conversion) in `apps/web/src/ui/i18n/` and `e2e/i18n.spec.ts` (FR-095) — Refs: FR-095
- [ ] T187 [P] Add the headless-browser benchmark with 50,000 transactions and enforce dashboard ≤ 2 s and add-transaction ≤ 200 ms (SC-008) in `e2e/bench/dashboard-50k.spec.ts`; assert query plans for indexes in ARCH §8.2 on the reference device profile (Chromium with 4× CPU throttling, recorded in research.md R-12) — Refs: FR-096, SC-008
- [ ] T188 [P] Implement storage persistence request, eviction warning and backup nagging, and multi-tab behaviour tests, in `apps/web/src/adapters/storage-persistence.ts` and `e2e/multitab.spec.ts` (ARCH §8.1a) — Refs: FR-072
- [ ] T189 [P] Verify CSP, SRI, service worker asset pinning, `Referrer-Policy`, `Permissions-Policy` against the built export and add an automated header test in `e2e/security-headers.spec.ts` — Refs: Constitution VIII
- [ ] T190 [P] Extend the SBOM and provenance steps of T009 with the release workflow: reproducible-build check and published asset hashes in `.github/workflows/release.yml` and `scripts/build-verify.mjs` — Refs: Constitution VIII
- [ ] T191 [P] Add fuzzing for the SRP message parsers, CSV importer and membership-log parser, and coverage-guided fuzzing of WASM modules, in `packages/*/src/**/*.fuzz.test.ts` — Refs: Constitution Quality Gates
- [ ] T192 [P] Write the threat model including the JavaScript memory-erasure limit and web code-delivery residual risk in `docs/threat-model.md`, and review the generated protocol/API reference `docs/protocol.md` — Refs: Constitution VIII
- [ ] T193 [P] Write the privacy statement listing exactly the routing metadata visible to the service (FR-012) in `docs/privacy.md` — Refs: FR-012
- [ ] T194 Load-test the relay (push/pull throughput, per-Fold sequence strategy decision) and record the outcome in `docs/adr/0007-fold-sequence.md` — Refs: R-13
- [ ] T195 Verify the gates configured in T007, T009 and T010 are required status checks on `main`, and maintain the third-party notices file (`THIRD_PARTY_NOTICES.md`) — Refs: Constitution Quality Gates
- [ ] T196 Prepare the external security review package (scope, protocol docs, vectors, threat model) in `docs/security-review/` — Refs: Constitution Workflow
- [ ] T197 Execute every scenario in `specs/001-secure-finance-core/quickstart.md` and record results — Refs: All SC
- [ ] T202 [P] Implement and test recovery from disk-full, interrupted writes and a corrupted database: detect, keep a quarantined copy, rebuild projections from the op log or offer restore from backup, never lose acknowledged data silently, in `apps/web/src/adapters/sqlite-opfs/recovery.ts` and `e2e/storage-corruption.spec.ts` — Refs: FR-072, FR-016, Edge cases
- [ ] T203 Add the external security review as a release gate: `docs/security-review/status.md` recording the reviewer, scope and findings, and a required release-workflow check that fails until the review is marked complete (Constitution Workflow) — Refs: Constitution Workflow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup; blocks all user stories.
- **US1 (Phase 3)**: depends on Foundational. MVP entry point.
- **US2 (Phase 4)**: depends on Foundational and US1 (sessions, Folds). Includes the FX primitives T095, T098, T099 (moved from US3 because the dashboard's base-currency net worth needs them); IDs are not renumbered.
- **US3 (Phase 5)**: depends on US2 (accounts, transactions).
- **US4 (Phase 6)**: depends on US1 (identity, key set) and the Foundational op pipeline; independent of US2/US3 for protocol work, but its end-to-end tests use US2 data.
- **US5 (Phase 7)**: depends on US2 and US3 (balances, FX).
- **US6 (Phase 8)**: depends on US2 and US3 (transactions, transfers).
- **US7 (Phase 9)**: depends on US4 (server, SRP, `mail` module) and US5 (budget checkpoints).
- **US8 (Phase 10)**: depends on US3 (transfers into goal accounts).
- **US9 (Phase 11)**: depends on US4 (server) and US7 (ownership transfer for account deletion).
- **Polish (Phase 12)**: depends on the stories being shipped.

### Within Each User Story

- Tests first and failing, then domain, application, adapters, UI.
- Domain before application; application before adapters and UI.
- Server modules follow their client counterparts only where a task states a dependency.

### Parallel Opportunities

- Phase 1 tasks marked [P].
- Phase 2: shared-kernel, crypto, protocol and sync-core tests are independent trees; `[P]` test tasks run together.
- After Foundational: US4 server work (`apps/server`) can proceed in parallel with US2/US3 UI work by different people.
- US5, US6 and US8 can run in parallel once US3 is complete.

## Parallel Example: User Story 1

```text
# Tests together (all [P]):
Task: "Write failing tests for the Secret Key in packages/crypto/src/secret-key/secret-key.test.ts"
Task: "Write failing 2SKD tests in packages/crypto/src/two-skd/two-skd.test.ts"
Task: "Write failing key-set tests in packages/crypto/src/keyset/keyset.test.ts"
Task: "Write failing tests for the password policy in packages/core/src/identity/domain/password-policy.test.ts"

# UI work together once application code exists:
Task: "Build the Fold list screens in apps/web/src/app/folds/"
Task: "Add the service-address selector in apps/web/src/ui/settings/server-address.tsx"
```

## Implementation Strategy

### MVP First (P1: US1–US3)

1. Complete Phase 1 and Phase 2 (including the encrypted-SQLite spike ADR-0002).
2. Complete US1, then US2, then US3, validating each independently against its Independent Test and the matching quickstart section.
3. Stop and demo: an offline, encrypted, exact-arithmetic ledger.

### Incremental Delivery

1. Add US4 (sync, relay, self-hosting) and US5 (budgets).
2. Add US6, US8, then US7 and US9.
3. Run Phase 12 hardening and the external security review before any production release.

### Parallel Team Strategy

After Phase 2: one developer on US1→US2→US3, one on the relay and SRP (US4), one on budgets and scheduling once US3 lands.

## Notes

- Commit per task or logical group with Conventional Commits; no tool attribution in commits or PRs.
- Items marked VERIFY in research.md (encrypted SQLite, CBOR library, SRP WASM, Argon2id WASM, WebAuthn PRF, QR library, rate source) are resolved by ADR tasks in Phases 2 and 6.
- Security-sensitive tasks (crypto, auth, sync, sharing) require two reviewers and a threat-model note.
