# `@cashfold/protocol`

The wire types and schemas that the client and the relay share: the operation envelope, grants,
snapshots, the membership log entries and the request and response bodies. It also holds the
in-house deterministic CBOR profile ([ADR-0003](../../docs/adr/0003-cbor.md)).

Neither side imports the other's code, only this contract.

## Entry points

| Import                        | What it is                                    |
| ----------------------------- | --------------------------------------------- |
| `@cashfold/protocol`          | Schemas and types                             |
| `@cashfold/protocol/cbor`     | Encoding and decoding                         |
| `@cashfold/protocol/wire`     | Operation envelope encoding and signing bytes |
| `@cashfold/protocol/snapshot` | The snapshot wire format                      |

## The generated reference

[`docs/protocol.md`](../../docs/protocol.md) is generated from the schemas and the contracts in
`specs/001-secure-finance-core/contracts/`. Never edit it by hand:

```sh
node scripts/gen-protocol-docs.mjs     # CI fails if the committed file differs
```

## Rules for this package

- A change to a wire format needs an [ADR](../../docs/adr/README.md), an update to
  [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) and a threat-model note in the same pull request.
- Keep the contract tests between client and relay passing; frozen test vectors in
  [`vectors/`](../../vectors) must not change by accident.

## Test

```sh
pnpm --filter @cashfold/protocol typecheck
pnpm --filter @cashfold/protocol test
```
