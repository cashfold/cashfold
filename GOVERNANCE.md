# Governance

This page describes how decisions are made in Cashfold. It is deliberately short: the project is
small, and the rules that matter most are in the constitution.

## The constitution

The [project constitution](.specify/memory/constitution.md) supersedes all other practices. It sets
the principles (zero-knowledge by construction, exact money, local-first, simplicity), the technology
constraints, the quality gates and the development workflow. Reviewers verify compliance in every
pull request.

Amending it takes a pull request with a written rationale, a migration plan for the artifacts it
affects, and maintainer approval. Versioning follows semantic rules: a major version for removed or
redefined principles, a minor version for added principles or materially expanded guidance, and a
patch version for clarifications.

## Roles

- **Maintainers** review and merge pull requests, approve releases, and handle security reports and
  conduct reports. The maintainers are listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).
  Today there is one: [@pogulailo](https://github.com/pogulailo).
- **Contributors** are everyone who opens an issue, a pull request or a review. See
  [CONTRIBUTING.md](CONTRIBUTING.md).

There is no formal process for becoming a maintainer yet. If you contribute regularly and would like
to take on more responsibility, say so in an issue.

## How decisions are made

- **Everyday changes** are decided in pull request review, by the rules in
  [CONTRIBUTING.md](CONTRIBUTING.md). A maintainer merges when the required check passes and the
  change meets the constitution.
- **Design decisions** that are costly to reverse are written down as
  [architecture decision records](docs/adr/README.md), with the context, the decision and what was
  rejected. Changes to cryptography, the protocol or a wire format require an ADR and an update to
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) in the same pull request.
- **Security-sensitive changes** need two reviewers and a threat-model note in
  [`docs/threat-model.md`](docs/threat-model.md).
- **Releases** are never made by hand. A bot keeps a release proposal pull request up to date, and a
  maintainer approves a release by merging it. See
  [How a change becomes a release](CONTRIBUTING.md#how-a-change-becomes-a-release).
- **Disagreements** are discussed in the issue or pull request. If there is no agreement, the
  maintainers decide and record the reason there, or in an ADR when it is a design question.

## Conduct and security

- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Vulnerabilities are handled under the [Security Policy](SECURITY.md).
