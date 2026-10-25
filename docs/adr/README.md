# Architecture decision records

An ADR records one decision that is costly to reverse: the problem, what was decided and what was
rejected, and what follows from it. They explain _why_ the code is the way it is, so a new
contributor does not have to rediscover it.

## Index

| ADR                                             | Decision                                                                           | Status   | Date       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-typescript-stack.md)                | TypeScript monorepo stack                                                          | accepted | 2026-10-18 |
| [0002](0002-encrypted-sqlite-opfs.md)           | Encrypted SQLite on OPFS via SQLite3 Multiple Ciphers                              | accepted | 2026-10-18 |
| [0003](0003-cbor.md)                            | In-house deterministic CBOR profile                                                | accepted | 2026-10-18 |
| [0004](0004-argon2id-wasm.md)                   | Argon2id via hash-wasm                                                             | accepted | 2026-10-18 |
| [0006](0006-srp-wasm.md)                        | Constant-time big-integer arithmetic for the SRP client                            | accepted | 2026-10-19 |
| [0007](0007-fold-sequence.md)                   | How the relay numbers a Fold's operations                                          | accepted | 2026-10    |
| [0008](0008-catalyst-ui-kit.md)                 | The interface is built on a vendored Catalyst kit                                  | accepted | 2026-10    |
| [0009](0009-electron-desktop-shell.md)          | The desktop app is an Electron shell around the web export                         | accepted | 2026-10-22 |
| [0010](0010-update-signatures.md)               | Application updates carry a project Ed25519 signature                              | accepted | 2026-10-22 |
| [0011](0011-languages-and-catalogue-loading.md) | Ukrainian and Polish, a device-local language choice, and lazily loaded catalogues | accepted | 2026-10-25 |

There is no ADR-0005. Numbers are never reused.

## When to write one

Write an ADR when a change:

- alters cryptography, the protocol or a wire format (an ADR is required, together with an update to
  [`ARCHITECTURE.md`](../ARCHITECTURE.md) in the same pull request);
- chooses or replaces a core technology or library;
- sets a rule the rest of the code must follow and that a newcomer would not guess.

Small, easily reversed choices do not need one.

## How to write one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md`, using the next number.
2. Fill in the status (`proposed`, `accepted`, or `superseded by ADR-XXXX`), the date, the context,
   the decision and the consequences.
3. Add a row to the index above, and open a pull request.

An accepted ADR is not rewritten. If the decision changes, write a new ADR, and mark the old one
`superseded by ADR-XXXX`.
