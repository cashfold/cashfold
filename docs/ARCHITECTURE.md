# Cashfold — Architectural Blueprint & Technical Specification

**Status:** Draft 0.2 (aligned with constitution v1.0.1) · **Date:** 2026-10-18 · **Audience:** engineers implementing the Cashfold TypeScript core, the web client (Phase 1), the NestJS relay server, and later the Tauri desktop/mobile shells.

Cashfold is a local-first, end-to-end encrypted (E2EE) personal-finance engine: an exact-arithmetic ledger, envelope budgeting, recurring transactions and multi-currency support, synchronised across devices and users through an untrusted relay server.

Normative keywords (MUST, SHOULD, MAY) follow RFC 2119.

---

## 0. Conventions and design decisions

### 0.1 Tags
| Tag | Meaning |
|---|---|
| **[DESIGN]** | A Cashfold decision. Where a section carries no tag, it is normative design as well. |
| **[VERIFY]** | A value or format that must be confirmed during implementation (see §12). |

### 0.2 Key decisions
1. **Budgets** are envelope-based with explicit rollover policy and spend velocity (§3.7). Balances and availability are always derived, never stored.
2. **Accounts** have an explicit `AccountKind` (§3.3).
3. **Money** is signed 64-bit integer minor units. FX rates are scaled integers (§3.1, §3.8).
4. **Password hashing** is Argon2id (vetted WASM build) with a PBKDF2-HMAC-SHA256 (WebCrypto) fallback (§5.3).
5. **Asymmetric cryptography** is X25519 (sealing via HPKE) and Ed25519 (signatures) (§5.1).
6. **SRP** is SRP-6a with SHA-256 over the 4096-bit RFC 3526 group, with a fully pinned message format (§6).
7. **Cashfold defines its own protocols.** Interoperability with any other product is not a goal.
8. **Stack**: TypeScript throughout; Next.js static export + Tailwind for the web client; NestJS + PostgreSQL for the relay; web first, an Electron desktop shell (ADR-0009, §10.1), mobile shells later (§0.3). This follows the project constitution (`.specify/memory/constitution.md`), which prevails over this document on technology.
9. **Software architecture**: DDD, Clean/Hexagonal architecture, CQRS, and event sourcing adapted to CRDT sync, all inside the client `core` package; the server holds no domain model (§0.3).
8. AES-256-GCM, HKDF-SHA256 and a Secret Key of at least 128 bits of entropy are fixed requirements.

### 0.3 Software architecture (normative)

**Packages (pnpm monorepo)**

| Package | Responsibility | May import |
|---|---|---|
| `packages/core` | Domain + application layers: aggregates, value objects, commands, queries, projections, merge, repair, sync engine logic. Framework-agnostic. | `protocol`, ports only |
| `packages/crypto` | All cryptography behind narrow interfaces (`Aead`, `Kdf`, `Hpke`, `Signer`, `Pake`, `Rng`, `Cbor`). Adapters: WebCrypto, `@noble/*`, Argon2id WASM, SRP WASM. | none of `core` |
| `packages/protocol` | Wire types and schemas (zod + generated OpenAPI/CDDL docs) shared by client and server. | none |
| `apps/web` | Next.js App Router + Tailwind, **client-only static export**. UI, worker bootstrap, storage adapters. | `core`, `crypto`, `protocol` |
| `apps/server` | NestJS + PostgreSQL relay. Thin adapters only. | `protocol` (never `core` domain) |

`core` MUST NOT import React, Next, Nest, the DOM or Node-only modules. Dependency direction is enforced in CI with boundary lint rules.

**Layers inside `core`** (dependencies point inward)

```text
domain        entities/aggregates, value objects (Money, CurrencyCode, LocalDate, Rate), domain services, invariants. No I/O.
application   command handlers, query handlers, projection builders, sync use cases. Defines ports.
adapters      implementations of ports: OpLogStore (SQLite), ProjectionStore (SQLite), CryptoPort, TransportPort,
              KeyStorePort, ClockPort, RandomPort. Live in apps/web or in dedicated adapter packages, not in domain/application.
```

**Bounded contexts**: Identity & Access, Ledger (accounts, transactions, transfers, categories, payees, tags, FX), Budgeting (envelopes, goals), Scheduling (recurrence), Sharing & Membership (folds, membership log, envelopes), Sync (op log, HLC, merge, transport). Contexts talk through application-level interfaces and ids; aggregates reference each other by id only.

**CQRS and event sourcing mapping**

