# Quickstart: Validating the Secure Finance Core

A run and validation guide for each milestone. It contains no implementation code. Commands assume the monorepo layout in [plan.md](plan.md) and become runnable as milestones land.

## Prerequisites

- Node.js active LTS and pnpm (versions pinned in `package.json` / `.nvmrc`).
- Docker (PostgreSQL and optional MinIO for server tests).
- Playwright browsers: `pnpm exec playwright install` (Chromium, Firefox, WebKit).
- A second browser profile (or a second browser) for multi-device checks.

## 0. Foundations (M0)

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint                      # includes dependency-boundary rules and the no-number-in-money rule
pnpm test --filter @cashfold/crypto --filter @cashfold/protocol
pnpm test:vectors              # known-answer tests for all primitives, CBOR, FX, recurrence
```

**Expected**: all vectors pass (HKDF, Argon2id, PBKDF2, AES-GCM, X25519, Ed25519, HPKE, SRP, deterministic CBOR, FX, recurrence). Lint reports no `number`/floating point in money code and no boundary violations.

## 1. Private ledger offline (M1, stories 1–3)

**Offline reload (E1)**: load the app once, set the network to offline, reload the page and reopen the browser; the app opens and works (`pnpm e2e --grep "@offline-reload"`).

```text
pnpm --filter web build && pnpm --filter web start:static   # serves the static export
pnpm e2e --grep "@p1"                                        # Playwright, offline mode on
```

1. Open the app in a browser, switch the network to offline.
2. Create an account. Confirm the Secret Key is shown once and the Emergency Kit can be saved.
3. Lock, then unlock with the password. Confirm no data is visible while locked.
4. Create a USD checking account (opening 1,000.00) and a EUR cash account (opening 0.00).
5. Add ten expenses/incomes; edit and delete a few; restore one from "Recently deleted".
6. Transfer 100.00 USD → 91.37 EUR. Confirm USD −100.00, EUR +91.37, and that editing or deleting the transfer changes both sides.
7. Enter an amount with too many decimals; confirm it is rejected, not rounded.

**Expected**: balances equal opening + Σ posted entries to the minor unit (SC-003). `pnpm test --filter @cashfold/core -- property` runs 10,000 random sequences with zero discrepancy, including values above 2^53.

**Privacy check**:
```text
pnpm e2e --grep "@leak-scan"
```
**Expected**: zero hits for seeded names, notes or amounts in OPFS files, IndexedDB, console output, and captured network traffic (SC-002, SC-015).

## 2. Sync and second device (M2, story 4)

1. Start the relay and database: `docker compose -f deploy/compose.dev.yml up` (server + PostgreSQL).
2. Sign in on browser A; add data.
3. In browser B, open the add-device link (fragment form) or enter email, password and Secret Key. Confirm all data appears and still works offline afterwards.
4. Put both offline. On A edit the *amount* of transaction T; on B edit its *note*. Reconnect both. Confirm both edits survive. Then edit the same field on both; confirm identical results on both.
5. Revoke browser B from A; confirm B can no longer sync and wipes its data on contact.
6. Start a second relay (`deploy/example.config.yml`) on another port; sign in against it by entering its address; repeat the checks (FR-099).
7. Migrate the account to the second relay; confirm data and Secret Key are unchanged and the old relay's copy is deleted (FR-100).
8. Fetch rates: confirm the app contacts only its own service (network log shows no third-party hosts), the table is identical for two accounts, and with publication disabled custom rates still work (FR-103).

**Automated**:
```text
pnpm test --filter @cashfold/core -- convergence    # 1,000 randomised multi-replica trials (SC-004)
pnpm test --filter @cashfold/core -- hostile        # hostile-server suite (SC-006)
pnpm test --filter server                           # Testcontainers: PostgreSQL integration and contract tests
```
**Expected**: identical state on all replicas in every trial; every tampering case is rejected with its specific error and no data changes. Cross-implementation SRP vectors agree between client WASM, server OpenSSL path and the reference.

## 3. Budgets (M3, story 5)

1. Create a monthly Groceries budget: allocation 300.00, rollover *carry positive*.
2. Spend 120.00 in the first month; advance the clock (test control) to month two.
3. **Expected**: available shows 480.00 before any spending. Switch rollover to *none*; expected 300.00. Switch to *carry all* after overspending in month one; expected deficit reduces month two.
4. Edit an old transaction; expected: all later periods recompute identically on both browsers.

**Automated**: `pnpm test --filter @cashfold/core -- budgeting`, including projection and velocity rounding cases.

## 4. Schedules and goals (M4, stories 6, 8)

1. Create a monthly schedule starting 31 Jan. Expected occurrences: 28/29 Feb, 31 Mar, 30 Apr, 31 May.
2. With three simulated replicas offline across a due date, reconnect in random order. Expected: exactly one transaction per occurrence (SC-012).
3. Create a goal of 6,000.00 due in 12 months; transfer 1,000.00 into its account. Expected: remaining 5,000.00, required monthly = ceil(5,000.00 / months_left) at minor-unit precision.

## 5. Sharing (M5, story 7)

0. Email verification: register with a verifying (or log-only) mail adapter; confirm sharing features are blocked until the one-time link is used.
1. Invite a second user as *viewer* by email lookup; compare the fingerprint on both screens. Confirm the notification email contains only the sender's name. Repeat with a non-discoverable invitee using an invitation code; confirm lookup of their address returns `404` identical to an unknown address, and that lookups are rate-limited.
2. Viewer attempts to edit; expected: blocked locally, and a forged op injected by the harness is rejected by other clients.
3. Invite a third user with scope *from the join date onward*; confirm the invitation shows the scope, that they see no earlier transactions, and that balances and budget carry-ins still match the full-history balances (checkpoints). Invite a fourth with *full history* and confirm they see everything (FR-102).
4. Promote to *editor*, make edits, then remove the member. Create new data. Expected: removed member cannot read data created after removal (SC-009), their client deletes the local copy at next contact, and the owner sees the "already seen data cannot be recalled" notice (FR-104). A voluntary leaver is offered an export first.

## 6. Recovery and portability (M6, story 9)

1. Sign in in a fresh browser profile using only the Emergency Kit and password. Expected: full data returns.
2. Enable a Recovery Key; sign in using it with a new password.
3. Export an encrypted backup, clear site data, restore. Expected: data identical (SC-013).
4. Import a 5,000-row CSV; preview within 5 s; commit; undo. Expected: only imported records removed (SC-014).

## 6b. Account deletion (M6, FR-101)

1. As an owner of a Fold with another member, attempt to delete the account. Expected: blocked with the list of shared Folds.
2. Transfer ownership of the shared Fold, delete the account. Expected: private Folds removed on the server, membership removed from the shared Fold, tombstone recorded.
3. From a second browser of that account, sync. Expected: `410 Gone` and a complete local wipe.

## 7. Performance, accessibility and delivery (M7)

```text
pnpm bench:web -- dashboard-50k       # headless-browser benchmark with 50,000 transactions
pnpm e2e --grep "@a11y"               # axe checks and keyboard-only flows
pnpm build:verify                     # reproducible-build check, SBOM and hash publication
```
**Expected**: dashboard ready ≤ 2 s and add-transaction ≤ 200 ms at 50,000 transactions on the reference mid-range device (SC-008). All primary tasks pass keyboard-only and screen-reader checks (SC-016). Two clean builds produce identical hashes. The CSP and header checklist in ARCH §10 passes against the served export.

## Exit criteria per milestone

A milestone is done when its spec acceptance scenarios pass, its automated suites are green in CI, and the relevant success criteria (named above) are demonstrated.
