# Cashfold

Local-first, end-to-end encrypted personal finance: an exact-arithmetic ledger, envelope budgets,
schedules and goals, synced across devices through a relay that only ever sees ciphertext. A pnpm
and Turborepo monorepo: `packages/{core,crypto,protocol,platform}`, `apps/{web,server,desktop}`.

The project constitution is [`.specify/memory/constitution.md`](.specify/memory/constitution.md) and
the design is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Where they disagree with a habit, they
win. Features start as a spec in `specs/NNN-name/` (spec-kit skills: `/speckit-specify`,
`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`).

## Commands

Node comes from `.nvmrc`; pnpm is pinned in `package.json`.

```sh
pnpm install                       # also sets git hooks (commitlint on the commit message)
pnpm verify                        # typecheck + lint + all unit tests; run before every push
pnpm --filter @cashfold/web dev    # web app on :3000 (no service worker)
pnpm --filter @cashfold/desktop dev
pnpm build                         # web static export + relay
pnpm check:docs                    # Markdown formatting; `pnpm format:docs` fixes it
```

Run the smallest scope that proves the change:

```sh
pnpm exec vitest run path/to/file.test.ts                  # one unit test file
pnpm exec vitest run -t "test name"                        # by name
pnpm --filter @cashfold/web test:browser                   # OPFS, workers, WASM in a real browser
pnpm exec playwright test -c e2e/playwright.config.ts e2e/<file>.spec.ts --project=chromium
```

- `.npmrc` sets `frozen-lockfile=true`: adding a dependency needs `pnpm install --no-frozen-lockfile`.
  pnpm 10 blocks dependency build scripts, so after a fresh install run
  `node apps/desktop/node_modules/electron/install.js` to get the Electron binary.
- `pnpm test:e2e -- <file>` does **not** filter: the `--` is passed on as an argument and every spec
  runs. Call Playwright directly as above.
- Each Playwright run rebuilds `apps/web/out` and uses ports 3100 and 3200, so run one at a time.
  The sign-up specs (Argon2) time out with many workers; pass `--workers=3`.
- `pnpm lint` (`eslint .`) scans `test-results/` while a Playwright run is in progress and any stray
  folder in the repo root (such as `Telegram.app/`). Lint after the run ends, or use
  `pnpm exec eslint apps packages e2e scripts`.

## Generated files: change the generator, never the output

CI fails when these are stale.

| Output                                                      | Regenerate with                            |
| ----------------------------------------------------------- | ------------------------------------------ |
| `apps/web/src/adapters/sqlite-opfs/migrations/generated.ts` | `node scripts/gen-migrations.mjs`          |
| `docs/protocol.md`                                          | `node scripts/gen-protocol-docs.mjs`       |
| `THIRD_PARTY_NOTICES.md`                                    | `node scripts/gen-third-party-notices.mjs` |
| brand assets                                                | `pnpm gen:assets`                          |
| `CHANGELOG.md`, `.release-please-manifest.json`             | the release bot; never edit by hand        |

## Rules that are easy to break

- **Zero knowledge.** Nothing readable leaves the device. Logs, errors, URLs and telemetry never
  carry content, keys or secrets. No third-party scripts or analytics.
- **Money is a `bigint` in minor units.** Never `number`, never floating point. `pnpm check:no-float`
  and the `cashfold/no-number-in-money` lint rule enforce it.
- **`packages/core` is framework-free**: no React, Next, Nest, DOM or Node-only imports. Dependency
  direction is enforced by `eslint-plugin-boundaries` in `eslint.config.js` and by
  `packages/core/src/architecture.test.ts`. Fix the import, do not weaken the rule.
- **User-facing text comes from the message catalogues** (English, Ukrainian, Polish), never from a
  string in a component.
- **Screens use the kit** (`apps/web/src/ui/kit`), not bare `<button>`, `<input>` and so on or Headless UI.
- **Keep it simple.** No dependency, option or abstraction until it is needed. New dependencies must
  be AGPL-3.0 compatible, pinned and exact (no `^`).
- Schema changes to operations or payloads ship an upcaster and a replay test over frozen fixtures.

## Commits and pull requests

- Branch from `main`. Pull requests are squash-merged, so the **title** becomes the commit on `main`
  and decides the release: `feat` is a minor release, `fix` and `perf` a patch, `!` or a
  `BREAKING CHANGE:` footer a major one; `docs`, `chore`, `test`, `ci`, `build`, `style` and
  `refactor` release nothing.
- [Conventional Commits](https://www.conventionalcommits.org/), checked by a hook.
- **No AI-tool attribution** in commit messages or pull request descriptions (no `Co-Authored-By`
  trailer, no "Generated with" line). This is a project rule in [CONTRIBUTING.md](CONTRIBUTING.md).
- One purpose per pull request. Never tag a release by hand.

## Detailed rules

How code and tests are written is in [CODING_STANDARDS.md](CODING_STANDARDS.md). Path-scoped rules in `.claude/rules/` attach when you touch matching files: `architecture.md`,
`money.md`, `ui.md`, `i18n.md`, `testing.md`, `desktop.md`. Read the matching document in `docs/`
before larger work: [ledger](docs/ledger.md), [sync](docs/sync.md), [languages](docs/i18n.md),
[privacy](docs/privacy.md), [desktop](docs/desktop.md).