1. A **command** (intent-named, validated, authorised against the member's role) is handled by an application service.
2. The handler rehydrates the target aggregate from the read model, calls domain behaviour, and receives the resulting **field patches** (per-field LWW writes, set deltas, tombstones).
3. The handler turns the patches into a signed, encrypted **operation** (§9.3) and appends it to the local **op log** in the same SQLite transaction that updates the projections. The op log is the event store and the source of truth.
4. **Projections** (SQLite read models, §8.2 tables and views) are produced by a single pure `apply(op)` function from merged field state. Local and remote operations follow the identical path (§8.2 rule). Projections are rebuildable by replaying the log.
5. **Domain events** (for example `TransactionRecorded`, `BudgetOverspent`) are derived by diffing projection state before and after `apply`, and are used only locally (UI refresh, notifications, derived recomputation). They are not replicated; the replicated form is the operation.
6. **Queries** read projections only and never mutate. Derived values (balances, envelope availability, goal progress) are computed from projections (§4).
7. Operation and payload schemas are versioned (`schema` field). Every schema change ships an **upcaster** and a replay test over frozen fixtures.

**Runtime topology (web)**

```text
UI thread (React/Next client components)  ⇄ typed RPC ⇄  Core Worker (dedicated)
                                                          ├─ core (domain/application)
                                                          ├─ SQLite WASM on OPFS (encrypted, §8)
                                                          ├─ keys (non-extractable CryptoKey / in-memory buffers)
                                                          └─ sync client (fetch / WebSocket)
```

- The UI thread holds no key material, only opaque session handles and read-model results.
- **Offline app shell.** A service worker precaches the hashed static export (HTML, JS, CSS, WASM, fonts) and serves it cache-first, so the app opens and runs after a reload or browser restart with no network. The service worker handles only same-origin static assets: it never sees API traffic bodies, keys or user data. Cache updates are atomic (new version activates only after full precache) and every asset is checked against the published hash manifest (§10.9). Offline reload is covered by an end-to-end test.
- One Core Worker owns the database. Multiple tabs coordinate with the Web Locks API (single writer) and are notified of changes through a `BroadcastChannel`; non-leader tabs proxy through the leader worker (a `SharedWorker` is used where available).
- Next.js is used as a build tool and router. The application routes are statically exported and contain no server components, server actions or API routes touching user data. Marketing and documentation routes MAY be server-rendered.

**Server (NestJS) shape**: modules `auth`, `devices`, `folds`, `membership`, `ops`, `snapshots`, `attachments`, `rates`, `mail`. Each module is controller → application service → repository (PostgreSQL). Request/response schemas come from `protocol`. The server verifies signatures and structural rules only (§9.6); it has no domain entities.

**Later platforms**: the desktop shell is Electron (ADR-0009, §10.1) and loads the same static export unchanged. Mobile shells are later, with their technology not yet decided. A shell MAY supply hardware-backed key storage behind `KeyStorePort`. No shell MAY require changes to `core`, `crypto` or `protocol`.

---

### 0.x The interface layer (spec 002)

The client UI is organised as follows. It changes presentation only; the Core Worker's commands and queries, the domain, the wire protocol and the database are untouched (FR-048).

- **Shell** (`apps/web/src/ui/shell/`): five primary sections (Overview, Transactions, Accounts, Plan, Settings) from one route table (`routes.ts`), a persistent sidebar that is a drawer on narrow screens, the Fold switcher, sync status and Lock in one place, one `<main id="main">`, banners, `OverlayHost` (overlays follow the lock and the privacy cover) and `StatusProvider` (brief confirmations in a polite live region). Old addresses are tiny redirect pages (`RedirectStub`).
- **Add sheet** (`ui/transactions/`): one place to enter or edit a transaction or transfer, opened over any screen by `?new=expense|income|transfer` or by `useAddSheet().openAdd`. Which fields show is decided by the field registry (`ui/prefs/fields.ts`, `visibleFields`).
- **Kit** (`ui/kit/`): the only place Catalyst-derived and Headless UI code lives; see ADR-0008. Screens import from `ui/kit/index.ts` only.
- **Preferences** (`ui/prefs/`, `ui/theme/`): device-local presentation state in `localStorage` key `cashfold.ui`, parsed defensively, never synced or exported. Themes are the `data-theme` attribute on `<html>`, set before first paint.
- **Routes**: `/overview/`, `/transactions/`, `/accounts/`, `/plan/?view=`, `/settings/` with seven group pages, plus the unchanged sign-in, sign-up, recover and add-device pages.

## 1. Goals, non-goals, threat model

### 1.1 Goals
- G1. All financial data is encrypted on the client before it leaves the device. The server holds only ciphertext and opaque routing metadata.
- G2. Fully functional offline. The server is a relay and backup, never an authority over content.
- G3. Exact arithmetic. No floating point appears anywhere in money paths.
- G4. A stolen server database is useless for offline cracking of the user's password (2SKD).
- G5. Multiple users can share a Fold. Revocation is cryptographic via key rotation.

### 1.2 Non-goals (v1)
- Bank aggregation (Plaid etc.). It would require plaintext on a server.
- Server-side search or analytics.
- Hiding traffic-analysis metadata (record count, sizes, timing). See §9.8.
- Post-quantum algorithms. Algorithm identifiers are versioned so a migration is possible (§5.9).

### 1.3 Adversaries

| ID | Adversary | Capability | Mitigation |
|---|---|---|---|
| A1 | Passive network | Reads traffic | TLS 1.3 plus SRP-derived AEAD layer (§6.5) |
| A2 | Active network / replay | Modifies or replays messages | Counter-bound AEAD, signed ops, per-device sequence numbers |
| A3 | Honest-but-curious server | Reads DB and logs | E2EE; verifier uncrackable without Secret Key (2SKD) |
| A4 | Malicious server | Reorders, drops, forges ops, serves wrong keys | Signed ops, signed membership log, AAD binding, fingerprint verification (§7.4) |
| A5 | Stolen device (locked) | Browser profile / disk image | Encrypted database (§8.1); Secret Key encrypted at rest (§5.2); keys never stored in the clear |
| A6 | Revoked member | Retains old keys | Key epoch rotation (§7.5). Past data seen is not recallable. |
| A7 | Malware or hostile extension on unlocked device | Out of scope | Mitigation limited to client hardening (§10) |
| A8 | Compromised web host, CDN or dependency (code-delivery attack) | Serves modified JavaScript that exfiltrates keys | Strict CSP, SRI, pinned and provenance-checked builds, SBOM, no third-party scripts, reproducible builds with published hashes; residual risk is inherent to web delivery and is the main reason for the later Tauri shells (bundled, signed code). The app states this limit in its threat model. |

---

## 2. Domain requirements

### 2.1 Behaviours the engine must support
- **Reporting toggles:** "adjustments as income and expenses" and "transfers as income and expenses" are independent switches, both off by default.
- **Budget display modes:** Expense, Limit, Available, and Expense / Limit.
- **Scheduled transactions:** a "include scheduled" projection in balances; optional manual confirmation before posting; reminders N minutes before the event.
- **Account deletion cascades** to the account's transactions and transfers.
- **Import** maps source columns to Date/Time, Currency, Amount, Amount (expense), Amount (income) and Transaction Type; every import is a batch that can be undone and deduplicated.
- **Categories** form a two-level taxonomy (root and child) with type, icon, colour and order, and can be archived.
- **Goals** target a saved amount by a date, tracked through a dedicated goal account.
- **Payees and tags** are user-managed lists; usage counts are derived, not stored.

### 2.2 Modelling decisions
- Foreign keys are enforced locally and repaired deterministically after merge (§9.5).
- Tags on a transaction are a set, not fixed columns (§3.5).
- A transfer is one atomic record, not two linked rows (§3.6).
- Each transaction freezes a base-currency snapshot, as exact integers (§3.8).
- Derived data (tag/payee counts, balances, envelope availability) is never stored or synced.
- Date-times are `(utc_ms, tz_offset_min)` plus a derived `local_date`; no string-typed dates (§3.2).

---

## 3. Cashfold domain model (normative)

### 3.1 Money representation
- `Amount` = signed 64-bit integer count of **minor units** of an ISO 4217 currency (or a Cashfold-registered asset code). **No `Decimal`, `Double` or `Float` type appears in the schema, wire format or API.**
- Currency exponents come from a bundled table: `USD 2`, `JPY 0`, `BHD 3`, `CLF 4`, `BTC 8`, and so on. Exponents 0–8 are needed to cover fiat and `BTC`. Exponents above 8 are unsupported in v1.
- Range: `|amount| ≤ 2^63−1`. At exponent 8 this is ≈ 9.2×10^10 whole units, which is sufficient.
- Representation: TypeScript `bigint` everywhere in `core` (a branded `Money` value object). **JavaScript `number` MUST NOT be used for amounts**, enforced by lint. Values are range-checked against `[-2^63, 2^63−1]` on construction and after every operation.
- Aggregation: sums are computed in SQLite (`SUM()` raises "integer overflow" rather than wrapping) or with `bigint`. The SQLite WASM adapter MUST read and bind 64-bit integers as `bigint`; reading them as JavaScript `number` silently loses precision above 2^53 and is forbidden. A test inserts and sums values above 2^53 to prove this. The ledger layer treats an overflow error as fatal for the query.
- User input is parsed from the decimal string by exact string arithmetic (split on the locale decimal separator, reject more fractional digits than the exponent, with no intermediate float).
- Rounding, when unavoidable (FX, budget velocity, splits): **round-half-to-even**, applied once at the end of the computation, on integers.

### 3.2 Identifiers and time
- Record ids are **UUIDv4** (16 random bytes). Op ids are UUIDv7.
- Time-ordering of records is never inferred from ids.
- `occurred_at`: `(utc_ms: i64, tz_offset_min: i16)` plus a derived `local_date: i32` (`yyyymmdd` in that offset). All reports and budget periods bucket by `local_date`.

### 3.3 Accounts
```
AccountKind: u8 = 1 checking | 2 savings | 3 credit_card | 4 cash | 5 goal | 6 loan   -- [DESIGN]
Account {
  id, fold_id, kind: AccountKind, name, currency: [3..8]*ALPHA,
  opening_balance_minor: i64,        -- opening balance, not the running balance
  opening_date: local_date,
  include_in_net_worth: bool,        -- false = tracking-only account
  credit_limit_minor: i64?,          -- kinds 3 and 6 only
  icon, color: u8, sort_order: i32, archived: bool,
  group_ids: set<id>?                -- membership is on the account side to avoid list-merge conflicts
}
```
Kind `credit_card` and `loan` balances are conventionally ≤ 0 (liability). The sign convention is unchanged: positive adds to the account.

### 3.4 Categories
```
Category { id, fold_id, parent_id: id?, direction: 1 expense | 2 income,
           name, icon, color, sort_order, archived }
```
- Depth ≤ 2 is enforced by the UI and **repaired by merge** if violated (§9.5).
- Spending caps are expressed as budgets (§3.7), not on the category.
- The default taxonomy is seeded with record ids UUIDv5(namespace = fold_id, name = canonical category key) so repeat imports on different devices converge to the same ids.

### 3.5 Transactions
```
Transaction {
  id, account_id, direction: 1 expense | 2 income | 0 adjustment,
  amount_minor: i64,                  -- signed effect on the account; expense < 0
  currency,                           -- MUST equal the account currency (§3.8)
  base_amount_minor: i64, base_currency, fx_rate_id: id?,    -- frozen snapshot
  occurred_at, local_date,
  category_id?, payee_id?, tag_ids: set<id> (≤ 8),
  place?: {name, lat_e7: i32, lon_e7: i32},                  -- 1e-7 degree integers, no Double
  note?, attachment_ref?,
  is_refund: bool, is_pinned: bool,
  status: 0 pending | 1 posted | 2 void,
  origin?: {schedule_id, occurrence: u32},
  import_id?
}
```
- `status=pending` replaces `confirm`. Pending rows are excluded from posted balances.
- `direction=0` is a balance adjustment. It is excluded from income/expense reports unless the "adjustments as income and expenses" display option is on.
- `tag_ids` is an **OR-Set** (§9.4).

### 3.6 Transfers (atomic)
```
Transfer {
  id, from_account_id, to_account_id,
  from_amount_minor: i64 (>0, in from-account currency),
  to_amount_minor:   i64 (>0, in to-account currency),
  occurred_at, local_date, note?, status, fx_rate_id?
}
```
- A transfer is **one record**. The two ledger entries are *materialised* locally (§4.1) and are never independently stored or synced, so partial application is impossible.
- Same-currency transfers MUST have `from_amount_minor == to_amount_minor`. Cross-currency amounts are both entered or confirmed by the user; no rate is re-derived.
- Transfers are excluded from income/expense reports unless "transfers as income and expenses" is on.
- Atomicity holds because the CRDT unit (§9.4) is the whole record: a single signed, encrypted op creates or replaces all fields.

### 3.7 Budgets (limit model and envelope extension)

**Limit budget**

```
Budget {
  id, name, icon, color, direction: 1 expense | 2 income,
  period_unit: day | week | month | year | custom,
  period_interval: u16, anchor_local_date: i32,
  limit_minor: i64, currency,
  scope: { account_ids: set | group_id?, category_ids: set, tag_ids: set, include_transfers: bool }
}
```

**Envelope extension**

```
Envelope extends Budget {
  rollover: 0 reset | 1 carry_positive | 2 carry_all,
  allocation_minor: i64,                  -- amount funded each period (default = limit_minor)
  funded_from_account_id?: id             -- optional "to be budgeted" source
}
EnvelopePeriod (derived, never stored or synced) per (envelope, period index p):
  carry_in(p)   = 0                                  if rollover = 0 or p = first
                = max(0, available(p-1))             if rollover = 1
                = available(p-1)                     if rollover = 2
  spent(p)      = Σ −amount_minor of matching posted transactions with local_date in period p, converted to envelope currency (§3.8); refunds reduce spent
  available(p)  = carry_in(p) + allocation_minor − spent(p)
```
`available` and `carry_in` are recomputed from the transaction log, so concurrent edits from several devices cannot desynchronise a stored balance.

**Velocity** (integer, half-even) for the *current* period with `d_total` days and `d_elapsed ≥ 1` days elapsed:

```
burn_per_day_minor = round_half_even(spent / d_elapsed)
projected_minor    = round_half_even(spent * d_total / d_elapsed)     -- bigint intermediate
overspend_flag     = projected_minor > carry_in + allocation_minor
```

### 3.8 Multi-currency and FX
- Each account has exactly one currency. A transaction's `currency` MUST equal its account's currency.
- A rate record: `Rate { id, base: "USD", quote, as_of_utc_s: i64, rate_e12: i64, source }`.
  - `rate_e12` = round(units of `quote` per 1 `base` × 10^12). USD is the pivot currency; no floats are involved. Example: `BTC 9.846849e-6` ⇒ `9846849`, `AED 3.67298` ⇒ `3672980000000`, and a ~16 000-per-USD currency fits in `i64` (1.6×10^16).
  - Ingest from float JSON by **parsing the decimal string**, not via `f64`.
  - **Source.** Rates are published by the user's Cashfold service as a single non-personalised table (`GET /v1/rates`, §9.6), identical for every caller, so the request discloses nothing about holdings. The app MUST NOT contact third-party rate providers. The operator configures the upstream source and MAY disable publication, in which case only user-entered (`source = custom`) rates exist.
  - The table is unauthenticated data. A dishonest server can only mislead *new* entries: stored amounts, user-confirmed transfer amounts and frozen `base_amount_minor` snapshots are never altered by a rate update. The UI shows each rate's source and `as_of`.
- Conversion of `a` minor units of currency X (exponent `eX`) to currency Y (exponent `eY`) through USD:

```
y_minor = round_half_even( a * 10^eY * R_Y  /  ( 10^eX * R_X ) )       with R_* = rate_e12, R_USD = 10^12
```
  A single division on `bigint` avoids double rounding. Intermediate magnitude bound: `|a| < 2^63`, `10^eY ≤ 10^8`, `R ≤ 2^63` ⇒ numerator < 2^63·2^27·2^63 = 2^153; native `bigint` is arbitrary precision, so the multiplication needs no special handling. Narrow after division and range-check; overflow of the narrowed result is an error. (Money arithmetic is not secret-dependent, so non-constant-time `bigint` is acceptable here.)
- `base_amount_minor` is computed once at entry/edit using the rate current at `occurred_at` (nearest prior `as_of`), and the used `fx_rate_id` is stored. Historic values are therefore never silently restated; an explicit "revalue" action re-snapshots.
- Net worth sums `base_amount` equivalents of balances converted with the latest rate.

---

## 4. Ledger rules

### 4.1 Entries and balances
Materialised, local-only view (rebuilt from records, never synced):

```
ledger_entry(account_id, tx_id | transfer_id, leg ∈ {single, out, in}, local_date, amount_minor, status)
```
- `Transaction` ⇒ one entry (`single`, `amount_minor` as stored).
- `Transfer` ⇒ two entries: `out` = `−from_amount_minor` on `from_account_id`, `in` = `+to_amount_minor` on `to_account_id`.

```
balance(acct, as_of) = opening_balance_minor
                     + Σ amount_minor over entries with account=acct, status=posted, local_date ≤ as_of
projected_balance(acct, as_of) = balance(acct, as_of) + Σ pending entries and scheduled occurrences ≤ as_of     -- "Incl. Scheduled"
```
- The balance is **always derived** (opening + sum of entries). No running-balance column is persisted. An optional per-account materialised prefix-sum cache is permitted for UI speed, but MUST be invalidated and rebuilt on any op touching that account.
- A *balance adjustment* to target `T` at date `d` inserts `Transaction{direction=0, amount_minor = T − balance(acct, d)}` with `status=posted`.

### 4.2 Invariants (checked by the local engine; violations after merge go through §9.5 repair)
1. `Transaction.currency == Account.currency`.
2. `amount_minor ≠ 0` except for `direction=0` with explicit confirmation.
3. `expense ⇒ amount_minor < 0`; `income ⇒ amount_minor > 0`.
4. Transfer: `from_account_id ≠ to_account_id`; both amounts > 0; same-currency ⇒ equal amounts.
5. Archived accounts accept no new entries.
6. A goal account (`kind=5`) accepts only transfers and adjustments.
7. `Category.parent_id` refers to a root category (depth ≤ 2), never to itself.
8. Deleting an account deletes (tombstones) its transactions and any transfer having it as an endpoint.

### 4.3 Goals
```
Goal { id, name, icon, color, target_minor: i64, currency, target_date: local_date, account_id (kind=5) }
saved(goal)     = balance(goal.account_id, today)      (converted if currencies differ)
remaining(goal) = max(0, target − saved)
status          = achieved if saved ≥ target; overdue if today > target_date and not achieved; else active
required_per_month_minor = ceil(remaining / months_left)    -- integer ceiling; months_left ≥ 1
```

### 4.4 Recurring transactions
```
Schedule {
  id, template: {direction, account_id, amount_minor, category_id?, payee_id?, tag_ids, note?, place?}
       | transfer_template: {from, to, from_amount_minor, to_amount_minor},
  begin_local_date, end_local_date?,                  -- series bounds, inclusive
  unit: day | week | month | year,   interval: u16 ≥ 1,
  requires_confirmation: bool,  reminder_min: i32? (null = none),
  completed_at?: utc_ms                                -- set when the series is finished
}
```
**Occurrence projection (anchored, so no drift):**

```
occurrence(n) for n ≥ 0:
  day:   begin + n*interval days
  week:  begin + 7*n*interval days
  month: let t = begin.month0 + n*interval;  y = begin.year + floor(t/12);  m = t mod 12;
         d = min(begin.day, days_in_month(y, m))
  year:  y = begin.year + n*interval;  d = min(begin.day, days_in_month(y, begin.month))   -- Feb 29 clamps to Feb 28 in non-leap years
```
- Anchoring each occurrence to `begin` rather than to the previous occurrence makes 31 Jan → 28 Feb → 31 Mar (not 28 Mar).
- Generation window: all `occurrence(n)` with `local_date ≤ today + horizon` (default 90 days) and ≤ `end_local_date`, and `completed_at = null`.
- **Idempotent, convergent materialisation.** The generated transaction id is `UUIDv5(namespace = schedule_id, name = n as u32 big-endian)` and `origin = {schedule_id, n}`. Two devices that both materialise occurrence *n* produce the *same* record id, so the CRDT merges them into one record instead of duplicating it.
- `requires_confirmation ⇒ status=pending` until the user confirms. Otherwise `status=posted` once `local_date ≤ today`.
- Future occurrences used for projections are virtual (not stored) and are computed on demand.
- Editing a schedule affects only unmaterialised occurrences. Materialised ones are independent records.

---

## 5. Cryptographic architecture

### 5.1 Primitive selection

| Purpose | Cashfold primitive | Source |
|---|---|---|
| CSPRNG | `crypto.getRandomValues` (web, Workers, Node); shells use the same API in their webview | The only randomness source permitted |
| Symmetric AEAD | **AES-256-GCM** via WebCrypto, 96-bit random nonce, 128-bit tag | |
| KDF (key extraction/expansion) | **HKDF-SHA256** (RFC 5869) via WebCrypto | |
| Password hash (primary) | **Argon2id** (RFC 9106), output 32 B, vetted WASM build run in the Core Worker | Memory-hard. |
| Password hash (fallback) | **PBKDF2-HMAC-SHA256, 650,000 iterations** via WebCrypto | Used only if WASM is unavailable |
| PAKE | **SRP-6a**, RFC 5054 conventions, SHA-256, 4096-bit group | 4096-bit group from RFC 3526. Secret-exponent modular exponentiation MUST be constant-time (§6.9); native `BigInt` is forbidden for it. |
| Key agreement / sealing | **X25519** inside **HPKE** (RFC 9180): DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. `@noble/curves` (and `@noble/hashes`); WebCrypto X25519 where available | |
| Signatures | **Ed25519** (RFC 8032): WebCrypto where supported (allows non-extractable device keys), otherwise `@noble/curves`. Strict verification. | |
| Local DB | SQLite WASM on OPFS with whole-file encryption (§8.1) | |
| Hardware-backed key | Not available on the web. WebAuthn PRF MAY unlock a wrapping key from a platform authenticator (§5.2). Native shells MAY add OS keychain / Secure Enclave later behind `KeyStorePort` (the Electron shell does not, ADR-0009). | |
| Serialization | Deterministic CBOR (RFC 8949 §4.2.1), TypeScript encoder with frozen byte vectors | |

Rationale: Argon2id is memory-hard, which raises GPU/ASIC cost far above PBKDF2 at equal latency. X25519/Ed25519 give 128-bit security with 32-byte keys, constant-time implementations are ubiquitous. SRP's 4096-bit group exceeds the commonly required ≥2048-bit minimum at a cost of one extra modular exponentiation per login.

### 5.2 Secret Key (128-bit, client-generated)
Format `C1-AAAAAA-SSSSSSSSSSS-SSSSS-SSSSS-SSSSS`, where:
- `C1` is the non-secret format/version tag.
- `AAAAAA` is a 6-character non-secret account id, random.
- The remaining 26 characters are secret. They are drawn from the 32-symbol alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excludes `I O 0 1`). Each character encodes exactly 5 random bits, so there is no modulo bias.
- Entropy is 26 × 5 = **130 bits** (≥128).
- Hyphens are display-only and are stripped before use.

