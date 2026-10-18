# Cashfold Constitution

## Core Principles

### I. Zero-Knowledge by Construction
The server and its operators MUST NEVER receive plaintext financial content, passwords, Secret
Keys, or any key able to decrypt user data. A feature that requires the server to understand
user data MUST be rejected or redesigned. Consequently all domain logic, aggregates and
projections live in the client `core` package, and the server holds no domain model.
Rationale: the privacy promise must hold even against a malicious or compromised operator.

### II. Domain-Driven Design in `core`
The ubiquitous language comes from the specification: Fold, Account, Transaction, Transfer,
Envelope, Schedule, Goal, Member. The bounded contexts are Identity & Access, Ledger,
Budgeting, Scheduling, Sharing & Membership, and Sync. Aggregates MUST enforce their own
invariants and MUST reference other aggregates by id only. Value objects (`Money`,
`CurrencyCode`, `LocalDate`, `Rate`) MUST be immutable and validated at construction. Domain
code MUST NOT perform I/O. Rationale: financial rules are subtle, and an explicit model keeps
them testable and auditable.

### III. Clean / Hexagonal Architecture
In `core` and `apps/server`, dependencies MUST point inward: domain ← application (use cases) ←
adapters (storage, crypto, transport, UI). Ports are interfaces owned by the inner layer.
Boundaries MUST be enforced by dependency-boundary lint rules (eslint-plugin-boundaries or
dependency-cruiser) that fail CI. `apps/server` is a thin adapter layer that follows the same
discipline and has no domain layer. Rationale: lets storage, crypto and delivery targets
(web now, Tauri later) change without touching the domain.

### IV. CQRS
Commands (validated, authorised, intent-named) MUST change state only by appending events.
Queries MUST read from local projections (SQLite read models) and MUST NOT mutate state. Every
read model MUST be rebuildable from the event log at any time. Rationale: guarantees one write
path, which is essential for merge correctness and auditability.

### V. Event Sourcing Adapted to CRDT Sync
The local append-only event log is the source of truth. Replicated operations are signed,
encrypted, per-field patches carrying hybrid logical clocks, as defined in
`docs/ARCHITECTURE.md` §9. Domain events are derived from merged state locally. Projections
MUST be deterministic pure functions of the set of events, independent of arrival order and
duplicates. Event and operation schemas MUST be versioned, and every schema change MUST ship
an upcaster. Rationale: convergence across devices requires order-independent, replayable
state.

### VI. Exact Money
Amounts MUST be integer minor units represented as `bigint`. Floating-point types MUST NOT
appear in money paths; this is enforced by lint and by a CI gate. A single rounding rule
(half-to-even, applied once at the end of a computation) MUST be used everywhere. Overflow
MUST be an error, never wrapped or truncated. Rationale: rounding drift destroys trust in a
finance product.

### VII. Local-First
Every P1 and P2 feature MUST work fully offline. The network is an optimisation for
synchronisation only, and no user-visible function may block on it. Rationale: availability
and privacy both improve when the device is self-sufficient.

### VIII. Security Hygiene
The web app MUST ship a strict Content-Security-Policy and Subresource Integrity, and MUST NOT
include third-party scripts, analytics or session replay. Secrets MUST NOT reach logs, storage
outside the encrypted store, URLs, error messages or telemetry. Keys MUST be non-extractable
`CryptoKey` objects wherever the platform allows, and secret buffers MUST be overwritten as
soon as they are no longer needed. JavaScript cannot guarantee memory erasure, and this limit
MUST be documented in the threat model. Dependencies MUST be pinned, audited and minimised.
Supply-chain controls are mandatory: lockfile enforcement, build provenance, an SBOM, and
automated vulnerability scanning. Rationale: a browser delivers its own code, so supply-chain
and delivery risks must be treated as first-class.

### IX. Simplicity and YAGNI
Patterns are used where they pay for themselves. Any additional layer, abstraction or
dependency MUST be justified in the plan's Complexity Tracking table. No feature may be built
without a user story in an approved specification. Rationale: DDD, CQRS and event sourcing
carry real cost; they are tools, not goals.

## Technology Constraints

