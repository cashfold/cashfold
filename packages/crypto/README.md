# `@cashfold/crypto`

All of Cashfold's cryptography, behind narrow interfaces (`Aead`, `Kdf`, `Hpke`, `Signer`, `Pake`,
`Rng` and others), so the rest of the code never calls a primitive directly. Adapters use WebCrypto,
[`@noble/*`](https://github.com/paulmillr/noble-curves), Argon2id and SRP in WebAssembly.

It imports nothing from `@cashfold/core`. The design is in [Architecture](../../docs/ARCHITECTURE.md)
(sections 5 and 6).

## What is here

| Folder                                                       | What it provides                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/ports/`, `src/adapters/`                                | The interfaces and their implementations                                 |
| `src/two-skd/`, `src/secret-key/`                            | Key derivation from a password and a Secret Key                          |
| `src/pake/`, `src/transport/`                                | SRP sign-in and the authenticated, counter-bound transport frame         |
| `src/keyset/`, `src/hpke/`                                   | The account key set and sealing a key to a recipient                     |
| `src/op/`, `src/record/`, `src/snapshot/`, `src/attachment/` | Sealing and signing operations, records, snapshots and attachment pieces |
| `src/membership/`                                            | Signing the membership log of a shared Fold                              |
| `src/recovery/`, `src/backup/`                               | The Recovery Key and encrypted backups                                   |
| `src/secret-buf.ts`                                          | A buffer for secrets that is wiped when released                         |

## Rules for this package

- **Known-answer tests for every primitive.** Fixed vectors live in [`vectors/`](../../vectors). The
  relay has its own, separate implementation of the sealed transport frame, and its tests run it
  against this one and against fixed vectors, so a shared mistake cannot hide.
- **Test first**, and no hand-written primitives.
- JavaScript cannot guarantee that memory is erased. `SecretBuf` wipes what it controls; the limit is
  listed in the threat model as an accepted risk.

## Test

```sh
pnpm --filter @cashfold/crypto typecheck
pnpm --filter @cashfold/crypto test
```