**Generation:** 26 × 5 = 130 bits are read from the CSPRNG (17 bytes, 4 bits discarded). The account id is read the same way (30 bits from 4 bytes, 2 bits discarded).

**Storage on a device (web):** the browser has no hardware-backed key store for arbitrary secrets, so the design keeps the at-rest secret protected by something the user knows, with an optional device-bound convenience layer.
1. A random 16-byte `device_salt` is generated per device and stored in the clear.
2. `LVK = Argon2id(NFKD(trim(password)), device_salt, params)` (32 bytes) is the *Local Vault Key*. It is derived at unlock and never stored.
3. The Secret Key and cached `SRP-x` are stored as `AES-256-GCM(LVK, nonce, aad = "cashfold.dukblob.v1", …)` in IndexedDB.
4. **Quick unlock (optional):** where the browser supports WebAuthn with the PRF extension, the app registers a platform credential (biometric or device PIN). The PRF output wraps a random `DUK`; `LVK` is stored encrypted under `DUK`. Without PRF support, the user types the password at every unlock. After a browser restart, a password is always required.
5. The device signing key (§7.1) is generated as a non-extractable WebCrypto key where Ed25519 is supported. Otherwise it is stored encrypted under `LVK`.
6. The database key `DBK` (§8.1) is derived from `LVK` (or `DUK`) and held in the Core Worker only while unlocked.

Consequence: on a stolen browser profile an attacker needs the password to reach the Secret Key, so a weak password weakens the two-secret protection *on that device only*. The UI MUST say so and MUST show a password-strength meter at sign-up. Tauri shells later bind `DUK` to the OS keychain or Secure Enclave, restoring hardware-backed protection.

**Emergency Kit** (PDF/QR) contains: account id, email, server URL, and the Secret Key. It deliberately has a blank field for the password and warns not to store both together. The QR encodes an add-device URL (§6.6).

### 5.3 Two-Secret Key Derivation (2SKD)
Inputs: `password` (UTF-8 string), `email`, `secret_key` (`C1-…`), `salt16` (random, per purpose), `kdf_params`.

```
P      = UTF8( NFKD( trim_ws(password) ) )              -- strip leading/trailing whitespace, then Unicode NFKD
S_eff  = HKDF-SHA256( salt = UTF8(lower(email)), IKM = salt16,
                      info = "cashfold.2skd.v1|salt|" || purpose, L = 32 )
K_pw   = KDF( P, S_eff, kdf_params )                                              -- 32 bytes
K_sk   = HKDF-SHA256( salt = ASCII(account_id), IKM = ASCII(secret_26_chars),
                      info = "cashfold.2skd.v1|sk|" || purpose || "|C1", L = 32 )
K_p    = K_pw XOR K_sk                                                            -- 32 bytes
```
`purpose` ∈ {`"auk"`, `"srp"`}. **Both derivations use different `salt16`** (`enc_salt`, `auth_salt`), so `AUK` and `SRP-x` are independent.

- `AUK = K_p("auk")`: the **Account Unlock Key**. Never leaves the device.
- `SRP-x = int_be( K_p("srp") )` (32 bytes → big-endian integer). Used only for the SRP verifier and login proofs.

**KDF parameters** (stored in clear beside the salts, so a new client can reproduce them):

| `kdf` | Parameters | Floor enforced on load |
|---|---|---|
| `argon2id` (default) | `m = 65536 KiB`, `t = 3`, `p = 1`, version 0x13, tag length 32 | `m ≥ 32768`, `t ≥ 2`, `p ≥ 1` |
| `pbkdf2-hmac-sha256` (web fallback) | `iter = 650000` | `iter ≥ 600000` |

- The client MUST refuse server-supplied parameters below the floor (prevents a malicious server downgrading the KDF).
- Per, the defender pays for two derivations only at sign-up/enrol. Normal unlock derives `AUK` only and decrypts the cached `SRP-x`.
- Raising parameters: changing the password or Secret Key re-derives with current defaults.

### 5.4 Key hierarchy

```
password ──┐
           ├─ 2SKD ── AUK ──AES-256-GCM──► personal key set: { X25519 sk, Ed25519 sk }   (the "private key")
Secret Key ┘                          │
                                      └── HPKE-opens ──► Fold Key  FK[fold_id, epoch]  (32 B, one per Fold per epoch)
                                                          └─ HKDF ──► record key RK = f(FK, record_id)
                                                          └─ HKDF ──► database key DBK (per device; derived from LVK/DUK, not FK)
SRP-x ──► verifier v  (server)
```

**Personal key set** (CBOR; JWK-like, mirroring):

```
KeySet {
  v: 1, uuid: bytes16,                       -- key-set id
  enc: { alg: "HPKE-X25519-HKDF-SHA256-AES256GCM", pk: bytes32, sk_ct: Ciphertext },
  sig: { alg: "Ed25519", pk: bytes32, sk_ct: Ciphertext },
  sk_ct = AES-256-GCM(key = AUK, nonce = random12, aad = CBOR["cashfold.keyset.v1", uuid, "enc"|"sig"], pt = sk_bytes),
  kdf: { kdf, params, enc_salt: bytes16 }, encrypted_by: "mp"            -- "mp" = account password key, as in
}
```
The server stores the KeySet and `kdf`/salts. It never sees the AUK or the private keys.

### 5.5 Fold = Vault
- A **Fold** is the isolation unit for a budget context (*Personal*, *Family*, *Business*). Each Fold has its own random **Fold Key** `FK` = 32 bytes from the CSPRNG and a monotone `epoch: u32` starting at 1.
- `FK` is stored **only** as per-member HPKE grants (§7.2). A Fold's owner has a grant for their own `enc.pk`.
- Folds share no key material. Compromise or revocation of one Fold does not affect the others.
- Records of different Folds MUST NOT be co-mingled in one DB table without `fold_id` in every primary key (§8).

### 5.6 Record-level encryption
For record `R` with id `rid` (16 B), table code `t`, `fold_id` (16 B), `epoch`:

```
RK    = HKDF-SHA256( salt = rid, IKM = FK[epoch], info = "cashfold.rec.v1", L = 32 )
nonce = CSPRNG(12)                              -- fresh per encryption, including every re-encryption on edit
AAD   = CBOR [ "cashfold.rec.v1", fold_id, rid, t, epoch, schema_ver ]
CT    = AES-256-GCM-Encrypt( RK, nonce, AAD, CBOR(payload) )           -- output: ciphertext || tag(16)
blob  = nonce(12) || CT || tag(16)
```
- The per-record key limits any single AES key to the few encryptions of one record, so the 96-bit random-nonce birthday bound (2^-32 at 2^32 messages per key) is irrelevant in practice.
- AAD binds each ciphertext to *its* fold, record, table, epoch and schema. A malicious server cannot swap blobs between records or folds without a tag failure.
- Decryption failure is a hard per-record error. It MUST NOT crash the sync loop, and the record is quarantined in `sync_quarantine` (§8).

