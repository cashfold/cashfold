# Phase 1 Data Model: Secure Finance Core

Entities, validation rules and state transitions derived from [spec.md](spec.md). Physical SQL for the device lives in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §8.2 and the server schema in §9.7. This document is the logical model both must satisfy.

**Conventions**: `id` is a 16-byte random UUID unless stated. `minor` = signed 64-bit integer count of currency minor units, held as `bigint` in TypeScript (`int64` below). `int16`/`int32` fields are ordinary integers and never money. `local_date` = integer `yyyymmdd`. `deleted` is a tombstone register, not a physical delete. A record deleted for more than 30 days is purged on every device and the service may discard its history after all active devices confirm (FR-052). Every synced record also has per-field logical-clock metadata (§S).

## A. Identity and access

### UserAccount
| Field | Type | Rules |
|---|---|---|
| account_id | 6-char id + 16-byte uuid | Non-secret, random |
| email | string | Normalised lower-case; unique per service |
| email_verified_at | timestamp? | Required before sharing features (FR-105); may be disabled by a self-hosted operator |
| discoverable | bool | Default true; controls email lookup for invitations (FR-106) |
| secret_key | 26 secret chars + `C1` + account_id | Exists only on the user's devices and Emergency Kit |
| kdf_params | {kind, m/t/p or iterations} | Must meet floors (ARCH §5.3); client rejects lower |
| enc_salt, auth_salt | 16 bytes each | Independent |
| keyset | encrypted blob | See KeySet |
| recovery | optional encrypted blob | Present only if Recovery Key enabled |

**Validation**: password ≥ 12 characters after normalisation and not in a common-password list (FR-001); NFKD normalisation and whitespace trimming before use (FR-005).

**State**: `Draft → Registered → Active → (PasswordChanged | SecretKeyRotated) → Active`. Failed sign-ins keep the account `Active` but increment a server-side counter and may enter `Locked(until)`. `Active → DeletionBlocked` while the user owns a Fold with other members (FR-101), then `Active → Deleted` (terminal; the server answers `410 Gone` and devices wipe local data).

**Service binding**: each account is registered on one service address (`server`). Migration (FR-100) moves the binding; a signed `set_server` log entry in each Fold re-points other members.

### KeySet
`{ v, uuid, enc{alg, pk, sk_ct}, sig{alg, pk, sk_ct}, kdf, encrypted_by }` (ARCH §5.4). Private keys only ever exist decrypted in core memory while unlocked.

### EmailVerification (server-side)
`{account_id, token_hash, expires_at, used_at}`. One-time, short-lived; the token is never stored in clear.

### Device
| Field | Rules |
|---|---|
| dev_id | uuid |
| sig_pk | Ed25519 public key, registered via a membership/device log entry |
| label | encrypted text |
| status | `Active → Revoked` (irreversible) |
| seq | strictly increasing counter of ops authored |

### Fold
| Field | Rules |
|---|---|
| fold_id | uuid |
| name | ≤ 80 chars |
| base_currency | valid code |
| epoch | u32 ≥ 1; increments only on `rotate_epoch` |
| pull_cursor | highest server sequence applied locally |

**State**: `Active → Deleted`. Deletion removes grants server-side and local data; requires confirmation (FR-022).

### Membership and MembershipLogEntry
| Field | Rules |
|---|---|
| role | `owner(1) / editor(2) / viewer(3)` |
| history_scope | `full` or `from_join` (FR-102); fixed at invitation |
| from_epoch | first epoch the member can decrypt; `1` for `full`, the rotated epoch for `from_join` |
| entry.type | `add_member, remove_member, leave, change_role, add_device, revoke_device, rotate_epoch, set_server` |
| entry.prev_hash | hash of previous entry (genesis = zero) |
| entry.sig | Ed25519 by an authorised signer |

**Rules**: at least one owner at all times (FR-088); only owners add/remove/change; chain must verify from genesis; an op signed by a device not authorised at that point in the chain is rejected (FR-085).

**State machine (member)**: `Invited → Verified(fingerprint) → Active → (RoleChanged) → Active → Removed | Left`. On entering `Removed` or `Left`, the member's devices delete the Fold's local copy at next contact (FR-104); a voluntary leaver is offered an export first.

