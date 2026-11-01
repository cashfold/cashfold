# Contributing to Cashfold

Thank you for helping. Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need [Node.js](https://nodejs.org/) (the version in [`.nvmrc`](.nvmrc)) and [pnpm](https://pnpm.io/) 10 (`corepack enable` uses the version pinned in `package.json`). Docker is only needed for the PostgreSQL integration tests.

```sh
git clone https://github.com/cashfold/cashfold.git
cd cashfold
pnpm install                           # also installs the commit-message hook
pnpm --filter @cashfold/web dev        # the web app on http://localhost:3000
pnpm --filter @cashfold/desktop dev    # the desktop app, from source
```

The end-to-end tests need browsers once: `pnpm exec playwright install --with-deps`. Running the relay yourself is in [docs/self-hosting.md](docs/self-hosting.md); the desktop app is in [docs/desktop.md](docs/desktop.md).

## Check your change

| Command                                    | What it checks                                        |
| ------------------------------------------ | ----------------------------------------------------- |
| `pnpm verify`                              | type-check, lint and the unit tests                   |
| `pnpm --filter @cashfold/web test:browser` | storage, workers and WebAssembly in a real browser    |
| `pnpm test:e2e`                            | end-to-end tests, with accessibility (axe) assertions |
| `pnpm build`                               | the web export and the relay                          |
| `pnpm check:docs`                          | Markdown formatting (`pnpm format:docs` fixes it)     |

CI runs the full set on every pull request. Some files are generated and CI fails if they are stale: `node scripts/gen-migrations.mjs`, `node scripts/gen-protocol-docs.mjs` and `node scripts/gen-third-party-notices.mjs`.

## The code

- TypeScript in strict mode.
- Money is a `bigint` in minor units, never a `number` (`pnpm check:no-float`).
- `packages/core` does not import React, Next, Nest, the DOM or Node-only modules; the server holds no domain model.
- Nothing readable leaves the device; logs never carry content.
- User interface text comes from the message catalogs (English, Ukrainian, Polish), and screens work with the keyboard and in right-to-left layouts.
- Keep it simple: no dependency, option or abstraction until it is needed. New dependencies must be compatible with AGPL-3.0.

## Commits and pull requests

- Branch from `main`. Pull requests are squash-merged, so the **title** is the commit on `main`.
- Titles and commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, and so on); a hook checks the message. They carry no AI-tool attribution.
- Keep a pull request to one purpose, and say what changed and how you tested it.

## Releases

The title decides the next version: `feat` raises the minor version, `fix` and `perf` the patch version, `!` or a `BREAKING CHANGE:` footer the major version; `docs`, `chore`, `test`, `ci`, `build`, `style` and `refactor` make no release. A bot keeps a release pull request up to date; merging it publishes the release. Never tag by hand. See [docs/desktop.md](docs/desktop.md#repository-setup-maintainer) and [docs/desktop.md](docs/desktop.md#releasing).

## Security

Do not open a public issue for a vulnerability; follow [SECURITY.md](SECURITY.md).

## License

Cashfold is licensed under the [GNU Affero General Public License v3.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms. There is no contributor license agreement.
