# `@cashfold/core`

The domain and application layers of Cashfold, independent of any framework: accounts, transactions,
budgets, schedules, sharing and the sync engine. It runs the same way in the browser worker, in
tests and anywhere else JavaScript runs.

It uses domain-driven design, a hexagonal layout and CQRS, with an event-sourced operation log that
merges as a CRDT. The rules are in [Architecture](../../docs/ARCHITECTURE.md) (section 0.3) and the
[constitution](../../.specify/memory/constitution.md).

## Rules for this package

- It imports only [`@cashfold/protocol`](../protocol/README.md) and the ports it defines itself. It
  must not import React, Next, Nest, the DOM or Node-only modules. `src/architecture.test.ts` and the
  lint rules enforce the boundaries.
- Money is a `bigint` in minor units. Never use `number` for amounts.
- Domain and sync code is written test first. Property tests cover balances, rollover, recurrence and
  convergence of replicas under partition, duplication and reordering.
- Changes under `src/sync/` and `src/sharing/` need two reviewers and a threat-model note; see
  [Contributing](../../CONTRIBUTING.md#security-sensitive-changes).

## Layout

Each area has a `domain` layer (entities, value objects and invariants, no I/O) and an `application`
layer (commands, queries and ports); ports are implemented outside this package.

| Folder               | Area                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `src/ledger/`        | Accounts, categories, payees, tags, transactions, transfers, rates     |
| `src/budgeting/`     | Envelope budgets, rollover and goals                                   |
| `src/scheduling/`    | Recurring schedules and projected balances                             |
| `src/identity/`      | Accounts, devices and credentials                                      |
| `src/sharing/`       | Folds shared between accounts: the membership log, roles, key rotation |
| `src/sync/`          | The operation log, merge rules, snapshots and the sync client          |
| `src/shared-kernel/` | Ids, amounts and other values shared by all areas                      |
| `src/testing/`       | In-memory replicas and relays for multi-device tests                   |

## Test

```sh
pnpm --filter @cashfold/core typecheck
pnpm --filter @cashfold/core test
```

See also [The ledger](../../docs/ledger.md) and [Sync across devices](../../docs/sync.md).
