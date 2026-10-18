# Cashfold — Architectural Blueprint & Technical Specification

**Status:** Draft 0.1 · **Date:** 2026-10-18 · **Audience:** engineers implementing the Cashfold client core, sync server and mobile/desktop shells.

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
4. **Password hashing** is Argon2id with a PBKDF2-HMAC-SHA256 fallback for environments without a native/WASM core (§5.3).
5. **Asymmetric cryptography** is X25519 (sealing via HPKE) and Ed25519 (signatures) (§5.1).
6. **SRP** is SRP-6a with SHA-256 over the 4096-bit RFC 3526 group, with a fully pinned message format (§6).
7. **Cashfold defines its own protocols.** Interoperability with any other product is not a goal.
8. AES-256-GCM, HKDF-SHA256 and a Secret Key of at least 128 bits of entropy are fixed requirements.

---

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
| A5 | Stolen device (locked) | Disk image | SQLCipher, Keychain/Secure Enclave wrapping |
| A6 | Revoked member | Retains old keys | Key epoch rotation (§7.5). Past data seen is not recallable. |
| A7 | Malware on unlocked device | Out of scope | Mitigation limited to memory hygiene (§10) |

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
- Language bindings: Rust `i64` (intermediate `i128`), Swift `Int64`, TypeScript `bigint`. **JavaScript `number` MUST NOT be used for amounts.**
- Aggregation: all sums use `i128` (Rust) or SQLite `SUM()`. SQLite raises "integer overflow" rather than wrapping. The ledger layer MUST treat that error as fatal for the query.
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
projected_minor    = round_half_even(spent * d_total / d_elapsed)     -- i128 intermediate
overspend_flag     = projected_minor > carry_in + allocation_minor
```

### 3.8 Multi-currency and FX
- Each account has exactly one currency. A transaction's `currency` MUST equal its account's currency.
- A rate record: `Rate { id, base: "USD", quote, as_of_utc_s: i64, rate_e12: i64, source }`.
  - `rate_e12` = round(units of `quote` per 1 `base` × 10^12). USD is the pivot currency; no floats are involved. Example: `BTC 9.846849e-6` ⇒ `9846849`, `AED 3.67298` ⇒ `3672980000000`, and a ~16 000-per-USD currency fits in `i64` (1.6×10^16).
  - Ingest from float JSON by **parsing the decimal string**, not via `f64`.
- Conversion of `a` minor units of currency X (exponent `eX`) to currency Y (exponent `eY`) through USD:

```
y_minor = round_half_even( a * 10^eY * R_Y  /  ( 10^eX * R_X ) )       with R_* = rate_e12, R_USD = 10^12
```
  A single division on `i128`/BigInt avoids double rounding. Intermediate magnitude bound: `|a| < 2^63`, `10^eY ≤ 10^8`, `R ≤ 2^63` ⇒ numerator < 2^63·2^27·2^63 = 2^153, which exceeds `i128`. Implementations MUST therefore use arbitrary precision (Rust `num-bigint`/`ruint::U256`, TS `bigint`) for the multiplication, and narrow after division. Overflow of the narrowed result is an error.
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
| CSPRNG | OS CSPRNG: `SecRandomCopyBytes` (Apple), `getrandom(2)` (Linux), `BCryptGenRandom` (Windows), `crypto.getRandomValues` (web) | §Randomness lists these |
| Symmetric AEAD | **AES-256-GCM**, 96-bit random nonce, 128-bit tag | |
| KDF (key extraction/expansion) | **HKDF-SHA256** (RFC 5869) | |
| Password hash (primary) | **Argon2id** (RFC 9106), output 32 B | Memory-hard; requires a native or WASM core. |
| Password hash (fallback) | **PBKDF2-HMAC-SHA256, 650,000 iterations** | |
| PAKE | **SRP-6a**, RFC 5054 conventions, SHA-256, 4096-bit group | 4096-bit group from RFC 3526. |
| Key agreement / sealing | **X25519** inside **HPKE** (RFC 9180): DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM | |
| Signatures | **Ed25519** (RFC 8032) | |
| Local DB | SQLCipher 4 (AES-256-CBC + HMAC-SHA512 per page) | |
| Hardware key | Secure Enclave P-256 (the only curve the SE supports) | |
| Serialization | Deterministic CBOR (RFC 8949 §4.2.1) | |

Rationale: Argon2id is memory-hard, which raises GPU/ASIC cost far above PBKDF2 at equal latency. X25519/Ed25519 give 128-bit security with 32-byte keys, constant-time implementations are ubiquitous. SRP's 4096-bit group exceeds the commonly required ≥2048-bit minimum at a cost of one extra modular exponentiation per login.

### 5.2 Secret Key (128-bit, client-generated)
Format `C1-AAAAAA-SSSSSSSSSSS-SSSSS-SSSSS-SSSSS`, where:
- `C1` is the non-secret format/version tag.
- `AAAAAA` is a 6-character non-secret account id, random.
- The remaining 26 characters are secret. They are drawn from the 32-symbol alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excludes `I O 0 1`). Each character encodes exactly 5 random bits, so there is no modulo bias.
- Entropy is 26 × 5 = **130 bits** (≥128).
- Hyphens are display-only and are stripped before use.

**Generation:** 26 × 5 = 130 bits are read from the CSPRNG (17 bytes, 4 bits discarded). The account id is read the same way (30 bits from 4 bytes, 2 bits discarded).

**Storage on a device:**
1. Generate an AES-256 *Device Unlock Key* `DUK` (CSPRNG).
2. Create a Secure Enclave P-256 key `SE_k` with access control `kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`, `kSecAttrTokenIDSecureEnclave`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
3. Wrap `DUK` with `SE_k` via `SecKeyCreateEncryptedData(.eciesEncryptionStandardVariableIVX963SHA256AESGCM)`; store the blob in the Keychain with the same accessibility class and `kSecAttrSynchronizable = false`.
4. Encrypt the secret Secret Key and the cached `SRP-x` under `DUK` with AES-256-GCM, AAD `"cashfold.dukblob.v1"`, and store it in the app container.

Platforms without SE (Linux/Windows/Android without StrongBox): keystore-backed AES key (TPM, DPAPI, Android Keystore); web: not stored (the user retypes the Secret Key or uses a passkey-style device credential).

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
                                                          └─ HKDF ──► SQLCipher key (per device; derived from DUK, not FK)
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
- `FK` is stored **only** as per-member HPKE envelopes (§7.2). A Fold's owner has an envelope for their own `enc.pk`.
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
1. The user scans/pastes the add-device URL from an existing device or the Emergency Kit: `cashfold://add?email=…&server=…&key=C1-…` (the Secret Key travels only through a user-controlled channel: QR, paste, paper).
2. The new device asks for the password, fetches `{auth_salt16, enc_salt16, kdf_params}`, and derives `SRP-x` and `AUK`.
3. SRP login (§6.3). The client fetches the KeySet and decrypts the private keys with `AUK`.
4. The client generates a device Ed25519 key, registers it, and the owner (or the user's other device) signs the registration in the membership log (§7.3).
5. Fold envelopes are fetched and opened (§7.2). The device then begins sync.

### 6.7 Password / Secret Key change
Both change `AUK` (and `SRP-x`). The client re-wraps the KeySet's private keys under the new AUK, re-computes `v`, and uploads atomically `{v, auth_salt16', KeySet', kdf'}` in a single authenticated request. Fold envelopes are unaffected because they are HPKE-wrapped to the unchanged X25519 public key.

### 6.8 Account recovery
There is **no server-side recovery**. Offered mechanisms:
- **Emergency Kit** (Secret Key; the password is the user's responsibility).
- **Recovery Key** (optional): 32 random bytes `RKm`; `RK_auth = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_AUTH_v1")`, `RK_enc = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_ENC_v1")`, `RK_uuid = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_UUID")[0:16]`. `RK_enc` AES-256-GCM-wraps the KeySet private keys; `RK_auth` is used as a second SRP-x for the recovery credential. The server stores only the second verifier and the wrapped KeySet.
- **Family recovery** via a Fold co-member re-sealing the FK to a new public key (§7).

