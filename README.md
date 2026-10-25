# Cashfold

[![CI](https://github.com/cashfold/cashfold/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cashfold/cashfold/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/github/license/cashfold/cashfold)](LICENSE)

**A local-first, zero-trust personal finance app.** Your accounts, budgets and transactions are
encrypted on your own devices, and stay readable only to you. Sync and sharing go through a relay
server that stores ciphertext it cannot read.

Cashfold runs in the browser, and as an app for Windows, macOS and Linux. It works offline, keeps
exact money amounts (integers, never floating point), and treats the server as untrusted.

> **Status: pre-1.0.** Screens and data formats can still change between 0.x releases. Read the
> [changelog](CHANGELOG.md) before you upgrade, and keep an encrypted backup of anything you care
> about.

## Highlights

- **Ledger.** Accounts, categories, payees, tags, transactions and transfers, in any currency, with
  exchange rates. Attach files to transactions. Import and export CSV.
- **Planning.** Envelope budgets with a rollover policy, recurring schedules with projected
  balances, and savings goals.
- **Sync and sharing.** Keep several devices in step. Share a Fold (a ledger such as _Personal_ or
  _Family_) with other people as owner, editor or viewer. Removing someone rotates the keys.
- **Privacy by construction.** Two secrets protect your account: a password and a Secret Key that
  never leave your devices. Passwords are stretched with Argon2id, sign-in uses SRP, and data at
  rest is an encrypted SQLite database.
- **Recovery you control.** An Emergency Kit, an optional Recovery Key, encrypted backups, and
  optional quick unlock with your device's biometrics or PIN.
- **Open source.** AGPL-3.0, with a [threat model](docs/threat-model.md), documented
  [architecture decisions](docs/adr/README.md) and a reproducible web build.

## Get Cashfold

### Desktop app

Download the installer for your system from the
[releases page](https://github.com/cashfold/cashfold/releases/latest).

| System                       | File                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Windows 10 and later, 64-bit | `Cashfold-<version>-win-x64.exe`                                             |
| macOS 12 and later           | `Cashfold-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel) |
| Linux, 64-bit                | `Cashfold-<version>-linux-x64.AppImage`, `.deb` or `.rpm`                    |

It is the same app as in the browser, in its own window. The same account works on both, and your
data stays in your computer's application-data folder. The app tells you when a new version exists
and installs it only when you say so.

**Unsigned builds.** Until the installers are code-signed, the release is marked **UNSIGNED BUILD**
and your system warns you the first time you open the app. Check the download first (below), then:

- **macOS:** open **System Settings → Privacy & Security**, scroll to the message about Cashfold
  and choose **Open Anyway**. On older versions of macOS, Control-click the app and choose
  **Open**.
- **Windows:** in the SmartScreen window choose **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`) and run it. On Ubuntu 23.10 and later see
  [Troubleshooting](docs/desktop.md#troubleshooting).

**Check what you downloaded.** Every release lists a checksum for each file and a build
attestation:

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify <file> --repo cashfold/cashfold
```

### Web app and your own relay

The web app is a static site, and the relay is a small service you can run yourself with Docker.
[Running your own relay](docs/self-hosting.md) walks through both. Without a relay, everything stays
on one device. Read [what the service can see](docs/privacy.md) before you pick one.

## How your data is protected

- Everything is encrypted on your device before it leaves it. The relay stores and forwards
  ciphertext and a little routing data, and [the list of what it can learn](docs/privacy.md) is
  exact.
- Your password and Secret Key are never sent to the relay. If you lose your password or your Secret
  Key and have no Recovery Key, nobody can recover your data, including the maintainers. That is
  how zero-knowledge works, so keep your Emergency Kit and Recovery Key somewhere safe.
- The [threat model](docs/threat-model.md) states who is defended against, what is out of scope and
  which risks are accepted. The [security review](docs/security-review/README.md) records what has
  been reviewed.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Documentation

Start at the [documentation index](docs/README.md). The most useful pages:

| If you want to…                        | Read                                         |
| -------------------------------------- | -------------------------------------------- |
| run a relay for your devices           | [docs/self-hosting.md](docs/self-hosting.md) |
| know what the service can see          | [docs/privacy.md](docs/privacy.md)           |
| understand the design                  | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| build, test or release the desktop app | [docs/desktop.md](docs/desktop.md)           |
| see why a technology was chosen        | [docs/adr/](docs/adr/README.md)              |

## Development

You need [Node.js](https://nodejs.org/) 26 (see [`.nvmrc`](.nvmrc)) and
[pnpm](https://pnpm.io/) 10 (`corepack enable` picks the version pinned in `package.json`).

```sh
pnpm install                       # also activates the commit-message hook
pnpm --filter @cashfold/web dev    # the web app on http://localhost:3000
pnpm --filter @cashfold/desktop dev    # the desktop app, from source
pnpm verify                        # type-check, lint and unit tests
```

| Path                | What it is                                                             |
| ------------------- | ---------------------------------------------------------------------- |
| `apps/web`          | The web client: Next.js static export, the worker and storage adapters |
| `apps/server`       | The relay: NestJS with PostgreSQL (or in memory for trials)            |
| `apps/desktop`      | The Electron shell around the web export                               |
| `packages/core`     | The domain and application layers, independent of any framework        |
| `packages/crypto`   | All cryptography, behind narrow interfaces                             |
| `packages/protocol` | Wire types and schemas shared by client and server                     |
| `packages/platform` | The contract between the desktop shell and the page                    |
| `docs/`             | Architecture, protocol, operations and decisions                       |

[CONTRIBUTING.md](CONTRIBUTING.md) has the full workflow: tests, commit titles, reviews and how a
change becomes a release.

## Contributing, support and conduct

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- For questions and help, see [SUPPORT.md](SUPPORT.md).
- Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- How the project is run is described in [GOVERNANCE.md](GOVERNANCE.md).

## License

Cashfold is licensed under the [GNU Affero General Public License v3.0](LICENSE). Third-party
components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
