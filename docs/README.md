# Cashfold documentation

Everything about running, understanding and changing Cashfold. If you are new, read
[the README](../README.md) first.

## Using and running Cashfold

| Page                                      | What it covers                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Running your own relay](self-hosting.md) | Install the sync service with Docker, put a reverse proxy in front, and publish the web app                   |
| [What the service can see](privacy.md)    | Exactly what the relay can and cannot learn, what is public, and what happens after deletion                  |
| [The web app as an installed app](pwa.md) | How the web app installs, works offline and updates itself without losing what you typed                      |
| [The desktop app](desktop.md)             | Installing, updating and troubleshooting the Windows, macOS and Linux apps, and how they are built and signed |

## How it works

| Page                            | What it covers                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md) | The design: keys and sign-in, the data model, sync, sharing, the relay and client hardening   |
| [The ledger](ledger.md)         | How accounts, transactions and exchange rates are stored, merged and read                     |
| [Sync across devices](sync.md)  | How devices stay in step through a relay that sees only ciphertext, and what is not built yet |
| [Wire protocol](protocol.md)    | The relay's endpoints and wire formats. Generated from the schemas; do not edit by hand       |
| [Languages](i18n.md)            | How the language is chosen, where the text lives, and how to add or change a message          |

## Decisions and quality

| Page                                               | What it covers                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [Architecture decision records](adr/)              | Why the stack and the main designs are what they are                      |
| [Constitution](../.specify/memory/constitution.md) | The principles, quality gates and workflow that override every other page |

## Working on the project

| Page                                    | What it covers                                                   |
| --------------------------------------- | ---------------------------------------------------------------- |
| [Contributing](../CONTRIBUTING.md)      | Setup, checks, code rules, commits and releases                  |
| [Repository settings](repo-settings.md) | Branch protection, the release pipeline and the secrets it needs |
| [Feature specs](../specs/)              | The specification, plan and tasks of each feature                |

## Reference material

[`reference/reference-app/`](reference/reference-app/README.md) holds notes on another app, written
as input to the feature specs. It is background reading, not a description of Cashfold.

## Writing documentation

- Put a page in `docs/`, link it from this index, and use relative links.
- Pages that are generated say so in their first line: change the generator, not the page. The
  generated files are `protocol.md`, `../THIRD_PARTY_NOTICES.md` and the changelog.
- Format with `pnpm format:docs`; CI runs `pnpm check:docs`.
- Record a decision that is costly to reverse as an [ADR](adr/), if you want to.
