# ADR-0001: TypeScript monorepo stack

- **Status**: accepted
- **Date**: 2026-10-18

## Context

Cashfold needs one language across a zero-knowledge client and a thin relay so that wire schemas, money types and tests are shared. The constitution (v1.0.1) fixes the principles; `docs/ARCHITECTURE.md` describes the target design. Where the two disagreed, the constitution wins.

## Decision

- TypeScript (strict) in a pnpm + Turborepo monorepo with five packages: `packages/core`, `packages/crypto`, `packages/protocol`, `apps/web`, `apps/server`.
- Client: Next.js static export (`output: 'export'`) with Tailwind CSS. No server-side code touches user data.
- Relay: NestJS (Fastify adapter) + PostgreSQL via Kysely. It stores and forwards ciphertext only and never imports `core`.
- Money is `bigint` everywhere; `number` in money paths is banned by a custom lint rule and a CI grep gate.
- Tests: Vitest (+ fast-check), Playwright (+ axe), Testcontainers, frozen known-answer vectors.
- Conflicts with ARCHITECTURE.md resolved in favour of the constitution: client-only static export (no Next server runtime), service-worker offline shell, and no extra packages beyond the five named.

## Consequences

Boundaries are enforced mechanically (`eslint-plugin-boundaries`). Tauri shells can later reuse the static export without changes to `core`, `crypto` or `protocol`.