**Plaintext vs ciphertext split**

| Field | Plaintext (server-visible, used for routing/CRDT) | Encrypted (in `payload`) |
|---|---|---|
| `fold_id`, `rec_id`, `dev_id`, `seq`, `op_id` | ✅ | |
| `hlc` (version stamp) | ✅ | |
| `epoch`, `schema_ver` | ✅ | |
| `table code` | ❌. Inside payload, to hide the entity mix. | ✅ |
| Amounts, currencies, base amounts, FX | | ✅ |
| Account / category / tag / payee names, icons, colours | | ✅ |
| Notes, places, attachments refs | | ✅ |
| Dates (`occurred_at`, `local_date`) | | ✅ |
| Foreign keys (`account_id`, `category_id`, …) | | ✅ |
| Deleted flag | | ✅ (as a tombstone field) |
| Blob size | visible (padded, §9.8) | |

Payload encoding: deterministic CBOR map `{ t: u8, f: { <field_id u16>: [value, hlc] … } }`. This is the "encrypted binary JSON blob" of the brief, with CBOR chosen because it has native `bytes`, exact `i64`/`u64` integers and a deterministic profile. `field_id` registries are versioned with `schema_ver`.

### 5.7 Attachments
Each attachment is encrypted separately: `AK = HKDF(FK, salt = attachment_id, info = "cashfold.att.v1")`, chunked in 64 KiB frames, each `AES-256-GCM(nonce = 4-byte random prefix ‖ 8-byte big-endian counter, AAD = attachment_id ‖ chunk_index ‖ is_last)`. The last frame carries `is_last = 1` to prevent truncation.

### 5.8 Export / backup
Encrypted export: `AES-256-GCM` under `HKDF(FK, "cashfold.export.v1" ‖ nonce)`; additionally offered with a user passphrase using Argon2id (same floors). Unencrypted CSV export requires an explicit confirmation and a fresh biometric/password check.

### 5.9 Agility
Every serialized crypto object carries `alg` strings and a `v`. Clients MUST reject unknown `v` and MUST NOT silently fall back to weaker algorithms. Algorithm migration works as in: ship a client that creates new keys under the new algorithm, keep reading the old ones, and mark old-algorithm items untrusted for automatic use after a deprecation date.

---

## 6. Zero-knowledge authentication (SRP-6a, 4096-bit)

### 6.1 Parameters
- Group: **RFC 3526 §5 "4096-bit MODP Group"**: safe prime `N = 2^4096 − 2^4032 − 1 + 2^64 · ( ⌊2^3966 · π⌋ + 240904 )`, generator `g = 2`.
  - Implementations MUST vendor the 4096-bit constant from RFC 3526 and check it against the formula in a unit test.
  - They MUST verify `N` is a safe prime in a build-time test.
- Hash `H` = SHA-256. `PAD(x)` = big-endian `x` left-padded with zeros to 512 bytes (|N|).
- `k = H( PAD(N) ‖ PAD(g) )` (SRP-6a).
- `x = SRP-x` from §5.3, **not** the RFC 5054 `H(s ‖ H(I ‖ ":" ‖ P))`. RFC 5054 permits a different derivation of x.

### 6.2 Registration (client → server, once)
```
auth_salt16 = CSPRNG(16)
SRP-x       = 2SKD(purpose="srp", salt16 = auth_salt16)
v           = g^SRP-x mod N                         -- 512 bytes
send { account_id, email_hash?, auth_salt16, kdf (params), v, KeySet, device_info }
```
The server stores `(account_id, auth_salt16, kdf_params, v)`. `v` is the only password-derived value the server holds, and it is uncrackable without the Secret Key (4096 bits of group + 2SKD). If an attacker obtains the Secret Key from the user's device, the Argon2id cost still applies per guess.

### 6.3 Login message flow

```
Client                                              Server
 1  → HELLO{email, device_id}
                                                     2  look up account; if absent, return a *deterministic fake*
                                                        salt+kdf derived as HMAC(server_secret, email) (no enumeration)
 3  ← {account_id, auth_salt16, kdf_params, session_id}
 4  SRP-x = 2SKD(pw, SK, auth_salt16)   [or decrypt cached SRP-x]
    a ← CSPRNG(32 bytes) ; A = g^a mod N
 5  → A
                                                     6  abort if A mod N = 0
                                                        b ← CSPRNG(32) ; B = (k·v + g^b) mod N
 7  ← B
 8  abort if B mod N = 0
    u = H(PAD(A) ‖ PAD(B)) ; abort if u = 0
    S = (B − k·g^x)^(a + u·x) mod N
    K = H(PAD(S))
    M1 = H( H(PAD(N)) XOR H(PAD(g)) ‖ H(account_id) ‖ auth_salt16 ‖ PAD(A) ‖ PAD(B) ‖ K )
 9  → M1
                                                     10 u = H(PAD(A) ‖ PAD(B)) ; S = (A · v^u)^b mod N ; K = H(PAD(S))
                                                        check M1 (constant time). On failure → count++, delay, abort.
                                                        M2 = H( PAD(A) ‖ M1 ‖ K )
11 ← M2  (+ first encrypted frame, §6.5)
12  check M2 (constant time). On failure abort and do not use K.
```

### 6.4 State machine

| Role | State | Input → Output | Next |
|---|---|---|---|
| Server | `IDLE` | HELLO → `{salt, kdf}` | `SALT_SENT` |
| Server | `SALT_SENT` | A (valid) → B | `B_SENT` |
| Server | `SALT_SENT` | A invalid / timeout (60 s) | `FAILED` |
| Server | `B_SENT` | M1 valid → M2 | `AUTHED` |
| Server | `B_SENT` | M1 invalid / timeout | `FAILED` (increment failure counter) |
| Client | `START` | send HELLO | `WAIT_SALT` |
| Client | `WAIT_SALT` | salt received (params ≥ floor) → send A | `WAIT_B` |
| Client | `WAIT_B` | B valid → send M1 | `WAIT_M2` |
| Client | `WAIT_M2` | M2 valid | `AUTHED` |
| Client | any | invalid message / out-of-order | `FAILED` |

- Session state `(a|b, A, B, K, deadline)` is **single-use**: `a`, `b`, `K` are discarded on `FAILED`, on timeout, and after `AUTHED` when the transport keys are derived.
- `AUTHED` is the only state that permits fetching key sets or ops. Any failure leaves the server with no information about the password beyond one failed guess against a value the attacker cannot cheaply test without the Secret Key.
- **Rate limiting:** per-account and per-IP, exponential back-off, plus an account lockout notification. Counters are server-side because an attacker without `x` cannot verify guesses offline.

### 6.5 Post-auth transport (the "SRP+GCM" layer, with replay protection)
A per-message AEAD layer alone would accept replayed frames, so Cashfold binds a strictly increasing counter into each frame:

```
K_c2s = HKDF-SHA256( salt = H(PAD(A)‖PAD(B)), IKM = K, info = "cashfold.transport.v1|c2s", L = 32 )
K_s2c = HKDF-SHA256( …, info = "cashfold.transport.v1|s2c", L = 32 )
frame nonce = 4 zero bytes ‖ u64_be(counter)          -- counter starts at 0 per direction, strictly increasing
frame = AES-256-GCM( K_dir, nonce, aad = CBOR["cashfold.frame.v1", session_id, direction, counter, len], body )
```
- A receiver MUST reject any frame whose counter is ≤ the last accepted one, and MUST close the session on tag failure.
- TLS 1.3 (HSTS, restricted suites) is the outer layer; the SRP-derived layer adds client authentication and replay protection.
- Sessions expire (default 30 min idle, 24 h absolute). Re-auth reuses the cached `SRP-x`, so it needs only a local unlock and no password re-entry.

### 6.6 Enrolling a new device
1. The user scans/pastes the add-device URL from an existing device or the Emergency Kit: `https://<app-host>/add#email=…&server=…&key=C1-…`. The data is in the URL **fragment**, which browsers never send to any server, and the page removes it from the address bar and history immediately after reading it. The Secret Key travels only through a user-controlled channel: QR, paste, paper.
2. The new device asks for the password, fetches `{auth_salt16, enc_salt16, kdf_params}`, and derives `SRP-x` and `AUK`.
3. SRP login (§6.3). The client fetches the KeySet and decrypts the private keys with `AUK`.
4. The client generates a device Ed25519 key, registers it, and the owner (or the user's other device) signs the registration in the membership log (§7.3).
5. Fold grants are fetched and opened (§7.2). The device then begins sync.

### 6.7 Password / Secret Key change
Both change `AUK` (and `SRP-x`). The client re-wraps the KeySet's private keys under the new AUK, re-computes `v`, and uploads atomically `{v, auth_salt16', KeySet', kdf'}` in a single authenticated request. Fold grants are unaffected because they are HPKE-wrapped to the unchanged X25519 public key.

### 6.8 Account recovery
There is **no server-side recovery**. Offered mechanisms:
- **Emergency Kit** (Secret Key; the password is the user's responsibility).
- **Recovery Key** (optional): 32 random bytes `RKm`; `RK_auth = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_AUTH_v1")`, `RK_enc = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_ENC_v1")`, `RK_uuid = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_UUID")[0:16]`. `RK_enc` AES-256-GCM-wraps the KeySet private keys; `RK_auth` is used as a second SRP-x for the recovery credential. The server stores only the second verifier and the wrapped KeySet.
- **Family recovery** via a Fold co-member re-sealing the FK to a new public key (§7).

### 6.9 SRP implementation notes (constant-time requirement)
SRP uses secret exponents (`a` on the client, `b` on the server) and the long-term secret `x`. Variable-time big-integer exponentiation can leak these through timing. Therefore:
- **Server (NestJS):** exponentiation with the secret `b` MUST use OpenSSL's constant-time Montgomery routines through Node's `crypto.createDiffieHellman(N, g)` API: `g^b` via key generation with `setPrivateKey(b)`, and `S = (A·v^u)^b` via `computeSecret()`. Results are left-padded to 512 bytes because DH output strips leading zeros. Operations on public values only (`k·v`, hashing, padding) may use `bigint`. **VERIFY** that the Node/OpenSSL versions in use take the constant-time path and accept a 4096-bit custom prime with the safe-prime check enabled.
- **Client (Core Worker):** `A = g^a`, `g^x` and `(B − k·g^x)^(a + u·x)` MUST run in a vetted WASM big-integer module with constant-time modular exponentiation, exposed only through `Pake` in `packages/crypto`. Native `bigint` is forbidden for these operations. **VERIFY** the chosen WASM module (for example a build of a constant-time Rust big-integer crate) with differential tests against the OpenSSL path.
- Both sides reject degenerate values (`A mod N = 0`, `B mod N = 0`, `u = 0`).
- Known-answer and 100-exchange differential tests (client WASM ↔ server OpenSSL ↔ reference) are required (§11).

---

## 7. Sharing and access control

### 7.1 Principals and keys
Each user has the KeySet from §5.4: an X25519 key (`enc`) and an Ed25519 key (`sig`). Each device additionally has its own Ed25519 *device signing key* (non-extractable where the platform allows, otherwise encrypted at rest per §5.2; never exported). Device keys are certified by the user's `sig` key in the membership log.

