---
paths:
  - "packages/**/*"
  - "apps/server/**/*"
  - "eslint.config.js"
---

# Architecture and dependency boundaries

Source of truth: `docs/ARCHITECTURE.md` §0.3 and the constitution (principles I to V). The boundaries
are enforced by `eslint.config.js` (`eslint-plugin-boundaries`) and by
`packages/core/src/architecture.test.ts`. A violation is a design error: move the code, do not add an
exception.

## Who may import whom

| Package or layer                 | May import                                      | Never imports                            |
| -------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `core` domain                    | `shared-kernel` only                            | application, ports, crypto, protocol     |
| `core` application               | domain, ports, shared-kernel                    | crypto, protocol, any app                |
| `core` ports                     | plain interfaces                                | crypto, protocol, any app                |
| `packages/crypto`                | itself                                          | `core`                                   |
| `packages/protocol`              | nothing in the workspace                        | everything else                          |
| `packages/platform`              | nothing in the workspace                        | everything else (leaf contract package)  |
| `apps/server`                    | `protocol`                                      | `core` (the relay has no domain model)   |
| `apps/web`                       | `core`, `crypto`, `protocol`, `platform`        | `apps/desktop`                           |
| `apps/desktop`                   | `platform` only                                 | `core`, `web`, `crypto`, `protocol`      |

`packages/core` also may not import `react`, `react-dom`, `next`, `@nestjs/*` or `node:*`.

## Where things go

- A new command or query: a handler in `core/src/<context>/application`, ports in `.../ports`,
  behaviour and invariants in `.../domain`. The adapter (SQLite, crypto, transport) lives in
  `apps/web/src/adapters`, never in `core`.
- Aggregates reference each other by id only, and enforce their own invariants.
- State changes only by appending an operation (a signed, encrypted, per-field patch with a hybrid
  logical clock). Projections are a pure `apply(op)` of merged state, rebuildable by replay, and
  identical for local and remote operations. Queries never mutate.
- A change to an operation or payload schema needs a version bump, an upcaster and a replay test over
  frozen fixtures (`vectors/`).
- The wire format lives in `packages/protocol` (zod schemas). `docs/protocol.md` is generated from it:
  run `node scripts/gen-protocol-docs.mjs`.
- The server verifies signatures and structure only. It must never need to understand user data;
  if a design requires that, redesign it (constitution I).

## Security hygiene

- No secret in a log, URL, error message, storage outside the encrypted store, or telemetry. The core
  logger sanitises entries; use it rather than `console`.
- Keys are non-extractable `CryptoKey`s where the platform allows; overwrite secret buffers when done.
- Cryptography goes behind the narrow interfaces in `packages/crypto/src/ports`. Do not call
  WebCrypto or `@noble/*` from feature code.
- New dependencies: AGPL-3.0 compatible (`pnpm check:licenses`), exact version, justified.
