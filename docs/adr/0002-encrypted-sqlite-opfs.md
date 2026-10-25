# ADR-0002: Encrypted SQLite on OPFS via SQLite3 Multiple Ciphers

- **Status**: accepted
- **Date**: 2026-10-18

## Context

The device database must be encrypted at rest (FR-016), queryable with SQL at 50,000 transactions (SC-008), keep money as exact 64-bit integers (FR-037), and run offline in a browser. ARCHITECTURE.md 8.1 allows two routes, in order of preference: (1) a SQLite WASM build with a built-in authenticated cipher; (2) a custom VFS that encrypts each page with AES-256-GCM. The route had to be settled by a spike with measurements, not by preference.

## Decision

Use **SQLite3 Multiple Ciphers 2.3.5 (SQLite 3.53.2), upstream WASM build**, over the OPFS **SyncAccessHandle pool** VFS (no COOP/COEP headers needed), with the **`chacha20` scheme** (ChaCha20-Poly1305, per-page authentication). The 32-byte database key `DBK` is handed over with `sqlite3_key_v2` through the WASM heap, and that copy is zeroed immediately.

- Encryption is enabled by wrapping the pool VFS with `sqlite3mc_vfs_create`; databases are opened with the wrapped VFS name. Without the wrapper SQLite refuses to key the database ("Encryption is not supported by the VFS").
- Code: `apps/web/src/adapters/sqlite-opfs/` (`runtime.ts`, `database.ts`, `migrate.ts`, `migrations/`). Tests run in headless Chromium through Vitest browser mode (`pnpm --filter @cashfold/web test:browser`).
- Pragmas on open: `foreign_keys=ON`, `secure_delete=ON`, `temp_store=MEMORY`, `journal_mode=DELETE`.
- All INTEGER values are read as `bigint` (via `sqlite3_column_int64`); parameters accept `bigint` or safe-integer `number` only; floats are rejected. Tables are `STRICT`.

## Evidence

Measured in headless Chromium on Apple silicon (not a phone; re-measure on target devices in M7):

| Check                                                                                             | Result                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Plaintext in the database file, its rollback journal, or any pool file, including mid-transaction | none; no `SQLite format 3` header                                        |
| Wrong key                                                                                         | `SQLITE_NOTADB` on first read (`DatabaseKeyError`)                       |
| One flipped bit in a data page                                                                    | `SQLITE_CORRUPT`                                                         |
| A page copied over another page (relocation)                                                      | `SQLITE_CORRUPT`                                                         |
| Values above 2^53 (2^62+1, i64 min/max)                                                           | exact round trip; `SUM` exact; `SUM` overflow raises instead of wrapping |
| Rollback of earlier page images                                                                   | **not detected** (see Risks)                                             |

Benchmark, 50,000 rows with two indexes, single-transaction load, page size 4096:

| Cipher           | Load   | Month aggregate | Balance | 50-row page | One-row commit | Reopen |
| ---------------- | ------ | --------------- | ------- | ----------- | -------------- | ------ |
| none             | 270 ms | 3.1 ms          | 1.6 ms  | 0.3 ms      | 2.9 ms         | 15 ms  |
| chacha20         | 277 ms | 3.1 ms          | 1.7 ms  | 0.4 ms      | 2.9 ms         | 32 ms  |
| aes256cbc (HMAC) | 289 ms | 3.1 ms          | 1.7 ms  | 0.4 ms      | 3.1 ms         | 19 ms  |
| aegis            | 286 ms | 3.1 ms          | 1.7 ms  | 0.4 ms      | 3.0 ms         | 31 ms  |

Encryption overhead is negligible next to the budgets (dashboard in 2 s, add-transaction in 200 ms), so the cipher was chosen on properties, not speed. `chacha20` is the upstream default, an AEAD, and avoids a CBC construction. `journal_mode` TRUNCATE gave no measurable gain over DELETE.

## Alternatives rejected

- **Custom per-page AES-256-GCM VFS.** Would use only WebCrypto primitives and could keep a per-file write counter, but it is hundreds of lines of security-critical VFS code with no measured benefit over the evidence above. Whole-file rollback stays undetectable either way without an external anchor.
- **IndexedDB with application-level encryption.** No SQL aggregation; every query hand-written.
- **Plain OPFS SQLite.** Plaintext at rest.

## Supply chain

The upstream release asset `sqlite3mc-2.3.5-sqlite-3.53.2-wasm.zip` (sha256 `3d0d5ebe…0670`) was downloaded and its `jswasm/` files hashed. The npm package `@aztec/sqlite3mc-wasm@5.2.1` repackages those files **byte for byte** and gives a bundler-friendly loader. It is pinned exactly, and `scripts/verify-sqlite3mc.mjs` (CI: `pnpm check:sqlite3mc`) fails if the installed bytes differ from `apps/web/vendor/sqlite3mc.sha256`. The WASM itself is built by the upstream author; this repository does not rebuild it.

## Risks and follow-ups

1. **No rollback protection.** An attacker who can write to the origin's OPFS directory can restore older, internally consistent page images (or the whole file) and the database opens normally; `PRAGMA integrity_check` reports ok. The cipher detects modified and relocated pages only. OPFS is origin-private, so this requires local compromise of the browser profile; the op log is signed, and the relay's per-device `seq` check catches replayed local sequence numbers. Recorded in `docs/threat-model.md`.
2. **Not formally audited.** Constitution VIII asks for audited libraries for cryptography. SQLite3 Multiple Ciphers is widely used and maintained, but no formal audit is known to me (**VERIFY** before release). If that is unacceptable, the custom-VFS route is the fallback; the `EncryptedDatabase` interface isolates the choice.
3. **Key derivation.** The library runs a PBKDF2 pass over the supplied key. `DBK` already has 256 bits of entropy so this adds cost (about 15 ms at open) but no security; the iteration count is left at the library default.
4. **Schema additions to ARCH 8.2.** Merge state is persisted generically so merge never depends on the domain tables: `record_meta`, `field_clock` (plus `op_id` and the CBOR `value`), `set_add`, `set_removed`; `sync_quarantine` keeps the full sealed op; every table with a `fold_id` references `fold` with `ON DELETE CASCADE`, so removing a Fold wipes its data in one statement. `checkpoint` is added for `from_join` invitations.
5. **Pool capacity.** The SAH pool holds a fixed number of slots; `initialCapacity` is 6 (database, journal, headroom). Opening more files needs `reserveMinimumCapacity`.