---

## 7. Sharing and access control

### 7.1 Principals and keys
Each user has the KeySet from §5.4: an X25519 key (`enc`) and an Ed25519 key (`sig`). Each device additionally has its own Ed25519 *device signing key* (stored in Keychain, never exported). Device keys are certified by the user's `sig` key in the membership log.

### 7.2 Fold Key envelope (HPKE, RFC 9180 base mode)
To grant member `m` access to Fold `F` at epoch `e`:

```
(enc, ct) = HPKE.Seal( pkR = m.enc.pk,
                       info = CBOR["cashfold.foldkey.v1", fold_id, e, m.account_id],
                       aad  = CBOR["cashfold.foldkey.v1", fold_id, e, role],
                       pt   = FK[e] (32 B) )
envelope  = { fold_id, epoch: e, member: m.account_id, role, enc: bytes32, ct: bytes48, granted_by, sig: Ed25519(granter.sig, canonical(envelope_without_sig)) }
```
Only the member's X25519 secret key opens the envelope. The server stores envelopes opaquely. Envelopes are individually signed, so a server cannot swap one in or out unnoticed.

### 7.3 Membership log
Each Fold has an append-only, hash-chained, signed **membership log**. Entry types:

```
Entry { idx: u64, prev_hash: bytes32, type: add_member | remove_member | change_role | add_device | revoke_device | rotate_epoch,
        subject: account_id|device_id, role?, pubkeys?, epoch?, signer: account_id, sig: Ed25519 over canonical(entry), ts: utc_ms }
hash = SHA-256(canonical(entry))
```
- Roles: `owner` (all, including add/remove members and rotate), `editor` (write records), `viewer` (read only).
- An op signed by a device not currently authorised for `editor` or higher at the op's causal position MUST be rejected by every client. The server also enforces this, but clients never rely on the server.
- Clients verify the full chain from the genesis entry (signed by the Fold creator, whose public key was pinned when the Fold was created locally or when first invited).