- **Language**: TypeScript everywhere, strict mode with `strict`, `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes`. `any` MUST NOT be used without a justified, reviewed
  exception. ES modules only.
- **Monorepo**: pnpm workspaces with Turborepo or Nx. Packages:
  - `core`: framework-agnostic domain and application logic. MUST NOT import React, Next,
    Nest, the DOM or Node-only modules.
  - `crypto`: all cryptography behind narrow interfaces.
  - `protocol`: wire types and schemas shared by client and server.
  - `apps/web`: Next.js (App Router) with Tailwind CSS, delivered as a client-only static
    export. Server components, server actions and API routes MUST NOT touch user data or
    secrets. Marketing and documentation pages MAY use server rendering.
  - `apps/server`: NestJS with PostgreSQL, acting as the relay.
- **Phasing**: Phase 1 targets the web only. Desktop and mobile shells (Tauri 2) are planned
  later and MUST NOT require changes to `core`, `crypto` or `protocol`.
- **Testing tools**: Vitest, Playwright, fast-check (property tests), and Testcontainers for
  PostgreSQL.
- **Cryptography**: WebCrypto where available (AES-256-GCM, HKDF-SHA256, PBKDF2 fallback) and
  audited libraries (`@noble/curves`, `@noble/hashes`, a vetted Argon2id WASM build) for the
  rest. Hand-written primitives are forbidden. SRP over a 4096-bit group MUST use
  constant-time big-integer operations (OpenSSL-backed on the server, vetted WASM on the
  client). Native `BigInt` MUST NOT be used for secret-dependent modular exponentiation.

## Quality Gates

- Domain, crypto and sync code MUST be developed test-first (red, green, refactor).
- Required suites:
  - known-answer tests for every cryptographic primitive;
  - property tests for money, balances, rollover, recurrence and CRDT convergence (N replicas,
    random partitions, duplicates, reordering);
  - a hostile-server suite (tamper, replay, reorder, drop, downgrade);
  - contract tests between consumers of `protocol`;
  - Playwright end-to-end tests for each P1 and P2 user story;
  - a plaintext-leak scan of IndexedDB/OPFS, logs and network captures.
- Coverage floors: domain and crypto at least 95% of lines and branches; application layer at
  least 85%.
- CI MUST block merges on: type-check, lint (including boundary and no-float rules), tests,
  build, dependency audit, licence check, bundle-size budget, and accessibility checks (axe,
  WCAG 2.2 AA).

## Development Workflow

- Commits MUST follow Conventional Commits. Pull requests MUST be small and single-concern and
  MUST be squash-merged. `main` is protected and requires review and green CI. Commit messages,
  PR titles and PR descriptions MUST NOT contain AI-tool attribution or co-author lines.
- Architecture decisions MUST be recorded as ADRs in `docs/adr/`. Any change to cryptography,
  protocol or wire formats requires an ADR and an update to `docs/ARCHITECTURE.md` in the same
  pull request.
- Security-sensitive changes (crypto, authentication, sync, sharing) MUST have two reviewers
  and a threat-model note. An external security review MUST be completed before any
  production release.
- Accessibility and internationalisation (including right-to-left layouts) are part of the
  definition of done.
- Observability: logs MUST be structured with type-based redaction; metrics and traces MUST
  contain identifiers and counts only, never content.
- Public API and protocol documentation MUST be generated from `protocol` schemas. The
  self-hosting guide MUST be kept current.
- The project is open source. Dependencies MUST be licence-compatible, and a third-party
  notices file MUST be maintained.

## Governance

This constitution supersedes all other practices. Amendments require a pull request with a
written rationale, a migration plan for affected artifacts, and maintainer approval.
Versioning follows semantic rules: MAJOR for removed or redefined principles, MINOR for added
principles or sections or materially expanded guidance, PATCH for clarifications. Every
`plan.md` Constitution Check MUST cite the principles above by number (I–IX) and justify any
deviation in Complexity Tracking. Reviewers MUST verify compliance in every pull request.

**Version**: 1.0.0 | **Ratified**: 2026-10-18 | **Last Amended**: 2026-10-18