**Invitation** `{fold, invitee_account, via ∈ {lookup, code}, role, history_scope, fingerprint, created_at, status ∈ {Pending, Accepted, Declined, Expired}}`. Created after the invitee is resolved by verified, rate-limited email lookup (discoverable accounts only) or by an invitation code the invitee supplies; the notification email carries no Fold information (FR-107). The invitee sees `history_scope` before accepting. `from_join` invitations trigger an epoch rotation, baseline republish and checkpoints (ARCH §7.6).

### FoldKeyGrant
`{ fold_id, epoch, member, role, enc, ct, granted_by, sig }` (ARCH §7.2). One per member per epoch the member may read: a `full` member holds envelopes for epochs `1..e`, a `from_join` member only from `from_epoch`.

## B. Financial entities (all inside a Fold; all encrypted before sync)

### Account
| Field | Type | Rules |
|---|---|---|
| kind | enum 1..6 | checking, savings, credit_card, cash, goal, loan |
| name | text 1–80 | |
| currency | code | immutable once any entry exists |
| opening_balance_minor | int64 | |
| opening_date | local_date | entries before this date are rejected |
| include_in_net_worth | bool | default true |
| credit_limit_minor | int64? | only kinds credit_card, loan |
| icon, color, sort_order | | |
| archived | bool | archived accounts accept no new entries (invariant 5) |
| group_ids | set of id | OR-Set |

**Derived**: `balance(asof) = opening_balance + Σ posted ledger entries ≤ asof` (FR-028); never stored as an editable value.

**Invariants**: kind `goal` accepts only transfers and adjustments (FR-029).

### AccountGroup
`{id, name, icon, color, sort_order}`; membership is stored on Account (`group_ids`).

### Category
| Field | Rules |
|---|---|
| direction | 1 expense, 2 income |
| parent_id | null or id of a root category with the same direction; depth ≤ 2 |
| name, icon, color, sort_order, archived | |

**Merge repair**: depth or cycle violations are displayed using a deterministic interpretation and flagged (ARCH §9.5).

### Payee, Tag
`{id, name, color}`. Usage counts are derived locally, never synced.

### Transaction
| Field | Type | Rules |
|---|---|---|
| account_id | id | must exist, not archived |
| direction | 0 adjustment / 1 expense / 2 income | |
| amount_minor | int64 | expense < 0, income > 0, adjustment any non-zero (FR-031) |
| currency | code | equals account currency (FR-032) |
| base_amount_minor, base_currency, fx_rate_id | int64, code, id? | frozen snapshot (FR-041) |
| occurred_utc_ms, tz_offset_min, local_date | int64, int16, int32 | `local_date` derived from the first two |
| category_id, payee_id | id? | direction of category must match |
| tag_ids | OR-Set, ≤ 8 | |
| note | text ≤ 2,000 | |
| place | {name, lat_e7, lon_e7}? | integers, no floats |
| attachment_ref | id? | |
| is_refund, is_pinned | bool | refund reduces budget "spent" |
| status | 0 pending / 1 posted / 2 void | |
| origin | {schedule_id, n}? | |
| import_id | id? | |

**Field group (merged atomically)**: `{amount_minor, currency, base_amount_minor, base_currency, fx_rate_id, direction}`.

**State machine**: `Pending → Posted → Void`; `Pending → Void`; `Void → Posted` allowed (restore); `deleted` is orthogonal (Recently deleted ≥ 30 days, FR-052).

### Transfer
| Field | Rules |
|---|---|
| from_account_id ≠ to_account_id | |
| from_amount_minor, to_amount_minor | both > 0; equal when currencies match |
| occurred_*, local_date, note, status, fx_rate_id | |

**Field group**: `{from_account_id, to_account_id, from_amount_minor, to_amount_minor, fx_rate_id}`. Materialises as two ledger entries (`out`, `in`) locally, never synced separately (FR-043–FR-045).

### LedgerEntry (derived)
`{account_id, ref_id, leg ∈ {single,out,in}, local_date, amount_minor, status}`, view over Transaction and Transfer.

### ExchangeRate
`{id, base="USD", quote, as_of_utc_s, rate_e12 > 0, source ∈ {service, custom}}`. Unique on `(quote, as_of)`. `service` rates come only from the user's Cashfold service rate table (FR-103); `custom` rates are user-entered.

### RateTable (server-side, shared)
`{as_of, base, source, rates: {code → decimal string}}`. One current table for all callers; no per-account data; publication can be disabled by the operator.