### 7.4 Inviting a user
1. Inviter obtains the invitee's *public key bundle* `{account_id, enc.pk, sig.pk, self_signature}` from the server.
2. **Fingerprint check (mandatory for Family/Business Folds).** Both sides compute `fp = SHA-256("cashfold.fp.v1" ‖ enc.pk ‖ sig.pk)` truncated to 20 bytes, shown as 8 groups of 5 digits, compared out-of-band or by QR. Without it the server could substitute its own key (adversary A4).
3. The inviter signs an `add_member` entry and uploads the envelope (§7.2) for the current epoch.
4. The invitee verifies the log chain and envelope signature, opens the envelope, and starts syncing.

### 7.5 Revocation and key rotation
Cryptographic revocation requires a new key:
1. An owner appends `remove_member` and `rotate_epoch(e+1)`.
2. Generate `FK[e+1]` (CSPRNG) and seal it to every remaining member (new envelopes at epoch e+1).
3. All *new* ops are encrypted under epoch `e+1`. Old records remain readable via `FK[e]`, which remaining members retain.
4. Optional background re-encryption of old records to `e+1` (a pure re-key op carrying the same field timestamps), after which `FK[e]` can be discarded.

The removed member may already have copied data from epoch ≤ e. This cannot be undone; the UI MUST say so.

---

## 8. Local storage — SQLite / SQLCipher

### 8.1 Encryption at rest
- SQLCipher 4, `PRAGMA key = "x'<64 hex DBK><32 hex salt>'"` (raw key form, so no PBKDF2 is applied to a key that is already uniform).
- `DBK = HKDF-SHA256( IKM = DUK, salt = device_id, info = "cashfold.sqlcipher.v1", L = 32 )`.
- Settings: `cipher_page_size = 4096`, `cipher_hmac_algorithm = HMAC_SHA512`, `cipher_memory_security = ON`, `cipher_use_hmac = ON`, `journal_mode = WAL`, `secure_delete = ON`, `foreign_keys = ON`, `temp_store = MEMORY`.
- WAL, journal and temp files are covered by SQLCipher. The DB file carries `NSFileProtectionComplete` on iOS and is excluded from iCloud/iTunes backups.
- The database holds **decrypted, queryable data** (the local trust boundary is the unlocked device) plus the encrypted op log used to talk to the server.

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