### 7.2 Fold Key grant (HPKE, RFC 9180 base mode)
To grant member `m` access to Fold `F` at epoch `e`:

```
(enc, ct) = HPKE.Seal( pkR = m.enc.pk,
                       info = CBOR["cashfold.foldkey.v1", fold_id, e, m.account_id],
                       aad  = CBOR["cashfold.foldkey.v1", fold_id, e, role],
                       pt   = FK[e] (32 B) )
grant     = { fold_id, epoch: e, member: m.account_id, role, enc: bytes32, ct: bytes48, granted_by, sig: Ed25519(granter.sig, canonical(grant_without_sig)) }
```
Only the member's X25519 secret key opens the grant. The server stores grants opaquely. Grants are individually signed, so a server cannot swap one in or out unnoticed.

### 7.3 Membership log
Each Fold has an append-only, hash-chained, signed **membership log**. Entry types:

```
Entry { idx: u64, prev_hash: bytes32, type: add_member | remove_member | leave | change_role | add_device | revoke_device | rotate_epoch,
        subject: account_id|device_id, role?, pubkeys?, epoch?, signer: account_id, sig: Ed25519 over canonical(entry), ts: utc_ms }
hash = SHA-256(canonical(entry))
```
- Roles: `owner` (all, including add/remove members and rotate), `editor` (write records), `viewer` (read only).
- An op signed by a device not currently authorised for `editor` or higher at the op's causal position MUST be rejected by every client. The server also enforces this, but clients never rely on the server.
- Clients verify the full chain from the genesis entry (signed by the Fold creator, whose public key was pinned when the Fold was created locally or when first invited).

### 7.4 Inviting a user
1. Inviter obtains the invitee's *public key bundle* `{account_id, enc.pk, sig.pk, self_signature}` in one of two ways:
   - **Email lookup** (`POST /v1/accounts/lookup`, FR-106): available only to signed-in, email-verified callers, rate-limited per account (default 20 lookups per day, configurable). It returns a bundle only for a verified, *discoverable* account. Unknown and non-discoverable addresses return the same `404`, so a lookup reveals only accounts that opted in. Accounts are discoverable by default, shown at sign-up, and changeable at any time (`PUT /v1/accounts/me/discoverable`).
   - **Invitation code.** The invitee exports a code (or link/QR) that contains their public key bundle and gives it to the inviter out-of-band. This needs no lookup and works for non-discoverable accounts and for services with verification disabled.
2. **Fingerprint check (mandatory for every shared Fold).** Both sides compute `fp = SHA-256("cashfold.fp.v1" ‖ enc.pk ‖ sig.pk)` truncated to 20 bytes, shown as 8 groups of 5 digits, compared out-of-band or by QR. Without it the server could substitute its own key (adversary A4).
3. The inviter chooses a **history scope** (`full` or `from_join`) and the invitee is shown it before accepting (FR-102).
4. The inviter signs an `add_member` entry carrying `scope` and `from_epoch`, and uploads the grant(s) (§7.2); see §7.6 for which epochs are sealed.
5. The inviter's client posts the invitation (`POST /v1/folds/{fold}/invitations`, FR-107). The service sends the invitee an email that names the sender only: no Fold name, member list or financial content.
6. The invitee verifies the log chain and grant signatures, opens the grant(s), and starts syncing.

### 7.5 Revocation and key rotation
Cryptographic revocation requires a new key:
1. An owner appends `remove_member` and `rotate_epoch(e+1)`.
2. Generate `FK[e+1]` (CSPRNG) and seal it to every remaining member (new grants at epoch e+1).
3. All *new* ops are encrypted under epoch `e+1`. Old records remain readable via `FK[e]`, which remaining members retain.
4. Optional background re-encryption of old records to `e+1` (a pure re-key op carrying the same field timestamps), after which `FK[e]` can be discarded.

The removed member may already have copied data from epoch ≤ e. This cannot be undone; the UI MUST say so.

### 7.6 History scope for new members (FR-102)

| Scope | Epochs sealed to the new member | Effect |
|---|---|---|
| `full` | Grants for **every** epoch `1..e` (the inviter holds them all) | Member can decrypt all existing records |
| `from_join` | Owner first appends `rotate_epoch(e+1)`; only `FK[e+1]` is sealed to the new member (`from_epoch = e+1`) | Member can never decrypt records written under epochs ≤ e |

`from_join` mechanics:
1. **Rotation on invite.** All existing members receive `FK[e+1]` as in §7.5. New ops use epoch `e+1`.
2. **Baseline republish.** Because the new member cannot read earlier records, the owner's client republishes under `e+1` the *structural* current state needed to make sense of new data: accounts (without history), categories, payees, tags, budgets, goals, schedules. Those ops carry the **original field clocks**, so they merge as no-ops for existing members.
3. **Checkpoints.** For each account and each rollover envelope the client also writes a `checkpoint` record (table code 14) `{kind: account_balance | envelope_carry, subject, as_of_local_date, value_minor}` capturing the value on the join date. For a `from_join` member, `balance(acct) = checkpoint + Σ entries after as_of` and the first visible budget period starts at the checkpoint's carry-in. Members with full history ignore checkpoints.
4. **Hidden history.** Records whose creating op is in an epoch the member lacks are not displayed. A later-epoch patch that targets such a record is stored but invisible (no base record).
5. **Server delivery.** The server MAY withhold ops with `epoch < from_epoch` from that member to save bandwidth. This is an optimisation, not a security boundary; confidentiality comes from the missing key.
6. The scope cannot be widened later. Widening requires a new invitation, because granting older epochs is a new disclosure the owner must approve.

### 7.7 Local copy on removal or departure (FR-104)
1. On every sync the client replays the membership log. If the log shows that this account is `removed` or has `left`, the client deletes the Fold's rows, `fold_key`, `op_log` and attachments, and zeroizes cached keys.
2. A voluntary leaver is offered an export before the leave entry is appended.
3. If the account itself is deleted (§9.9), the server answers every request with `410 Gone` and the client wipes all local data for that account.
4. Deletion on the device cannot recall data already seen, exported or copied; the UI says so.

---

## 8. Local storage — SQLite WASM on OPFS

### 8.1 Encryption at rest
- Engine: official SQLite WASM build running in the Core Worker, using an OPFS VFS (the SyncAccessHandle pool VFS, which needs no cross-origin isolation headers).
- **Requirement:** the main database file, journal/WAL and any temp files MUST be encrypted; no plaintext page may reach OPFS. Two acceptable implementations, in order of preference (**VERIFY** and decide in ADR-0002):
  1. A SQLite build with a built-in cipher (for example SQLite3 Multiple Ciphers compiled to WASM) configured for AES-256 or ChaCha20-Poly1305 with per-page authentication, using a raw 256-bit key.
  2. A custom VFS wrapper that encrypts each page with AES-256-GCM using a key derived per page: `HKDF(DBK, salt = page_no ‖ file_id, info = "cashfold.page.v1")`, a random 96-bit nonce stored with the page, and `AAD = file_id ‖ page_no ‖ write_counter`. Page swapping and rollback of individual pages are detected by the AAD and a per-file Merkle/epoch counter kept in the encrypted header.
- `DBK = HKDF-SHA256( IKM = LVK or DUK, salt = device_id, info = "cashfold.db.v1", L = 32 )`.
- Pragmas: `foreign_keys = ON`, `secure_delete = ON`, `temp_store = MEMORY`, `journal_mode` as supported by the chosen VFS (`DELETE` or `WAL`).
- The database holds **decrypted, queryable data** (the local trust boundary is the unlocked device) plus the encrypted op log used to talk to the server.
- Locking the app closes the database, zeroizes `DBK` in the Core Worker and terminates the worker, which discards its heap.

### 8.1a Durability and multi-tab (web specifics)
- **Eviction risk.** Browsers may evict site storage under pressure. The app MUST call `navigator.storage.persist()` at first run, show a warning when persistence is denied, and nag for an encrypted backup (§5.8). Because every change is also uploaded as an op, a signed-in user can always rebuild from the server; a never-synced user cannot, so the backup nag is stronger for them.
- **Single writer.** Exactly one Core Worker may open the database at a time, arbitrated with the Web Locks API; other tabs use RPC to the leader and receive change notifications over a `BroadcastChannel`.
- **Crash safety.** Every command is one SQLite transaction (op log + projections). On start-up the worker verifies the encrypted header and replays any unapplied ops.
- **Capacity and speed.** The 50,000-transaction target (SC-008) is validated by a benchmark in CI using a headless browser; query plans for the indexes in §8.2 are asserted.

### 8.2 Schema (DDL)

All amounts are `INTEGER` minor units. All ids are `BLOB(16)`. Timestamps are integer UTC milliseconds.