### Budget (Envelope)
| Field | Rules |
|---|---|
| direction | 1 expense, 2 income target |
| period_unit | day, week, month, year, custom |
| period_interval ≥ 1, anchor_local_date, custom_end_local_date? | |
| limit_minor ≥ 0, currency | |
| allocation_minor ≥ 0 | default = limit |
| rollover | 0 none, 1 carry_positive, 2 carry_all |
| scope | account set or group; category set; tag set; include_transfers |
| funded_from_account_id | optional |

### BudgetPeriod (derived, never stored)
`carry_in(p)`: 0 if rollover none or first period; `max(0, available(p-1))` if carry_positive; `available(p-1)` if carry_all.
`available(p) = carry_in(p) + allocation − spent(p)`.
`spent(p) = Σ −amount of matching posted entries in p` (converted exactly; refunds reduce).
Velocity: `burn = round_half_even(spent / d_elapsed)`; `projected = round_half_even(spent × d_total / d_elapsed)`; `overspend ⇔ projected > carry_in + allocation`.

### Goal
| Field | Rules |
|---|---|
| target_minor > 0, currency, target_local_date | |
| account_id | kind `goal`, one goal per goal account |
**Derived**: saved, remaining, percent, status ∈ {active, achieved, overdue}, `required_per_month = ceil(remaining / months_left)`, `months_left ≥ 1`.

### Schedule
| Field | Rules |
|---|---|
| kind | transaction or transfer; `template` payload |
| begin_local_date, end_local_date? | end ≥ begin |
| unit {day, week, month, year}, interval ≥ 1 | |
| requires_confirmation, reminder_min?, completed_utc_ms? | |
**Occurrence n** is computed from `begin` (ARCH §4.4); materialised record id = UUIDv5(schedule_id, n).
**State**: `Active → Completed`; `Completed` produces no further occurrences.

### Checkpoint (table 14)
`{kind ∈ {account_balance, envelope_carry}, subject, as_of_local_date, value_minor}`. Written when a `from_join` member is invited so that balances and rollover carry-in start from the join date. Members with full history ignore checkpoints.

### ImportBatch
`{id, source, imported_utc_ms, undone}`. Undo marks all records with `import_id` deleted in one operation set.

### Attachment
`{id, size, chunk_count, wrapped via Fold key}`; chunks authenticated individually with a final-chunk marker (truncation detected, FR-093).

## S. Synchronisation entities

### Op (OpEnvelope)
Plaintext routing header `{v, fold, op, rec, dev, seq, hlc, epoch, schema, sig}` plus encrypted `blob`. Payload `{t, f:{field_id → value}, fx:{set deltas}}`. Full wire format: [contracts/op-envelope.cddl](contracts/op-envelope.cddl).

**Validation order on receive**: version → signature → authorisation at causal position → HLC sanity (≤ now + 24 h) → AEAD tag → payload schema → apply. Any failure quarantines the op.

### FieldClock
`(fold, rec, field) → (hlc_wall, hlc_ctr, dev_id)`. Winner = maximum tuple.

### SyncQuarantine
`(fold, op, reason, seen_at)`. Surfaces in "Needs attention".

### Snapshot
Client-encrypted state at `at_seq`, signed. Server may prune ops ≤ `at_seq` only when all active devices acknowledged.

## Relationships (logical)

```text
UserAccount 1─* Device
UserAccount *─* Fold      (via Membership, role)
Fold 1─* Account, Category, Payee, Tag, Transaction, Transfer, Budget, Goal, Schedule, ExchangeRate, ImportBatch
Account *─* AccountGroup  (OR-Set on Account)
Category 0..1─1 Category  (parent, depth ≤ 2)
Transaction *─1 Account;  *─0..1 Category, Payee;  *─* Tag
Transfer *─1 Account (from), *─1 Account (to)
Budget *─* Account/Category/Tag (scope)
Goal 1─1 Account (kind=goal)
Schedule 1─* Transaction|Transfer (via origin)
```

## Cross-cutting validation rules (traceable to spec)
| Rule | Spec |
|---|---|
| Amount decimals ≤ currency exponent; no silent rounding | FR-037 |
| Range check on every arithmetic result; reject overflow | FR-038 |
| FX conversion single rule, half-even once | FR-040 |
| Orphan/depth/currency conflicts flagged, not auto-fixed | FR-078 |
| Destructive actions confirmed; 30-day recovery | FR-051/052 |
| Server never receives plaintext content | FR-011 |