-- ===== Domain tables (plaintext inside SQLCipher) =====
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
  t: u8,                                      -- table: 1 account 2 group 3 category 4 payee 5 tag 6 txn 7 transfer 8 budget 9 goal 10 schedule 11 fx_rate 12 import 13 membership-adjacent settings
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
| Delete | `deleted` register (LWW). A later-stamped `deleted=false` is an explicit undelete. Field writes arriving after a delete are stored but the record stays invisible. A delete does not cascade in the CRDT; cascades are derived (§4.2-8). |
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
ENVELOPES   GET /v1/folds/{fold}/envelopes?member=me
SNAPSHOT    PUT/GET /v1/folds/{fold}/snapshot  -- client-encrypted state snapshot at server_seq N (§9.7)
```
- Client loop: apply local ops to `op_log` immediately (offline), PUSH pending ops in `dev_seq` order, PULL from `pull_cursor`, apply remote ops in `server_seq` order, advance the cursor in the same transaction.
- Idempotency: `(fold_id, op_id)` is unique. A re-delivered op is a no-op.
- Per-op failure policy: bad signature / unauthorised signer / tag failure / unknown `v` ⇒ quarantine, continue. An unknown `epoch` ⇒ wait for the envelope and retry.

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
CREATE TABLE fold_envelope (fold_id bytea REFERENCES fold, epoch int, member bytea REFERENCES account, envelope bytea NOT NULL, PRIMARY KEY (fold_id, epoch, member));
CREATE TABLE op (
  fold_id bytea NOT NULL REFERENCES fold, server_seq bigint NOT NULL, op_id bytea NOT NULL,
  rec_id bytea NOT NULL, dev_id bytea NOT NULL, dev_seq bigint NOT NULL,
  hlc_wall bigint NOT NULL, hlc_ctr int NOT NULL, epoch int NOT NULL, schema_ver int NOT NULL,
  blob bytea NOT NULL, sig bytea NOT NULL,
  PRIMARY KEY (fold_id, server_seq), UNIQUE (fold_id, op_id), UNIQUE (fold_id, dev_id, dev_seq)
);
CREATE TABLE snapshot (fold_id bytea PRIMARY KEY REFERENCES fold, at_seq bigint NOT NULL, blob bytea NOT NULL, sig bytea NOT NULL);
```
The server holds no key material that can decrypt `blob`, `keyset`, or `snapshot.blob`. Compaction: after a signed snapshot at `at_seq = N` exists and every registered, non-revoked device has acknowledged ≥ N, ops ≤ N MAY be deleted.

### 9.8 Metadata exposure (accepted, and reduced where cheap)
The server sees: account/fold/device ids, record ids, op counts and timing, HLC wall-clock, per-op blob size, membership (public keys and roles). Mitigations:
- Pad plaintext payloads to the next multiple of 256 bytes before encryption (PKCS-style length prefix inside the payload).
- Table code and all semantics are inside the ciphertext.
- Attachments are chunked and padded to a multiple of 64 KiB.
- The record id is random, so it does not disclose entity type or order.
- HLC `wall_ms` leaks activity times. This is an accepted trade-off because it is needed for LWW. Clients MAY coarsen it to 1 s plus the counter.

---

## 10. Client hardening and memory hygiene

JavaScript offers very limited ability to clear data from memory, so the rules below apply to all clients, and the web build adds extra constraints.

1. **Core in a memory-safe native language** (Rust) exposed to UI shells via FFI/WASM. The UI layer never holds raw key bytes, only opaque handles.
2. **Secret types:** `Secret<[u8; N]>` wrapping memory that is `zeroize`d on drop, with `Debug`/`Display`/`Serialize` deliberately not implemented. The compiler barrier `zeroize` uses volatile writes plus a fence to prevent dead-store elimination.
3. **Locked pages:** allocate key material from `mlock`ed (`VirtualLock` on Windows) pages marked `MADV_DONTDUMP` where available, excluded from core dumps. On iOS, rely on `kSecAttrAccessible…ThisDeviceOnly`; never place secrets in `NSUserDefaults`, pasteboard, logs or crash reports.
4. **Lifetime:**
   - The password buffer is zeroed immediately after 2SKD, even on error paths.
   - `K_pw`, `K_sk`, the SRP `a`/`S`/`K` and the transport keys are zeroed as soon as the next stage is derived.
   - The `AUK` is zeroed after the KeySet is opened. The opened private keys live only while unlocked.
   - `FK` is held in memory only while the Fold is open; the on-disk copy is wrapped (§8.2).
