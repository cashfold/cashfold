# Contributing to Cashfold

Thank you for helping. This guide covers how to set up, what a good change looks like, and how a
change becomes part of a release. Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Set up your machine](#set-up-your-machine)
- [Check your change](#check-your-change)
- [Rules for the code](#rules-for-the-code)
- [Security-sensitive changes](#security-sensitive-changes)
- [Documentation](#documentation)
- [Commits and pull requests](#commits-and-pull-requests)
- [Review and merge](#review-and-merge)
- [How a change becomes a release](#how-a-change-becomes-a-release)
- [License of your contribution](#license-of-your-contribution)

## Ways to contribute

- **Report a bug or suggest a feature** with the [issue forms](https://github.com/cashfold/cashfold/issues/new/choose). Search the
  open issues first.
- **Improve the documentation.** Fixes to wording, examples and structure are welcome, and they
  need no special setup.
- **Fix something.** Issues labelled
  [good first issue](https://github.com/cashfold/cashfold/issues?q=is%3Aopen+label%3A%22good+first+issue%22) and
  [help wanted](https://github.com/cashfold/cashfold/issues?q=is%3Aopen+label%3A%22help+wanted%22) are a good place to start.
- **Report a vulnerability privately.** Do not open a public issue; follow [SECURITY.md](SECURITY.md).

## Before you start

- For anything larger than a small fix, open an issue first so the approach can be agreed before you
  spend time on it.
- The [project constitution](.specify/memory/constitution.md) overrides every other document. It
  sets the principles (zero-knowledge by construction, exact money, local-first, simplicity) and the
  quality gates this guide summarises.
- Features are specified in [`specs/`](specs/). Design decisions are recorded as
  [ADRs](docs/adr/README.md), and the design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Set up your machine

You need:

- [Node.js](https://nodejs.org/) 26 (the version in [`.nvmrc`](.nvmrc); `package.json` requires
  22 or later).
- [pnpm](https://pnpm.io/) 10. Run `corepack enable` and the version pinned in `package.json` is
  used.
- [Docker](https://www.docker.com/), only for the PostgreSQL integration tests.

```sh
git clone https://github.com/cashfold/cashfold.git
cd cashfold
pnpm install            # also installs the commit-message hook (git config core.hooksPath)
pnpm --filter @cashfold/web dev        # the web app on http://localhost:3000
pnpm --filter @cashfold/desktop dev    # the desktop app, from source
```

Notes:

- Text files are checked out with LF line endings on every system ([`.gitattributes`](.gitattributes)).
  Several scripts read committed text files and compare hashes.
- The end-to-end tests need browsers once: `pnpm exec playwright install --with-deps`.
- Running the relay yourself is described in [docs/self-hosting.md](docs/self-hosting.md); the
  desktop app in [docs/desktop.md](docs/desktop.md).

## Check your change

Run what matches your change before you open a pull request. The `verify` job in CI runs all of it.

| Command                                                                         | What it checks                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm verify`                                                                   | type-check, lint and the unit and property tests, in one go      |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`                                      | the same, one at a time                                          |
| `pnpm --filter @cashfold/web test:browser`                                      | storage, workers and WebAssembly in a real browser               |
| `pnpm test:e2e`                                                                 | end-to-end tests, with accessibility (axe) assertions            |
| `pnpm --filter @cashfold/server test:integration`                               | the relay against PostgreSQL (needs Docker)                      |
| `pnpm --filter @cashfold/desktop test:packaged`                                 | the packaged desktop app                                         |
| `pnpm build`                                                                    | the web export and the relay                                     |
| `pnpm check:bundle`, `check:licenses`, `check:no-float`, `check:desktop-config` | size budget, licenses, no floating-point money, desktop settings |
| `pnpm check:docs`                                                               | Markdown formatting (`pnpm format:docs` fixes it)                |

Some files are generated, and CI fails if they are out of date. Regenerate them and commit the
result:

| File                                                        | Command                                    |
| ----------------------------------------------------------- | ------------------------------------------ |
| `apps/web/src/adapters/sqlite-opfs/migrations/generated.ts` | `node scripts/gen-migrations.mjs`          |
| `docs/protocol.md`                                          | `node scripts/gen-protocol-docs.mjs`       |
| `THIRD_PARTY_NOTICES.md`                                    | `node scripts/gen-third-party-notices.mjs` |

If `pnpm lint` reports hundreds of errors in files you did not touch, look for leftover
`playwright-report/` or `test-results/` folders from a test run and delete them.

## Rules for the code

These come from the constitution and are enforced by review and by CI.

- **TypeScript in strict mode,** including `noUncheckedIndexedAccess`.
- **Test first** for domain, crypto and sync code: the failing test lands before the
  implementation. Property tests cover money, balances, rollover, recurrence and merge convergence;
  cryptographic primitives have known-answer tests.
- **Money is a `bigint` in minor units.** Never use `number` or floating point for amounts
  (`pnpm check:no-float`).
- **Keep the layers apart.** `packages/core` does not import React, Next, Nest, the DOM or Node-only
  modules, and dependency boundaries are linted. The server holds no domain model.
- **Nothing readable leaves the device.** Logs are structured and redact by type; they never carry
  content. Metrics and traces carry identifiers and counts only.
- **Accessibility and internationalisation are part of done.** User interface changes meet WCAG 2.2
  AA, work in right-to-left layouts and use the message catalogs, not hard-coded text.
- **Keep it simple.** Do not add a dependency, option or abstraction until it is needed. New
  dependencies must be license-compatible with AGPL-3.0.

## Security-sensitive changes

Changes to cryptography, authentication, sync or sharing (`packages/crypto`,
`packages/core/src/sync`, `packages/core/src/sharing`, the desktop IPC surface and the update
signing code; see [`.github/CODEOWNERS`](.github/CODEOWNERS)) need more:

- **Two reviewers.**
- **A threat-model note.** Append it to [`docs/threat-model.md`](docs/threat-model.md): what asset,
  trust boundary or attacker capability the change touches, and the mitigation.
- **An ADR and an architecture update** when the change alters cryptography, the protocol or a wire
  format: add an [ADR](docs/adr/README.md) and update `docs/ARCHITECTURE.md` in the same pull
  request.
- **Hostile-server tests** where a malicious relay could matter (tamper, replay, reorder, drop,
  downgrade).

## Documentation

Documentation is part of the change, not a follow-up.

- Keep user-facing pages current when behaviour changes, especially
  [self-hosting](docs/self-hosting.md), [privacy](docs/privacy.md) and
  [desktop](docs/desktop.md). The [index](docs/README.md) lists every page.
- Do not edit generated files by hand (see the table above).
- Record architecture decisions as ADRs: copy [`docs/adr/0000-template.md`](docs/adr/0000-template.md),
  take the next number, and add it to the [ADR index](docs/adr/README.md).
- Write for the reader: plain language, short paragraphs, one idea per sentence, and examples that
  work when copied. Use relative links between pages.
- Format Markdown with `pnpm format:docs`. CI runs `pnpm check:docs`.

## Commits and pull requests

- **Branch** from `main` with a short, typed name such as `fix/relay-timeout` or
  `docs/self-hosting-tls`.
- **Commits and pull request titles** follow [Conventional Commits](https://www.conventionalcommits.org/).
  A hook (`.githooks/commit-msg`, installed by `pnpm install`) checks the message with
  [commitlint](https://commitlint.js.org/): a type, an imperative summary of up to 100 characters,
  and body lines of up to 100 characters.
- **No AI-tool attribution.** Commit messages, pull request titles and descriptions do not contain
  AI-tool attribution or `Co-authored-by` lines for tools (constitution, Development Workflow).
- **Keep pull requests small and single-purpose.** Separate refactors, formatting and behaviour
  changes into separate pull requests, or at least separate commits.
- **Fill in the pull request template.** Say what changed and why, how you tested it, and, for
  security-sensitive changes, the threat-model note.
- **Link the issue** it closes (`Closes #123`).

## Review and merge

- `main` is protected: changes arrive by pull request, the `verify` check must pass on an up-to-date
  branch, history stays linear, and the rules apply to administrators too. Branch settings are in
  [docs/repo-settings.md](docs/repo-settings.md).
- Pull requests are **squash-merged**, so the pull request **title** becomes the commit on `main`
  and decides the next version (next section). Reviewers check it.
- Respond to review by pushing new commits; they are squashed on merge. Resolve conversations you
  have addressed.
- Maintainers verify the constitution's principles in every review.

## How a change becomes a release

The title of a squash-merged pull request is a Conventional Commit; that is what decides whether,
and how, the version moves:

| Title                                                                                                             | Version                | In a release?           |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------- |
| `fix: …`, `fix(web): …`                                                                                           | patch (1.2.3 to 1.2.4) | yes                     |
| `feat: …`, `feat(desktop): …`                                                                                     | minor (1.2.3 to 1.3.0) | yes                     |
| `feat!: …`, `fix!: …`, or a `BREAKING CHANGE:` footer                                                             | major (1.2.3 to 2.0.0) | yes, listed as breaking |
| `perf: …`, `revert: …`                                                                                            | patch                  | yes                     |
| `docs:`, `chore:`, `test:`, `ci:`, `build:`, `style:`, `refactor:`                                                | none                   | no                      |
| any title, when all changed files are under `apps/server`, `docs`, `specs`, `e2e`, `tests`, `deploy` or `.github` | none                   | no                      |

A bot keeps a **release proposal** pull request up to date with the next version and the changelog.
A maintainer approves a release by reviewing and merging that pull request; the installers for
Windows, macOS and Linux are then built, tested, signed where possible, and published automatically,
all or nothing. **Never tag by hand.** See [docs/repo-settings.md](docs/repo-settings.md) and
[docs/desktop.md](docs/desktop.md#releasing).

## License of your contribution

Cashfold is licensed under the [GNU Affero General Public License v3.0](LICENSE). By submitting a
contribution you agree that it is licensed under the same terms. There is no contributor license
agreement to sign.
