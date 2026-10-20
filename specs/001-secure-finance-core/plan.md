# Implementation Plan: Secure Finance Core

**Branch**: `001-secure-finance-core` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-secure-finance-core/spec.md`. Technical source of truth: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) (**ARCH §n**). Governing rules: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) v1.0.1 (**Constitution I–IX**).

## Summary

Build Cashfold as a TypeScript monorepo. A framework-agnostic `core` package holds the domain and application layers (DDD, Clean Architecture, CQRS, event sourcing adapted to CRDT sync). A `crypto` package holds every cryptographic operation behind narrow ports. A `protocol` package holds wire schemas shared by client and server. The Phase 1 client is a Next.js + Tailwind **client-only static export** that runs `core` inside a dedicated Web Worker with an encrypted SQLite (WASM, OPFS) store. The relay is a thin NestJS + PostgreSQL service that stores and forwards ciphertext and never holds a domain model. The relay is open source, self-hostable, and identical for the hosted instance. Desktop and mobile arrive later as Tauri 2 shells that load the same static export without changing `core`, `crypto` or `protocol`. Delivery follows the spec's priority order: P1 (identity, ledger, transfers), then P2 (sync, budgets), then P3 (recurrence, goals, sharing, recovery and portability).

## Technical Context

**Language/Version**: TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ES modules, Node.js active LTS for tooling and server (**VERIFY** the current LTS when scaffolding).

**Primary Dependencies** (all exact-pinned via the lockfile; each requires review per Constitution VIII):
- Client: Next.js (App Router, `output: 'export'`), React, Tailwind CSS, `zod`, typed worker RPC (Comlink or equivalent), `@sqlite.org/sqlite-wasm` plus an encryption approach (R-07), a deterministic-CBOR encoder (R-06).
- Crypto: WebCrypto, `@noble/curves`, `@noble/hashes`, an Argon2id WASM build, a constant-time big-integer WASM module for SRP (R-05).
- Server: NestJS (Fastify adapter), PostgreSQL 16+, Kysely (typed SQL), `zod` pipes from `protocol`, Node `crypto` for SRP server math, a scheduler for rate publication.
- Tooling: pnpm workspaces, Turborepo, ESLint + `typescript-eslint` + `eslint-plugin-boundaries`, Prettier, Changesets (versioning of published packages, optional).

**Storage**: Device: SQLite WASM on OPFS with whole-file encryption (ARCH §8). Server: PostgreSQL holding ciphertext and routing metadata only (ARCH §9.7). Attachments and snapshots: S3-compatible object storage behind a port.

**Testing**: Vitest (unit, property with fast-check, contract), Playwright (end-to-end, offline, two-browser sync, leak scan, accessibility with axe), Testcontainers (PostgreSQL), known-answer vectors in `vectors/`, hostile-server suite.

**Target Platform**: Evergreen desktop and mobile browsers with OPFS, WebCrypto and Web Workers (matrix fixed in R-12). Later: Tauri 2 (desktop, iOS, Android). Server: Linux containers.

**Project Type**: Web application (static client + API relay) in a TypeScript monorepo.

**Performance Goals**: Dashboard ready ≤ 2 s and add-transaction UI update ≤ 200 ms with 50,000 transactions (SC-008). Propagation to another online device ≤ 5 s at p95 (SC-005). Unlock (Argon2id) about 1 s on a mid-range phone browser at default parameters. CSV preview of 5,000 rows ≤ 5 s (SC-014). Initial JS budget for the application shell is set in R-12.

**Constraints**: Fully offline for P1/P2. No `number` or floating point in money paths. No plaintext content or secrets to the server, logs, URLs or telemetry. Secrets only inside the Core Worker. Strict CSP, SRI, no third-party scripts. `core` imports no React, Next, Nest, DOM or Node-only modules.

**Scale/Scope**: ≤ 50,000 transactions per Fold; 1–3 devices per user; ≤ 5 members per Fold; roughly 35 screens in Phase 1; server sized for tens of thousands of accounts initially.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Pre-research | Post-design |
|---|---|---|---|
| I | Zero-knowledge by construction | PASS | PASS: server schema and API carry only opaque blobs, routing metadata and a non-personalised rate table (data-model §S, contracts/) |
| II | DDD in `core` | PASS | PASS: contexts and aggregates defined in data-model.md; value objects `Money`, `CurrencyCode`, `LocalDate`, `Rate` |
| III | Clean / Hexagonal | PASS | PASS: package layout and boundary rules below; `apps/server` has no domain layer |
| IV | CQRS | PASS | PASS: single command→op path; queries read projections (ARCH §0.3) |
| V | Event sourcing adapted to CRDT | PASS | PASS: op log is the store, pure `apply(op)`, upcasters required (R-03) |
| VI | Exact money | PASS | PASS: `bigint` `Money`, lint ban on `number` in money paths, SQLite adapter reads 64-bit as `bigint` (R-04) |
| VII | Local-first | PASS | PASS: service-worker app shell makes reloads work offline; P1/P2 verified offline in Playwright (quickstart) |
| VIII | Security hygiene | PASS with residual risk | PASS with documented residuals: JS cannot guarantee erasure; web code delivery is trusted unless the Tauri shell is used (R-10, R-12) |
| IX | Simplicity / YAGNI | PASS | See Complexity Tracking |

Technology constraints check: TypeScript strict ✔; package set `core`, `crypto`, `protocol`, `apps/web`, `apps/server` ✔; Next.js static export, no server-side touching user data ✔; Tauri deferred ✔; allowed test tools ✔; crypto libraries as mandated, SRP exponentiation constant-time ✔ (R-05).

## Project Structure

### Documentation (this feature)

```text
specs/001-secure-finance-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── sync-api.openapi.yaml    # Relay HTTP/WebSocket API (also generated from protocol schemas)
│   ├── op-envelope.cddl         # Wire format of operations, key objects, log entries
│   ├── auth-srp.md              # Sign-in handshake and transport framing
│   └── core-api.md              # Application API of the Core Worker (commands, queries, events)
├── checklists/requirements.md
└── tasks.md                     # Created by /speckit-tasks
```

### Source Code (repository root)

```text
package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  eslint.config.js  eslint-rules/  scripts/
packages/
├── core/
│   └── src/
│       ├── shared-kernel/        # Money, CurrencyCode, LocalDate, Rate, Id, Result, errors
│       ├── identity/             # Identity & Access: account, device, KeySet use cases
│       ├── ledger/               # Accounts, categories, payees, tags, transactions, transfers, FX
│       ├── budgeting/            # Envelopes, rollover, velocity, goals
│       ├── scheduling/           # Schedules and occurrence materialisation
│       ├── sharing/              # Folds, membership log, invitations, scope, checkpoints
│       ├── sync/                 # HLC, op model, merge, repair, projections driver, sync use cases
│       │   (each context: domain/  application/{commands,queries,projections}/  ports/)
│       └── testing/              # In-memory ports, replica simulator, hostile-server harness (not shipped)
├── crypto/
│   └── src/ ports/  kdf/  two-skd/  aead/  hpke/  signature/  pake/  transport/  secret-key/  keyset/  record/  recovery/  attachment/  fingerprint.ts  adapters/{webcrypto,noble,argon2-wasm,srp-wasm}/
└── protocol/
    └── src/ schemas/ (zod)  cbor/  generated/ (OpenAPI, CDDL checks)