```sql
-- ===== Sync plumbing (mirrors what the server sees) =====
CREATE TABLE fold (
  fold_id        BLOB PRIMARY KEY CHECK (length(fold_id)=16),
  name           TEXT NOT NULL,
  epoch          INTEGER NOT NULL CHECK (epoch >= 1),
  role           INTEGER NOT NULL CHECK (role IN (1,2,3)),         -- 1 owner, 2 editor, 3 viewer
  base_currency  TEXT NOT NULL,
  pull_cursor    INTEGER NOT NULL DEFAULT 0,                       -- last server_seq applied
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE fold_key (                                            -- opened FKs, wrapped by the app key
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  epoch   INTEGER NOT NULL,
  fk_wrapped BLOB NOT NULL,                                        -- AES-256-GCM(DBK-derived, FK) so FK never sits plain in pages at rest
  PRIMARY KEY (fold_id, epoch)
) STRICT;

CREATE TABLE op_log (                                              -- every op ever seen, local or remote
  fold_id   BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  op_id     BLOB NOT NULL,
  rec_id    BLOB NOT NULL,
  dev_id    BLOB NOT NULL,
  dev_seq   INTEGER NOT NULL,
  hlc_wall  INTEGER NOT NULL, hlc_ctr INTEGER NOT NULL,
  epoch     INTEGER NOT NULL,
  schema_ver INTEGER NOT NULL,
  blob      BLOB NOT NULL,                                         -- nonce||ct||tag, exactly what the server stores
  sig       BLOB NOT NULL CHECK (length(sig)=64),
  server_seq INTEGER,                                              -- NULL until acknowledged by server
  state     INTEGER NOT NULL DEFAULT 0,                            -- 0 pending-push, 1 acked, 2 applied-remote
  PRIMARY KEY (fold_id, op_id)
) STRICT;
CREATE INDEX op_log_push ON op_log(fold_id, state) WHERE state = 0;
CREATE UNIQUE INDEX op_log_dev ON op_log(fold_id, dev_id, dev_seq);

CREATE TABLE sync_quarantine (fold_id BLOB, op_id BLOB, reason TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY(fold_id, op_id)) STRICT;

-- Per-field LWW register cache: authoritative merge state for every field
CREATE TABLE field_clock (
  fold_id BLOB NOT NULL, rec_id BLOB NOT NULL, field_id INTEGER NOT NULL,
  hlc_wall INTEGER NOT NULL, hlc_ctr INTEGER NOT NULL, dev_id BLOB NOT NULL,
  PRIMARY KEY (fold_id, rec_id, field_id)
) STRICT, WITHOUT ROWID;

-- ===== Domain tables (plaintext inside the encrypted database) =====
CREATE TABLE account (
  fold_id BLOB NOT NULL, id BLOB NOT NULL,
  kind INTEGER NOT NULL CHECK (kind BETWEEN 1 AND 6),
  name TEXT NOT NULL, currency TEXT NOT NULL, exponent INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 8),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0, opening_date INTEGER NOT NULL,
  include_in_net_worth INTEGER NOT NULL DEFAULT 1, credit_limit_minor INTEGER,
  icon TEXT, color INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE INDEX account_order ON account(fold_id, sort_order, name) WHERE deleted = 0;

CREATE TABLE account_group (fold_id BLOB NOT NULL, id BLOB NOT NULL, name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;
CREATE TABLE account_group_member (fold_id BLOB NOT NULL, group_id BLOB NOT NULL, account_id BLOB NOT NULL, PRIMARY KEY(fold_id, group_id, account_id)) STRICT;

CREATE TABLE category (
  fold_id BLOB NOT NULL, id BLOB NOT NULL, parent_id BLOB, direction INTEGER NOT NULL CHECK (direction IN (1,2)),
  name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE INDEX category_tree ON category(fold_id, direction, sort_order, name) WHERE deleted = 0;

CREATE TABLE payee (fold_id BLOB NOT NULL, id BLOB NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;
CREATE TABLE tag   (fold_id BLOB NOT NULL, id BLOB NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;

CREATE TABLE txn (
  fold_id BLOB NOT NULL, id BLOB NOT NULL, account_id BLOB NOT NULL,
  direction INTEGER NOT NULL CHECK (direction IN (0,1,2)),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL, base_currency TEXT NOT NULL, fx_rate_id BLOB,
  occurred_utc_ms INTEGER NOT NULL, tz_offset_min INTEGER NOT NULL, local_date INTEGER NOT NULL,   -- yyyymmdd
  category_id BLOB, payee_id BLOB, note TEXT,
  place_name TEXT, lat_e7 INTEGER, lon_e7 INTEGER, attachment_ref BLOB,
  is_refund INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0,1,2)),
  origin_schedule BLOB, origin_n INTEGER, import_id BLOB,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id),
  CHECK ((direction = 1 AND amount_minor < 0) OR (direction = 2 AND amount_minor > 0) OR direction = 0)
) STRICT;
CREATE INDEX txn_acct_date ON txn(fold_id, account_id, local_date, id) WHERE deleted = 0;
CREATE INDEX txn_cat_date  ON txn(fold_id, category_id, local_date) WHERE deleted = 0 AND category_id IS NOT NULL;

CREATE TABLE txn_tag (fold_id BLOB NOT NULL, txn_id BLOB NOT NULL, tag_id BLOB NOT NULL, PRIMARY KEY(fold_id, txn_id, tag_id)) STRICT, WITHOUT ROWID;

CREATE TABLE transfer (
  fold_id BLOB NOT NULL, id BLOB NOT NULL,
  from_account_id BLOB NOT NULL, to_account_id BLOB NOT NULL,
  from_amount_minor INTEGER NOT NULL CHECK (from_amount_minor > 0),
  to_amount_minor   INTEGER NOT NULL CHECK (to_amount_minor   > 0),
  occurred_utc_ms INTEGER NOT NULL, tz_offset_min INTEGER NOT NULL, local_date INTEGER NOT NULL,
  note TEXT, status INTEGER NOT NULL DEFAULT 1, fx_rate_id BLOB, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id),
  CHECK (from_account_id <> to_account_id)
) STRICT;

-- Derived view, never synced: the two-legged ledger
CREATE VIEW ledger_entry AS
  SELECT fold_id, account_id, id AS ref_id, 0 AS leg, local_date, amount_minor, status
    FROM txn WHERE deleted = 0
  UNION ALL
  SELECT fold_id, from_account_id, id, 1, local_date, -from_amount_minor, status FROM transfer WHERE deleted = 0
  UNION ALL
  SELECT fold_id, to_account_id,   id, 2, local_date,  to_amount_minor,   status FROM transfer WHERE deleted = 0;

CREATE VIEW account_balance AS
  SELECT a.fold_id, a.id AS account_id,
         a.opening_balance_minor + COALESCE((SELECT SUM(e.amount_minor) FROM ledger_entry e
            WHERE e.fold_id=a.fold_id AND e.account_id=a.id AND e.status=1), 0) AS balance_minor
    FROM account a WHERE a.deleted = 0;
-- SQLite SUM() raises "integer overflow" instead of wrapping; callers must propagate it.

CREATE TABLE budget (
  fold_id BLOB NOT NULL, id BLOB NOT NULL, name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0,
  direction INTEGER NOT NULL CHECK (direction IN (1,2)),
  period_unit INTEGER NOT NULL CHECK (period_unit IN (1,2,3,4,5)),   -- 1 day 2 week 3 month 4 year 5 custom
  period_interval INTEGER NOT NULL DEFAULT 1 CHECK (period_interval >= 1),
  anchor_local_date INTEGER NOT NULL, custom_end_local_date INTEGER,
  limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0), currency TEXT NOT NULL,
  scope_group_id BLOB, include_transfers INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 0 CHECK (rollover IN (0,1,2)),
  allocation_minor INTEGER NOT NULL CHECK (allocation_minor >= 0),
  funded_from_account_id BLOB, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE TABLE budget_scope_account  (fold_id BLOB, budget_id BLOB, account_id  BLOB, PRIMARY KEY(fold_id,budget_id,account_id))  STRICT, WITHOUT ROWID;
CREATE TABLE budget_scope_category (fold_id BLOB, budget_id BLOB, category_id BLOB, PRIMARY KEY(fold_id,budget_id,category_id)) STRICT, WITHOUT ROWID;
CREATE TABLE budget_scope_tag      (fold_id BLOB, budget_id BLOB, tag_id      BLOB, PRIMARY KEY(fold_id,budget_id,tag_id))      STRICT, WITHOUT ROWID;

CREATE TABLE goal (
  fold_id BLOB NOT NULL, id BLOB NOT NULL, name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0,
  target_minor INTEGER NOT NULL CHECK (target_minor > 0), currency TEXT NOT NULL,
  target_local_date INTEGER NOT NULL, account_id BLOB NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;

CREATE TABLE schedule (
  fold_id BLOB NOT NULL, id BLOB NOT NULL, kind INTEGER NOT NULL CHECK (kind IN (1,2)),   -- 1 transaction, 2 transfer
  template BLOB NOT NULL,                                                                  -- CBOR of the template (§4.4)
  begin_local_date INTEGER NOT NULL, end_local_date INTEGER,
  unit INTEGER NOT NULL CHECK (unit IN (1,2,3,4)), interval INTEGER NOT NULL CHECK (interval >= 1),
  requires_confirmation INTEGER NOT NULL DEFAULT 0, reminder_min INTEGER, completed_utc_ms INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (fold_id, id)
) STRICT;

CREATE TABLE fx_rate (
  fold_id BLOB NOT NULL, id BLOB NOT NULL, quote TEXT NOT NULL, as_of_utc_s INTEGER NOT NULL,
  rate_e12 INTEGER NOT NULL CHECK (rate_e12 > 0), source TEXT,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE UNIQUE INDEX fx_rate_lookup ON fx_rate(fold_id, quote, as_of_utc_s);

CREATE TABLE import_batch (fold_id BLOB NOT NULL, id BLOB NOT NULL, source TEXT, imported_utc_ms INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;
```

Rule: **only the sync engine writes domain tables.** UI mutations create an op (§9), which is applied to `op_log`, `field_clock` and the domain row in one SQLite transaction. This keeps a single code path for local and remote edits.

---

## 9. Sync engine — CRDT payload and protocol

### 9.1 Design
- **State-based per-field LWW registers inside operation-based delivery.** Each op carries only changed fields, each stamped with a Hybrid Logical Clock. Merge is commutative, associative and idempotent: the final state is a pure function of the *set* of ops received, regardless of order or duplication.
- The server is a dumb, ordered, signed-op relay (adversary A3/A4).

### 9.2 Hybrid Logical Clock
`HLC = (wall_ms: u48, ctr: u16)`, with the device id as tie-breaker, compared lexicographically as `(wall_ms, ctr, dev_id)`.

```
send/local event:   l' = max(l, now_ms); ctr' = (l' == l) ? ctr+1 : 0
receive(remote):    l' = max(l, remote.l, now_ms); ctr' = depends on which of the three equal l'
reject remote ops with wall_ms > now_ms + 24 h  (quarantine; protects against a client with a wildly fast clock capturing all LWW decisions)
```
`ctr` overflow (65 535 events in one millisecond) advances `wall_ms` by 1.

### 9.3 Op wire format (CBOR, deterministic)

```
OpEnvelope {                                  -- what the server stores and relays
  v:          u8   = 1,
  fold:       bytes16,
  op:         bytes16,                         -- UUIDv7
  rec:        bytes16,                         -- record id (random UUIDv4 or UUIDv5 for schedule-derived)
  dev:        bytes16,
  seq:        u64,                             -- per-device, strictly increasing, gap-detectable
  hlc:        [u48 wall_ms, u16 ctr],
  epoch:      u32,
  schema:     u16,
  blob:       bytes,                           -- §5.6: nonce(12) ‖ ct ‖ tag(16), padded plaintext (§9.8)
  sig:        bytes64                          -- Ed25519(dev_sig_sk, "cashfold.op.v1" ‖ canonical(all fields above except sig))
}
Payload (inside blob, CBOR) {
  t: u8,                                      -- table: 1 account 2 group 3 category 4 payee 5 tag 6 txn 7 transfer 8 budget 9 goal 10 schedule 11 fx_rate 12 import 13 settings 14 checkpoint
  f: { <field_id:u16>: <value> , … }          -- only fields written by this op; each takes the op's hlc
  fx: { <field_id:u16>: { add: [ids], rem: [[id, add-op-id]…] } }     -- set-valued fields (OR-Set deltas)
}
```
- Field ids for set-valued relations: `txn.tag_ids`, `account.group_ids`, `budget.scope_*`.
- Special field `0xFFFF = deleted: bool` (tombstone register).
- Each device's `seq` is monotone; a receiver detecting a gap (seq jumps) requests the missing range, so silent server drops are detectable (A4).
- The op `sig` is verified before decryption. The `blob` tag is verified before the payload is parsed.

### 9.4 Merge semantics

| Data shape | Rule |
|---|---|
| Scalar field (name, amount, date, FKs…) | LWW register. Winner = max `(wall, ctr, dev_id)`. Equal full stamps are impossible (device id is part of the stamp). |
| **Record as a unit** (transfer, transaction amount+currency+base snapshot) | Fields that must change together are written in **one op** with the same stamp, so concurrent edits resolve to *one* whole version per field group. For `transfer`, the fields `{from_account_id, to_account_id, from_amount_minor, to_amount_minor, fx_rate_id}` form a **field group** `G_amounts`. The group has a single register, so partial application of a transfer is impossible. For `txn`, `{amount_minor, currency, base_amount_minor, base_currency, fx_rate_id, direction}` form a group. |
| Set (tag ids, group membership, budget scope) | **Add-wins OR-Set.** Adds carry the op id as a unique tag. A remove names the add-tags it observed. A concurrent add survives. |
| Delete | `deleted` register (LWW); retention: a record deleted for more than 30 days is purged (rows, field clocks, history) on every device by a deterministic local job keyed on the tombstone's HLC wall time, and the service may drop its history once every active device has acknowledged a snapshot taken after the purge point (FR-052). A restore inside the window clears the register on every device, including devices that were offline during the delete. A later-stamped `deleted=false` is an explicit undelete. Field writes arriving after a delete are stored but the record stays invisible. A delete does not cascade in the CRDT; cascades are derived (§4.2-8). |
| Ordering fields (`sort_order`) | LWW integer. Collisions are tolerated and resolved by `(sort_order, name, id)` at read time. |
| Derived data (balances, counts, envelope availability, tag/payee usage) | **Never stored in ops.** |