5. **Auto-lock:** timeout (default 1 min on mobile, 5 min on desktop), immediate lock on app background (iOS `sceneDidEnterBackground`), screen lock, or system sleep. Locking zeroes all of 4 and closes the SQLCipher handle (`sqlite3_close_v2` plus `PRAGMA cipher_memory_security`).
6. **UI leakage:** secure text fields; `isSecureTextEntry`; blur the app switcher snapshot; `UIScreen.isCaptured` detection; `.privacySensitive()` on balances; no autofill of the password into non-secure fields.
7. **Clipboard:** the Secret Key and Recovery Key are copied only with `UIPasteboard.setItems(…, options: [.localOnly: true, .expirationDate: now + 60 s])`.
8. **Web build:** because JS cannot reliably clear memory, hold keys as non-extractable `CryptoKey` objects where possible, run Argon2id in a WASM module with an explicit memset, keep the Secret Key out of `localStorage`, and use a strict CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'`).
9. **Logging:** a structured logger with a redaction type; amounts, names and notes MUST NOT be logged at any level. Crash reporters MUST be configured to drop breadcrumbs for the finance domain.
10. **Constant-time:** comparisons of MACs, SRP proofs and tags use constant-time functions (`subtle`).

---

## 11. Verification requirements

An implementation is conformant only if it ships with:

1. **Known-answer tests:** HKDF-SHA256 (RFC 5869 A.1–A.3), Argon2id (RFC 9106 §5.3), PBKDF2-HMAC-SHA256, AES-256-GCM (NIST SP 800-38D vectors), X25519 (RFC 7748 §6.1), Ed25519 (RFC 8032 §7.1), HPKE (RFC 9180 A.1), and an SRP-6a exchange with fixed `a`, `b` against the 4096-bit RFC 3526 group.
2. **2SKD cross-implementation vector** (to be generated once and frozen in the repo): fixed `password`, `email`, `secret_key`, `salt16`, `kdf_params` ⇒ expected `AUK` and `SRP-x`. Includes a non-ASCII password (`"Å"` as U+212B, U+00C5 and U+0041 U+030A MUST all produce the same bytes under NFKD).
3. **Money:** property tests (`proptest`/`fast-check`) for `balance(a) = opening + Σ entries`; sign invariants; FX round-trip bounds (`|convert(convert(a, X→Y), Y→X) − a| ≤ 1` minor unit at the same date for `rate_e12 ≥ 10^6`); half-even rounding on `.5` ties; overflow rejection; absence of `f32/f64/Number` in money paths (lint rule plus a CI grep gate).
4. **Recurrence:** month-end clamping vectors (31 Jan monthly ⇒ 28/29 Feb, 31 Mar), leap-year yearly (29 Feb), DST boundaries (`local_date` stable), and convergence of two devices generating the same occurrence.
5. **CRDT:** randomised convergence test. Apply the same op multiset in 1 000 random permutations with random duplication ⇒ identical resulting state and identical `repair()` output.
6. **Sync adversary tests:** server swaps blobs between records/folds, drops an op, replays a frame, reorders ops, serves a forged membership entry, serves a downgraded KDF ⇒ client rejects each with a specific error.
7. **Storage:** opening the DB with a wrong key fails; no plaintext money/name strings appear in the DB file, WAL or any temp file (`strings` scan in CI).
8. **Fuzzing:** CBOR decoder, op envelope parser, SRP message parser.

---

## 12. Open questions and verification TODOs

| # | Item | Why it matters | How to resolve |
|---|---|---|---|
| 1 | Importer for third-party CSV/backup formats: date formats, enum meanings, list encodings. | Import fidelity. | Define per-source mappers against real sample files. |
| 2 | Argon2id memory on low-end Android. | UX vs security. | Benchmark; the floor in §5.3 is the hard limit. |
| 3 | Final SRP message encoding (padding, `k`, M1 composition). | Interoperability between Cashfold clients and server. | §6.1/§6.3 are normative; freeze with test vectors (§11). |
