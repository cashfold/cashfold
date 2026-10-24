# Contributing

- Follow `.specify/memory/constitution.md`; it overrides other docs.
- Commits use [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint via `.githooks/commit-msg`; `pnpm install` activates the hook).
- Test-first for domain, crypto and sync code: the failing test lands before the implementation.
- Money is `bigint`; never use `number`/floating point for amounts.
- Changes to `packages/crypto`, `packages/core/src/sync`, `packages/core/src/sharing` need two reviewers and a threat-model note (`docs/threat-model.md`).
- Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR.

## How a change becomes a release

The title of a squash-merged pull request is a Conventional Commit; that is what decides whether, and how, the version moves:

| Title                                                                                                             | Version                | In a release?           |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------- |
| `fix: …`, `fix(web): …`                                                                                           | patch (1.2.3 to 1.2.4) | yes                     |
| `feat: …`, `feat(desktop): …`                                                                                     | minor (1.2.3 to 1.3.0) | yes                     |
| `feat!: …`, `fix!: …`, or a `BREAKING CHANGE:` footer                                                             | major (1.2.3 to 2.0.0) | yes, listed as breaking |
| `perf: …`, `revert: …`                                                                                            | patch                  | yes                     |
| `docs:`, `chore:`, `test:`, `ci:`, `build:`, `style:`, `refactor:`                                                | none                   | no                      |
| any title, when all changed files are under `apps/server`, `docs`, `specs`, `e2e`, `tests`, `deploy` or `.github` | none                   | no                      |

A bot keeps a **release proposal** pull request up to date with the next version and the changelog. A maintainer approves a release by reviewing and merging that pull request; the installers for Windows, macOS and Linux are then built, tested, signed where possible, and published automatically, all or nothing. Never tag by hand. See `docs/repo-settings.md` and `docs/desktop.md`.