Records never "move" between Folds. Moving = create in destination + delete in source.

### 9.5 Deterministic post-merge repair
CRDTs guarantee convergence, not application invariants. After applying a batch, `repair()` runs. It MUST be a pure function of the local merged state, so all replicas repair identically with no further ops needed:

| Violation | Repair (deterministic, local, not synced) |
|---|---|
| Txn references deleted/unknown account | Hidden from lists; shown in "Needs attention"; visible `orphan` count. Not auto-deleted. |
| Category depth > 2 or cycle | Interpret the deepest/lowest-id parent as root for display. Offer a user-authored fix op. |
| Currency mismatch (account currency changed concurrently) | Entry excluded from balance; flagged. |
| `expense` with positive amount | Flagged; amount used as stored. |
| Duplicate `UUIDv5` schedule occurrence | Impossible by construction (same id merges). |
| Transfer endpoint deleted | Transfer hidden from ledger. |
| Envelope `rollover` changed concurrently | LWW; availability recomputed. |

Repair produces **no ops**. User-driven fixes do. Auto-generating ops from repair would cause divergence loops between replicas.

### 9.6 Sync protocol (over the authenticated transport of §6.5)

```
PUSH   POST /v1/folds/{fold}/ops     body: [OpEnvelope…]  (≤ 256 ops, ≤ 4 MiB)
         server: verify sig against current membership (editor+), verify dev/seq monotonic, assign server_seq (bigserial), store
         resp:  [{op, server_seq} | {op, error}]       -- idempotent on (fold, op)
PULL   GET  /v1/folds/{fold}/ops?after={server_seq}&limit=500
         resp:  { ops: [{server_seq, OpEnvelope}…], head: u64, more: bool }
STREAM WS   /v1/folds/{fold}/stream           -- server pushes {head}; client PULLs
MEMBERSHIP  GET/POST /v1/folds/{fold}/log?after={idx}
GRANTS      GET /v1/folds/{fold}/grants?member=me
SNAPSHOT    PUT/GET /v1/folds/{fold}/snapshot  -- client-encrypted state snapshot at server_seq N (§9.7)
RATES       GET /v1/rates                       -- shared non-personalised rate table (§3.8); no authentication needed
EMAIL       POST /v1/accounts/verify-email      -- one-time token; PUT /v1/accounts/me/discoverable; POST /v1/accounts/lookup (§7.4)
INVITE      POST /v1/folds/{fold}/invitations   -- records an invitation and sends the notification (FR-107)
ACCOUNT     DELETE /v1/accounts/me              -- account deletion (§9.9), requires fresh SRP proof
```
- Client loop: apply local ops to `op_log` immediately (offline), PUSH pending ops in `dev_seq` order, PULL from `pull_cursor`, apply remote ops in `server_seq` order, advance the cursor in the same transaction.
- Idempotency: `(fold_id, op_id)` is unique. A re-delivered op is a no-op.
- Per-op failure policy: bad signature / unauthorised signer / tag failure / unknown `v` ⇒ quarantine, continue. An unknown `epoch` ⇒ wait for the grant and retry.

### 9.7 Server schema (PostgreSQL; ciphertext and routing metadata only)

```sql
CREATE TABLE account (
  account_id   bytea PRIMARY KEY,                 -- 6-char id padded or random 16-byte; non-secret
  email_hmac   bytea UNIQUE NOT NULL,             -- HMAC-SHA256(server_secret, lower(email)); the server need not hold plaintext email except for mail delivery
  auth_salt    bytea NOT NULL CHECK (length(auth_salt)=16),
  kdf          jsonb NOT NULL,                    -- {kdf, params, enc_salt}
  srp_v        bytea NOT NULL,                    -- 512 bytes
  keyset       bytea NOT NULL,                    -- CBOR KeySet (ciphertext of private keys)
  recovery     bytea,
  fail_count   int NOT NULL DEFAULT 0, locked_until timestamptz
);
CREATE TABLE device (dev_id bytea PRIMARY KEY, account_id bytea REFERENCES account, sig_pk bytea NOT NULL, label_ct bytea, created_at timestamptz, revoked_at timestamptz);
CREATE TABLE fold (fold_id bytea PRIMARY KEY, created_at timestamptz, head_seq bigint NOT NULL DEFAULT 0);
CREATE TABLE fold_log (fold_id bytea REFERENCES fold, idx bigint, entry bytea NOT NULL, hash bytea NOT NULL, PRIMARY KEY (fold_id, idx));
CREATE TABLE fold_grant (fold_id bytea REFERENCES fold, epoch int, member bytea REFERENCES account, grant bytea NOT NULL, PRIMARY KEY (fold_id, epoch, member));
CREATE TABLE op (
  fold_id bytea NOT NULL REFERENCES fold, server_seq bigint NOT NULL, op_id bytea NOT NULL,
  rec_id bytea NOT NULL, dev_id bytea NOT NULL, dev_seq bigint NOT NULL,
  hlc_wall bigint NOT NULL, hlc_ctr int NOT NULL, epoch int NOT NULL, schema_ver int NOT NULL,
  blob bytea NOT NULL, sig bytea NOT NULL,
  PRIMARY KEY (fold_id, server_seq), UNIQUE (fold_id, op_id), UNIQUE (fold_id, dev_id, dev_seq)
);
CREATE TABLE snapshot (fold_id bytea PRIMARY KEY REFERENCES fold, at_seq bigint NOT NULL, blob bytea NOT NULL, sig bytea NOT NULL);
CREATE TABLE fold_member (fold_id bytea REFERENCES fold, member bytea REFERENCES account, role smallint NOT NULL, from_epoch int NOT NULL DEFAULT 1, removed_at timestamptz, PRIMARY KEY (fold_id, member));
CREATE TABLE rate_table (as_of timestamptz PRIMARY KEY, base text NOT NULL DEFAULT 'USD', rates jsonb NOT NULL, source text NOT NULL);   -- rates as decimal strings; one shared table, no per-user data
ALTER TABLE account ADD COLUMN email_verified_at timestamptz, ADD COLUMN discoverable boolean NOT NULL DEFAULT true;
CREATE TABLE email_verification (account_id bytea REFERENCES account, token_hash bytea NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, PRIMARY KEY (account_id, token_hash));
CREATE TABLE tombstone_account (account_id bytea PRIMARY KEY, deleted_at timestamptz NOT NULL);   -- lets devices learn of deletion (410) without storing content
```
The server holds no key material that can decrypt `blob`, `keyset`, or `snapshot.blob`. Compaction: after a signed snapshot at `at_seq = N` exists and every registered, non-revoked device has acknowledged ≥ N, ops ≤ N MAY be deleted.

### 9.8 Metadata exposure (accepted, and reduced where cheap)
The server sees: account/fold/device ids, record ids, op counts and timing, HLC wall-clock, per-op blob size, membership (public keys and roles). Mitigations:
- Pad plaintext payloads to the next multiple of 256 bytes before encryption (PKCS-style length prefix inside the payload).
- Table code and all semantics are inside the ciphertext.
- Attachments are chunked and padded to a multiple of 64 KiB.
- The record id is random, so it does not disclose entity type or order.
- HLC `wall_ms` leaks activity times. This is an accepted trade-off because it is needed for LWW. Clients MAY coarsen it to 1 s plus the counter.

### 9.9 Account deletion and service migration (FR-100, FR-101)

