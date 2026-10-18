# Contributing

- Follow `.specify/memory/constitution.md`; it overrides other docs.
- Commits use [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint via `.githooks/commit-msg`; `pnpm install` activates the hook).
- Test-first for domain, crypto and sync code: the failing test lands before the implementation.
- Money is `bigint`; never use `number`/floating point for amounts.
- Changes to `packages/crypto`, `packages/core/src/sync`, `packages/core/src/sharing` need two reviewers and a threat-model note (`docs/threat-model.md`).
- Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR.
