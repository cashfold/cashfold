# ADR-0007: How the relay numbers a Fold's operations

- Status: accepted
- Date: 2026-10
- Decides: the open item in research.md R-13

## Context

Every operation pushed to a Fold gets a `server_seq`: gapless, increasing, and the order every device pulls in. Two ways to assign it in PostgreSQL were left open: lock the Fold's row and keep the counter in it, or give each Fold a database sequence. Separately, the first implementation of a push issued three queries per operation. We measured both.

## Measurements

`apps/server/test/load.int.test.ts` (run with `LOAD=1`) against PostgreSQL 17 in a container with default settings on a laptop. Operations are 320-byte sealed blobs pushed in batches of 256, the largest batch a client sends. The store is measured directly, so the figures leave out HTTP, SRP and the sealed frame.

| | per-operation queries (before) | set-based push (after) | memory store |
| --- | --- | --- | --- |
| 1 device, 1 Fold | 1,642 ops/s | **28,601 ops/s** | 260,000 ops/s |
| 4 devices into 1 Fold | 1,667 ops/s, p95 620 ms | **31,636 ops/s**, p95 40 ms | 411,000 ops/s |
| 16 devices into 1 Fold | 1,628 ops/s, p95 2,555 ms | **25,614 ops/s**, p95 191 ms | 369,000 ops/s |
| 16 devices into 16 Folds | 7,375 ops/s, p95 696 ms | **151,455 ops/s**, p95 33 ms | 388,000 ops/s |
| pull, pages of 500 | 177,000 ops/s | 165,000 ops/s | 1.3 million ops/s |

## Decision

1. **Keep the locked Fold row as the counter** (`SELECT head_seq … FOR UPDATE`, then `UPDATE fold SET head_seq`). It makes the numbering gapless and ties it to the transaction that stores the operations; a database sequence would leave gaps on rollback and would need a second mechanism to give the same guarantee.
2. **Make the push set-based.** One query finds operations already stored, one finds each device's last sequence number, and one `INSERT … SELECT FROM unnest(…)` stores the accepted ones. The lock is held for a few milliseconds instead of hundreds. This was the cost, not the lock: 16 devices writing into one Fold now get about the same total throughput as one device (they take turns), and Folds do not contend with each other (about 5× more with 16 Folds than with one).
3. **No sharding of the counter per device or per record.** A Fold is the unit of ordering, and the figures above are two to three orders of magnitude above what a Fold sees (a household makes a handful of changes a minute).

## Consequences

- At the measured rate a single relay on one small PostgreSQL instance carries the work of tens of thousands of active Folds. The bottleneck at scale will be connections and storage, not numbering.
- Pull is unchanged and index-only on `(fold_id, server_seq)`.
- If a single Fold ever needs more than about 25,000 operations a second (bulk import of a very large history), the batch limit and the lock hold time are the two things to look at first, not the mechanism.
- Figures are for default settings in a container on one machine; the test is in the repository so an operator can repeat it on their own hardware.