**Deletion.**
1. Client verifies a fresh unlock and explicit confirmation.
2. Client checks the membership logs of all Folds. If the account is `owner` of any Fold with other active members, the client blocks and offers *transfer ownership* (§7.3 `change_role`) or *delete Fold*.
3. Client sends `DELETE /v1/accounts/me` with a fresh SRP proof. The server deletes the account, devices, key sets, recovery blob, sessions, grants, and every Fold in which the account was the only member; for other Folds it appends a `remove_member` for this account (signed by the account's last device key, supplied in the request) and removes its grants. It records a `tombstone_account` row.
4. Other devices of the account receive `410 Gone` and wipe local data (§7.7).

**Migration between services.** The Secret Key, password and key sets are service-independent, so migration is client-driven:
1. On the new service the client registers using the same credentials (new `auth_salt` and verifier).
2. For each Fold the client re-creates the Fold, replays the membership log (entries are self-verifying), uploads grants, and pushes its full local `op_log` (preserving `dev`, `seq`, HLC). The new service assigns fresh `server_seq`.
3. Other members and devices are re-pointed via a signed `set_server` settings record in each Fold; they then perform the same registration on the new service. Until then they remain on the old one (the old service stays read-write; devices reconcile through the op log).
4. After success the client calls `DELETE /v1/accounts/me` on the old service.


### 9.10 Server implementation notes (NestJS)
- Modules map to the endpoint groups in §9.6: `auth` (SRP handshake, sessions, frames), `devices`, `folds`, `membership` (log, grants), `ops` (push/pull/stream), `snapshots`, `attachments`, `rates`.
- Pipeline: a global guard verifies the transport frame (counter, AEAD) and resolves the session; a per-route guard checks membership role and device authorisation from the signed log; DTOs are validated with schemas imported from `packages/protocol` (the same schemas the client uses).
- Persistence: PostgreSQL through a repository layer; the per-Fold `server_seq` is assigned inside the push transaction (a locked counter row, revisited after load tests).
- Storage of attachments and snapshots: S3-compatible object storage behind a port; the server stores ciphertext only.
- `mail` module: a port with SMTP and log-only adapters. Sends verification and invitation notices only, with no financial or Fold information. If no mail transport is configured, verification is disabled by configuration and the app tells users that invitations then depend on out-of-band checks (FR-105).
- Lookup abuse control: the lookup endpoint requires a verified session, is rate-limited per account and per IP, and returns uniform `404` for unknown and non-discoverable addresses (FR-106).
- Rate source: a scheduled job fetches the configured upstream table, parses decimal strings (no floats), stores one row in `rate_table`, and serves it at `GET /v1/rates` (§3.8).
- Rate limiting and lockout counters are server-side (Redis or PostgreSQL). The "fake salt" for unknown emails is a keyed MAC (§6.3).
- Observability: structured logs with type-based redaction; metrics and traces carry ids and counts only.
- Self-hosting: container image and Compose file (server + PostgreSQL); configuration through environment variables or a config file; identical build for the hosted instance.

---

## 10. Client hardening and memory hygiene

JavaScript cannot guarantee that secrets are erased from memory: the garbage collector may copy buffers, and engines may keep strings alive. The rules below reduce exposure; they do not eliminate it, and the threat model states this limit.

1. **Isolation.** All key material lives in the Core Worker. The UI thread never receives key bytes, passwords after submission, or decrypted private keys, only opaque handles and read-model results.
2. **Key objects.** Use non-extractable `CryptoKey` objects wherever the algorithm is supported (AES-GCM, HKDF base keys, Ed25519 device key). Raw key bytes exist only where a library requires them (Argon2id, SRP, `@noble`).
3. **Secret buffers.** Secrets are held in `Uint8Array`s (never strings) wrapped in a `Secret` type that has no `toString`/`toJSON`/serialisation and exposes `use(fn)` and `wipe()`. `wipe()` overwrites with zeros. Passwords are read from the input element into a `Uint8Array` and the input is cleared.
4. **Lifetime.**
   - The password buffer is wiped immediately after key derivation, including on error paths.
   - `K_pw`, `K_sk`, the SRP `a`/`S`/`K` and the transport keys are wiped as soon as the next stage is derived.
   - `AUK` is wiped after the KeySet is opened. The opened private keys live only while unlocked.
   - `FK` is held only while the Fold is open; the stored copy is wrapped (§8.2).
5. **Auto-lock.** Timeout (default 5 min), `visibilitychange` to hidden for more than a configurable grace period (default 1 min), explicit lock, and `pagehide`. Locking wipes all secrets, closes the database and **terminates the Core Worker** so its heap is released.
6. **Hiding content.** On `visibilitychange` to hidden, `blur`, `pagehide` and `freeze`, the UI immediately replaces financial content with a neutral cover (FR-007). Browsers expose no app-switcher or screenshot control, so these cannot be prevented and the product states this; native shells later add platform privacy screens.
7. **UI leakage.** `autocomplete="off"`/`new-password` on the right fields; password and Secret Key fields use `type="password"` with a reveal control; balances use a "hide amounts" toggle; no sensitive data in URLs, titles, history state or `localStorage`; the add-device fragment is removed after reading (§6.6); screenshots cannot be prevented in a browser, and the product says so.
8. **Clipboard.** The Secret Key and Recovery Key are copied only on explicit user action, and the app attempts to overwrite the clipboard after 60 seconds (best-effort; browsers may refuse).
9. **Delivery integrity.** Strict CSP (`default-src 'none'`; `script-src 'self' 'wasm-unsafe-eval'`; `connect-src` limited to the configured service; `frame-ancestors 'none'`; `require-trusted-types-for 'script'`), Subresource Integrity for every script, no third-party scripts, no inline scripts, HSTS, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying unused features, a service worker that serves only the pinned, hashed asset set, published build hashes, an SBOM, and reproducible builds. Self-hosters can serve the static export from their own origin.
10. **Logging.** A structured logger with a redaction type; amounts, names, notes and keys MUST NOT be logged at any level. Error reporting, if present, is self-hosted, opt-in and strips payloads.
11. **Constant-time.** Comparisons of MACs, proofs and tags use constant-time helpers. Secret-dependent big-integer arithmetic follows §6.9.
12. **Supply chain.** Pinned dependencies with lockfile enforcement, provenance verification, automated vulnerability scanning, a minimal dependency set, and review of any dependency that touches key material.

---

### 10.1 Desktop shell and update signatures (spec 003)

The desktop app is an Electron shell around the unchanged static export (ADR-0009). It adds no domain logic, no key handling and no change to `core`, `crypto` or `protocol`.

- **Origin and headers.** The export is served on the privileged origin `app://cashfold`; the response headers are the ones `harden-html.mjs` writes to `_headers` (CSP, no inline script, Trusted Types), so web and desktop share one policy.
- **Isolation.** Context isolation and sandbox on, no Node integration in the renderer, navigation and `window.open` denied, a permission allow-list, Electron fuses set at packaging. The only bridge is a small typed contract (`@cashfold/platform`): version and build info, the data location, and the update state machine. Every IPC call is checked against strict schemas and against the sender's origin.
- **Data.** The encrypted database lives where Chromium keeps its profile, in the OS per-user application-data folder. Backups are the existing passphrase-encrypted `.cashfold-backup` (§5.8); the shell only shows a native save dialog.

#### Update signatures

Updates are applied only with the user's consent, and every in-app update must be shown to come from the project (FR-016 of spec 003). The updater's own check (SHA-512 from the release feed) proves integrity only: whoever controls the release controls the feed. Authenticity therefore rests on a detached signature the project makes and the app checks.

- **Scheme.** Ed25519 (RFC 8032) over the UTF-8 message `cashfold-update-v1\n<asset name>\n<sha512 base64>`, where the SHA-512 is the value in the feed. The signature is base64 in `<asset name>.sig`, uploaded with the installer.
- **Keys.** One or two raw public keys are compiled into the app (`UPDATE_PUBLIC_KEYS`); a signature from any of them is valid. The private key exists only as a secret in the protected `release` environment and in an offline backup held by a second person. Rotation: publish a release that trusts old and new key, then retire the old key one release later. A lost key strands installed apps, which is why the backup exists.
- **Verification.** After the download and before the app reports the update as ready, the main process fetches the `.sig` from the same release, checks it with WebCrypto, and on any failure deletes the file and reports `verify-failed`. Download URLs are pinned to the project's release URL.
- **Implementation.** WebCrypto (`crypto.subtle`, Ed25519) only; no new primitive and no third-party signing library. It lives in `scripts/lib/update-signature.mjs` (used by the signing script and bundled into the app), outside `packages/crypto`, because a shell must not require changes to `crypto` (ADR-0010). Known-answer tests use the RFC 8032 §7.1 vectors.
- **Limits.** A stolen private key lets an attacker sign a malicious update; the mitigations are custody in the protected environment, offline backup, two-key rotation, and the OS signature that signed builds also carry. See the threat model.

## 11. Verification requirements

An implementation is conformant only if it ships with:

1. **Known-answer tests:** HKDF-SHA256 (RFC 5869 A.1–A.3), Argon2id (RFC 9106 §5.3), PBKDF2-HMAC-SHA256, AES-256-GCM (NIST SP 800-38D vectors), X25519 (RFC 7748 §6.1), Ed25519 (RFC 8032 §7.1), HPKE (RFC 9180 A.1), and an SRP-6a exchange with fixed `a`, `b` against the 4096-bit RFC 3526 group.
2. **2SKD cross-implementation vector** (to be generated once and frozen in the repo): fixed `password`, `email`, `secret_key`, `salt16`, `kdf_params` ⇒ expected `AUK` and `SRP-x`. Includes a non-ASCII password (`"Å"` as U+212B, U+00C5 and U+0041 U+030A MUST all produce the same bytes under NFKD).
3. **Money:** property tests (`fast-check`) for `balance(a) = opening + Σ entries`; sign invariants; FX round-trip bounds (`|convert(convert(a, X→Y), Y→X) − a| ≤ 1` minor unit at the same date for `rate_e12 ≥ 10^6`); half-even rounding on `.5` ties; overflow rejection; 64-bit values above 2^53 survive a round trip through the SQLite WASM adapter; absence of `number` and floating-point operations in money paths (lint rule plus a CI gate).
4. **Recurrence:** month-end clamping vectors (31 Jan monthly ⇒ 28/29 Feb, 31 Mar), leap-year yearly (29 Feb), DST boundaries (`local_date` stable), and convergence of two devices generating the same occurrence.
5. **CRDT:** randomised convergence test. Apply the same op multiset in 1 000 random permutations with random duplication ⇒ identical resulting state and identical `repair()` output.
6. **Sync adversary tests:** server swaps blobs between records/folds, drops an op, replays a frame, reorders ops, serves a forged membership entry, serves a downgraded KDF ⇒ client rejects each with a specific error.
7. **Storage:** opening the DB with a wrong key fails; no plaintext money or name strings appear in the OPFS files, IndexedDB, logs or network captures (leak scan in CI using Playwright).
8. **Fuzzing:** CBOR decoder, op envelope parser, SRP message parser (fast-check structured fuzzing, plus a coverage-guided fuzzer for the WASM modules).
9. **Architecture fitness:** dependency-boundary lint passes (`core` imports nothing from React, Next, Nest, DOM or Node-only modules; `apps/server` does not import `core` domain); a test replays the op log into empty projections and compares them to the live projections.
10. **Cross-implementation SRP:** client WASM, server OpenSSL path and an independent reference produce identical `A`, `B`, `S`, `K`, `M1`, `M2` for 100 random exchanges.
11. **End-to-end:** Playwright scenarios for each P1/P2 story, including offline operation and two-browser sync.
12. **Accessibility:** axe checks and keyboard-only flows meet WCAG 2.2 AA; axe runs as a blocking CI check on every pull request from the first UI task onward.
13. **Offline reload:** with the network disabled after one successful load, reloading or reopening the app works and all offline functions run.
14. **Secret lifetime:** tests assert that password buffers are wiped after key derivation (including error paths), derived keys are wiped after use, and lock wipes all secrets and terminates the worker.
15. **Fold isolation:** a record encrypted for Fold A cannot be decrypted with any key of Fold B, and no table query without `fold_id` returns cross-Fold rows.
16. **User-facing errors:** every error message in the catalogue is plain language and a leak test proves no amount, name, note or key material appears in error text, logs or telemetry.
17. **Invitation lookup:** unknown and non-discoverable addresses return identical responses and timing within measurement noise; lookups are rate-limited; notification emails contain no Fold information.
18. **Retention:** deleted records are restorable for 30 days on every device (including one offline during the delete) and are purged afterwards.

---

## 12. Open questions and verification TODOs

| # | Item | Why it matters | How to resolve |
|---|---|---|---|
| 1 | Importer for third-party CSV/backup formats: date formats, enum meanings, list encodings. | Import fidelity. | Define per-source mappers against real sample files. |
| 2 | Argon2id memory on low-end devices and in mobile browsers. | UX vs security. | Benchmark; the floor in §5.3 is the hard limit. |
| 3 | Final SRP message encoding (padding, `k`, M1 composition). | Interoperability between Cashfold clients and server. | §6.1/§6.3 are normative; freeze with test vectors (§11). |
| 4 | Encrypted SQLite on OPFS: built-in cipher WASM build vs custom VFS (§8.1). | Core at-rest guarantee and performance. | Prototype both; benchmark at 50,000 transactions; record ADR-0002. |
| 5 | WebAuthn PRF availability and behaviour across browsers (§5.2). | Quick unlock feasibility. | Feature-detect; document the password-only fallback. |
| 6 | WebCrypto X25519/Ed25519 support matrix vs `@noble` fallback (§5.1). | Non-extractable device keys. | Feature tests per target browser; fallback paths covered by tests. |
| 7 | Vetted constant-time big-integer WASM module for client-side SRP (§6.9). | Side-channel safety of login. | Select, review and differential-test against OpenSSL; record ADR. |
| 8 | Node/OpenSSL constant-time path for 4096-bit custom-prime DH on the server (§6.9). | Server-side side-channel safety. | Verify behaviour on the supported Node versions; add a regression test. |
| 9 | TypeScript deterministic-CBOR library choice (§5.1). | Byte-stable signatures and AAD. | Evaluate against frozen vectors; fall back to a small in-house encoder with a fuzzed test suite. |
| 10 | Browser storage eviction and quota policy differences (§8.1a). | Local-first durability. | Test on target browsers; refine the backup prompts. |
| 11 | Upstream source for the rate table and its redistribution terms (§3.8). | Legal and availability. | Choose a source; document in the self-hosting guide. |
| 12 | Lookup rate limits and the discoverable-by-default choice (§7.4). | Account-enumeration exposure versus convenience. | Review after the first hosted pilot; the default is configurable per service. |
| 13 | Mail transport for hosted and self-hosted services (§9.10). | Verification and invitation delivery. | Choose a provider for the hosted instance; document SMTP setup for self-hosters. |
| 14 | Service-worker update strategy (§0.3). | Stale-code risk versus offline guarantee. | Define cache versioning and update prompt; test upgrade while offline. |
