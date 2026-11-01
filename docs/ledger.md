# The ledger (user story 2)

How accounts, categories, payees, tags, transactions and exchange rates are stored, merged and read. The rules come from
[`data-model.md`](../specs/001-secure-finance-core/data-model.md); this page records the decisions that file leaves open.

## Records and field numbers

Every ledger entity is a record in the generic merge state (table code + numbered fields, last writer wins per field, add-wins
sets). The numbers are part of the wire format and live in
[`packages/core/src/ledger/domain/tables.ts`](../packages/core/src/ledger/domain/tables.ts). They are append-only:
a shipped number is never reused or renumbered. [`vectors/ops/schema-1-ledger.json`](../vectors/ops/schema-1-ledger.json) is a frozen
set of ops written with schema 1; `frozen-fixture.test.ts` replays it and fails if a number moves.

| Table         | Code | Notes                                                    |
| ------------- | ---- | -------------------------------------------------------- |
| account       | 1    | `group_ids` is an add-wins set                           |
| account group | 2    |                                                          |
| category      | 3    | `parent_id` null for a root; depth at most 2             |
| payee, tag    | 4, 5 | name and colour                                          |
| transaction   | 6    | `tag_ids` is an add-wins set; see the amount group below |
| transfer      | 7    | one record, two amounts; see below                       |
| exchange rate | 11   |                                                          |
| settings      | 13   | the Fold's name and base currency                        |

**Amount group.** `amount_minor`, `currency`, `base_amount_minor`, `base_currency`, `fx_rate_id`, `fx_base_rate_id` and `direction`
are written together or not at all (`LEDGER_GROUPS`), so a concurrent edit of the amount cannot be torn from its currency or its
frozen base amount. `fx_base_rate_id` (field 25) is an addition to the data model: converting between two non-USD currencies
uses two rates, and both are recorded.

**Last change (FR-053)** is not a stored field. It is read from the field clocks: the newest write to the record and the device that
made it.

## Amounts you type

A money field takes a plain number (`12.50`) or a sum made of numbers, `+`, `−` (`-`), `×` (`*`, `x`), `÷` (`/`) and brackets, such as `12.50 + 3.20 * 2 + 4`. The sum stays in the field as typed, the field shows its result beside it, and only the result is saved: nothing about the sum is stored, synced or exported. Sums are worked out exactly (a value is a fraction of two `bigint`s, so `10 / 3 * 3` is `10`), in the language's own number marks, and rounded once at the end, half to even, to the currency's decimals. A plain number with more decimals than the currency has is still an error; only a calculated result is rounded. The code is `shared-kernel/amount-expression.ts` in `core`, loaded as its own small chunk by the web app.

## Balances

`balance(account, asOf) = opening + Σ posted entries dated ≤ asOf`, as `bigint`, computed from the entries every time and never
stored. Pending and void entries and deleted records do not count. Only the final sum is range-checked (it must fit in 64 bits), so the
result does not depend on the order entries are visited in. A balance beyond 64 bits is refused, never wrapped.

A balance adjustment is an ordinary entry of direction `adjustment` for `target − balance(account, date)`. Reports leave adjustments
out unless the user turns on "adjustments as income and expenses"; then a negative one counts as spending and a positive one as income.

## Transfers

A transfer is one record with a source account, a destination account and an amount for each side (`from_amount_minor`,
`to_amount_minor`). It materialises as two ledger entries, `out` (negative, in the source currency) and `in` (positive, in the
destination currency), and is never synced as two things. `from_account_id`, `to_account_id`, both amounts and `fx_rate_id` are one
field group (`TRANSFER_GROUP`): an edit writes all five in one op, so two devices editing at once end with one whole version, never
the amount of one and the account of the other. Editing, deleting and restoring act on both sides because there is only one record.

Same-currency accounts exchange equal amounts. Across currencies each side is exactly what the person entered; a rate is only ever
offered as a suggestion for the destination field and `fx_rate_id` merely records which rate they used. Transfers carry no base-currency
snapshot. When "transfers as income and expenses" is on, reports convert each leg with the nearest rate at or before the end of its day
and name any currency that has none.

Repair: a transfer whose account is missing is hidden (so the other account is not left short by half a transfer) and listed in Needs
attention; one that breaks its own rules (same account, amount not above zero, unequal amounts in one currency) is left out of balances.

Rates are units of the quote currency per one USD, scaled by 10^12, unique per `(quote, as_of)`. When a transaction is saved, its
base-currency equivalent is frozen using the **nearest rate at or before the transaction's time** for each currency, one division and
one half-even rounding. A rate added later never changes history; `revalue` is the only way to re-snapshot.

**No rate, no guess.** If a transaction's currency (or the Fold's base currency) has no usable rate, saving is refused with
`rate_required` and the currency, and the screen asks for a rate (`setCustomRate`) before saving. The data model makes the base amount
mandatory, and a made-up equivalent would corrupt every total. Net worth works the same way: a currency with no rate is named and left
out of the total.

Two devices can create a rate for the same `(quote, as_of)` under different ids. Every device picks the same winner (a custom rate beats a
service rate, then the lower id) and the loser is listed in Needs attention.

## Deleted records

Deleting writes a tombstone. For 30 days the record is in Recently deleted on every device and `restoreTransaction` works, including on
a device that was offline during the delete. The 30 days run from the **tombstone's own clock**, not from when a device learned of it.

After 30 days `purgeExpired` removes the record, its field history and the payload of its ops, and remembers its id (`purged_record`). It
keeps the op _headers_ so a re-delivered op is still a duplicate and a device's sequence numbers stay reserved. A late op for a purged
record is quarantined with reason `purged_record` and shown in Needs attention. The purge runs when a session starts.

Known race: a restore authored on one device just inside the window can reach a device that has already purged. That device keeps the
op in quarantine; the restoring device keeps the record. The two diverge until the user acts. Discarding the matching history on the
relay, once every device has confirmed, belongs to the sync story.

## Repair

CRDTs converge but do not keep application rules, so [`repair-rules.ts`](../packages/core/src/ledger/application/repair-rules.ts)
reports violations on merged state. The rules never write; every device repairs identically. Messages carry no amounts, names or notes.

| Finding                                                          | Effect                       |
| ---------------------------------------------------------------- | ---------------------------- |
| orphan transaction (its account is gone)                         | hidden                       |
| currency differs from the account                                | left out of balances         |
| sign contradicts the type                                        | left out of balances         |
| category cycle, depth over 2, missing parent, direction mismatch | read as a top-level category |
| two rates for one `(quote, as_of)`                               | the loser is unused          |
| record that cannot be read                                       | hidden                       |

## What is not built yet

- **SQL read models.** Migration 0002 defines `account`, `txn`, `ledger_entry`, `account_balance` and the rest, but nothing writes them yet.
  Screens read a ledger projected in memory from the merge state and cached per Fold until the next change. That is exact and fast enough
  for thousands of transactions; the 50,000-transaction target (SC-008) is measured on the raw tables and needs these read models, or an
  incrementally maintained projection, before the screens can claim it.
- **A transaction's place** is stored (`place_name`, `lat_e7`, `lon_e7` as integers) but the entry form has no field for it yet.
- **Attachments** wait for user story 9.