apps/
├── web/
│   └── src/
│       ├── app/                  # Next.js routes (static export); marketing/docs routes may render on the server
│       ├── sw/                   # Service worker: precache of the hashed export, cache-first, atomic updates
│       ├── ui/                   # Tailwind components, a11y, i18n
│       ├── worker/               # Core Worker entry, RPC, lifecycle, locks
│       └── adapters/             # sqlite-opfs, keystore-idb, transport (fetch/ws, registration, rates), notifications, logger, clock, rng
└── server/
    └── src/ modules/{auth,devices,folds,membership,ops,snapshots,attachments,rates,mail}/  infrastructure/{db,storage,jobs}/
vectors/                          # Frozen known-answer files
deploy/                           # Dockerfile, Compose, example config
docs/                             # ARCHITECTURE.md, adr/, self-hosting.md
e2e/                              # Playwright suites
```

**Boundary rules (enforced in CI)**: `core/*/domain` imports only `shared-kernel`; `application` imports `domain` and its own `ports`; adapters are outside `core`; `core` never imports `apps/*`; `apps/server` never imports `core`; `crypto` never imports `core`; `protocol` imports nothing in the workspace.

**Structure Decision**: Five workspace packages exactly as the constitution lists them. Adapters live inside `apps/web` and `apps/server`; test support lives under `core/testing` as a non-shipped subpath export. This avoids adding packages the constitution does not name.

## Phasing

| Milestone | Spec stories | Delivers | Main areas |
|---|---|---|---|
| M0 Foundations | n/a | Monorepo, offline service-worker shell, repository governance settings, CI gates (types, lint, boundaries, no-number-in-money, audit, bundle budget, axe accessibility, coverage floors), ADR-0001 (stack), vectors, shared-kernel (`Money`, rounding, FX), `crypto` ports with known-answer tests, deterministic CBOR profile, encrypted SQLite spike (ADR-0002) | shared-kernel, crypto, protocol |
| M1 Private ledger (P1) | 1, 2, 3 | Account creation, Secret Key and Emergency Kit, lock/unlock, Folds, accounts, categories, transactions, transfers, FX, balances, search, offline end-to-end | identity, ledger, sync (local op log), web |
| M2 Sync (P2) | 4 | SRP sign-in, NestJS relay, rate publisher, self-host packaging, op push/pull, HLC, merge, repair, device enrolment and revocation | sync, server |
| M3 Budgets (P2) | 5 | Envelopes, rollover policies, velocity, reports | budgeting |
| M4 Automation and goals (P3) | 6, 8 | Schedules with convergent occurrences, goals. Story 8 depends only on US3, so M4 and M5 may run in either order; tasks.md lists US7 before US8 | scheduling, budgeting |
| M5 Sharing (P3) | 7 | Membership log, HPKE grants, roles, rotation, invitation history scope with baseline and checkpoints, local wipe on removal | sharing, server |
| M6 Portability (P3) | 9 | Recovery Key, password/Secret Key change, account deletion, service migration, encrypted backup, CSV import and export, attachments | identity, sync, web |
| M7 Hardening | all | Fuzzing, external security review, accessibility audit, load test at 50,000 transactions, reproducible build and published hashes | all |
| M8 Tauri shells (post-v1) | n/a | Desktop and mobile shells with OS keychain `KeyStorePort`; no changes to `core`, `crypto`, `protocol` | apps/desktop, apps/mobile |

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| DDD + CQRS + event sourcing in `core` | Mandated by the constitution; the op log must be the single write path for merge correctness (Constitution II, IV, V) | A CRUD model would create a second write path that bypasses signing, ordering and merging |
| Two WASM modules (Argon2id, constant-time big-integer) | Memory-hard KDF and constant-time SRP are not available in WebCrypto or `@noble` (Constitution Technology Constraints) | PBKDF2 only (weaker); JS `BigInt` for SRP exponents (timing leak, forbidden) |
| Core Worker + typed RPC | Keeps keys out of the UI thread and lets locking terminate all secrets (Constitution VIII) | Running `core` on the UI thread exposes secrets to every UI dependency |
| Encrypted SQLite on OPFS (custom or cipher build) | Whole-file encryption plus fast SQL aggregates at 50,000 rows (ARCH §8) | IndexedDB-only requires hand-written query and aggregation code; plain OPFS leaves plaintext on disk |
| Checkpoint records for `from_join` invitations | Lets a member without old keys see correct balances and rollovers (FR-102) | Zero opening balances would be wrong; granting old keys defeats the scope choice |
| Hand-controlled deterministic CBOR profile | Signatures and AEAD associated data need byte-identical encodings | JSON cannot represent 64-bit integers exactly or provide canonical bytes |
| Separate relay app | Independently deployable, auditable "knows nothing" server; self-hosting | Embedding in the web app would blur the trust boundary |
