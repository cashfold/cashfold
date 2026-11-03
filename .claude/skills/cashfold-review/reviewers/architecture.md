# Architecture, boundaries and schema changes

**Scope:** `packages/**`, `apps/server/**`, `eslint.config.js`.

Follow `_contract.md`. The rules are in `.claude/rules/architecture.md` and `docs/ARCHITECTURE.md`
§0.3; read the first before you start.

- **Dependency direction.** domain depends on shared-kernel only; application on domain, ports and
  shared-kernel; `crypto` never on `core`; `protocol` on nothing; the relay never on `core`; the desktop
  shell on `platform` only. A new import across a boundary, or a change that loosens a rule in
  `eslint.config.js`, is a `blocker`.
- **Framework-free core.** No React, Next, Nest, the DOM, or `node:*` in `packages/core`.
- **Where logic lives.** Domain rules in domain; use cases and ports in application; storage, crypto and
  transport adapters outside `core`. A query that mutates, or a command that writes anywhere except by
  appending an operation, is a `blocker`.
- **Aggregates** enforce their own invariants and reference each other by id only.
- **Operations and schema.** Changing the meaning or encoding of an existing field, or the shape of an
  operation, needs a `SCHEMA_VERSION` bump, an upcaster step and a replay test over the frozen fixture.
  Field ids in `tables.ts` are never reused or renumbered. A new field id is additive. Missing any of
  these is a `blocker`.
- **The relay is thin.** It verifies signatures and structure and never needs to understand content. Any
  change that makes the server read or interpret user data contradicts constitution I.
- **Complexity.** A new layer, option or dependency must earn its place (constitution IX). Say so when
  it does not.
