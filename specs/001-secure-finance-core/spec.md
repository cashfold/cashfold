# Feature Specification: Secure Finance Core

**Feature Branch**: `001-secure-finance-core`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "use this architecture doc docs/ARCHITECTURE.md to create as detailed specification as possible"

**Reference**: `docs/ARCHITECTURE.md` holds the technical blueprint (cryptography, schemas, sync format). This document states *what* users and the system must do. The blueprint states *how*, and is consumed by `/speckit-plan`.

## Overview

Cashfold is a personal and shared finance manager that works fully offline, keeps every user's financial data private even from the service that stores it, and keeps the same data in sync across the user's devices and with people they choose to share it with. Users track accounts, record income and expenses, move money between accounts and currencies, plan with budgets, schedule recurring items, and work toward savings goals. All amounts are exact: no rounding drift appears in any balance, total, or report.

The central organising concept is the **Fold**: an isolated budget context (for example *Personal*, *Family*, *Business*). Each Fold has its own data, its own members, and its own protection. Nothing is shared between Folds unless the user copies it.

## Clarifications

### Session 2026-10-18

- Q: Who runs the sync service? → A: Both. The server is open source and anyone can self-host it, and a hosted instance is also operated for users who prefer it.
- Q: What happens to shared Folds when an owner deletes their account? → A: The user must first transfer ownership of each shared Fold or delete it. Then the account and all private Folds are deleted.
- Q: Should new members of a shared Fold see history from before they joined? → A: The owner chooses per invitation, full history or from the join date onward, and the invitee is shown which before accepting.
- Q: Where do exchange rates come from? → A: The Cashfold server fetches one public rate table and serves it to all apps; the source is configurable per server. The app never contacts a third-party rate source.
- Q: What happens to a removed or departing member's local copy of the Fold? → A: The app deletes it the next time it contacts the service. A member who leaves voluntarily is offered an export first.
- Analysis remediation (2026-10-18, accepted by the project owner): invitation lookup by email is limited to verified, signed-in users, rate-limited, controlled by a per-account discoverability setting with a shareable-code fallback; web-only guarantees are stated precisely (no app-switcher promise in a browser); deleted records are purged after 30 days; offline reload is required.
- Constitution v1.0.1 (2026-10-18): Principle VII now says every *local* function of a P1/P2 feature works offline; operations that inherently contact the service queue or fail gracefully.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a private account and a first Fold (Priority: P1)

A new user installs the app, creates an account with an email address and a password, receives a generated Secret Key, saves an Emergency Kit, and lands in an empty personal Fold ready to add accounts.

**Why this priority**: Without a protected identity and a Fold there is nowhere to put data. This is the foundation of every other story and the first proof of the privacy promise.

**Independent Test**: On a clean device, complete sign-up, save the Emergency Kit, lock the app, and unlock it again with the password. The user reaches an empty Fold both times, and no financial data or credential has been sent to the service in readable form.

**Acceptance Scenarios**:

1. **Given** a new install, **When** the user completes sign-up with an email and a strong password, **Then** a Secret Key is generated on the device and shown once, an Emergency Kit can be saved or printed, and a default *Personal* Fold exists.
2. **Given** the sign-up screen, **When** the user chooses a weak or very short password, **Then** the app explains why it is rejected and does not create the account.
3. **Given** a created account, **When** the user skips saving the Emergency Kit, **Then** the app clearly warns that lost credentials cannot be recovered by anyone, and reminds the user until it is saved or explicitly dismissed.
4. **Given** an unlocked app, **When** the user locks it (manually, by timeout, or by sending it to the background), **Then** all financial data is hidden and unreadable until the user unlocks again.
5. **Given** a device with biometric support, **When** the user enables quick unlock, **Then** subsequent unlocks can use biometrics, and the password is still required after a restart or after biometrics fail.

---

### User Story 2 - Track accounts, categories and transactions offline (Priority: P1)

The user creates accounts of different kinds (checking, savings, credit card, cash, goal, loan), sets opening balances, organises spending with a two-level category tree, tags, payees, and records income and expenses with dates, notes and optional location and attachments (attachments are delivered with Story 9). Balances and lists update instantly with no connectivity.

**Why this priority**: This is the product's core value and works standalone with no network, no sharing and no budgets.

**Independent Test**: In airplane mode, create two accounts, record ten transactions across categories, edit and delete some, and confirm balances equal opening balance plus the sum of posted transactions to the smallest currency unit.

**Acceptance Scenarios**:

1. **Given** a Fold, **When** the user creates an account with a name, kind, currency and opening balance, **Then** the account appears with that balance.
2. **Given** an account, **When** the user records an expense of 19.99, **Then** the balance decreases by exactly 19.99 and the transaction appears under its date.
3. **Given** a transaction, **When** the user changes its amount, category, date, or note, **Then** balances and reports reflect the change immediately and the previous value is not double-counted.
4. **Given** a transaction, **When** the user deletes it, **Then** it disappears from lists and totals, and can be restored for a limited time (see FR-052).
5. **Given** the category list, **When** the user creates a child category under a root category, **Then** it is available when recording transactions. **When** the user tries to nest a third level, **Then** it is rejected with an explanation.
6. **Given** a transaction in progress, **When** the user types an amount with more decimal places than the currency allows, **Then** the app prevents or rejects the entry and never silently rounds it.
7. **Given** an account, **When** the user archives it, **Then** it is hidden from default lists, excluded from new-entry pickers, keeps its history, and can be un-archived.
8. **Given** the app has been loaded once, **When** the browser goes offline and the page is reloaded or reopened, **Then** the app opens and all offline functions still work.
9. **Given** a tracking-only account, **When** the user excludes it from net worth, **Then** it never contributes to net-worth totals but still shows its own balance.
10. **Given** a mismatch between the displayed and actual real-world balance, **When** the user enters the correct balance, **Then** a balance-adjustment entry is created for the exact difference and is clearly marked as an adjustment.

---

### User Story 3 - Move money between accounts and currencies (Priority: P1)

The user transfers money between two of their accounts. For accounts in different currencies, the user supplies or confirms both amounts, so each account receives exactly what the user states.

**Why this priority**: Transfers are essential for accurate balances, and cross-currency transfers are where most finance apps lose precision or consistency.

**Independent Test**: Create a USD and a EUR account, transfer 100.00 USD into 91.37 EUR, and confirm the USD account drops by exactly 100.00, the EUR account rises by exactly 91.37, and the two sides never exist separately (editing or deleting one affects the whole transfer).

**Acceptance Scenarios**:

1. **Given** two accounts in the same currency, **When** the user transfers 50.00, **Then** one account decreases by 50.00 and the other increases by 50.00, as a single operation.
2. **Given** accounts in different currencies, **When** the user records a transfer, **Then** both amounts are explicit and neither is silently recomputed later.
3. **Given** a transfer, **When** the user edits or deletes it, **Then** both sides change together; it is impossible to have only one side.
4. **Given** a transfer, **When** reports are viewed with default settings, **Then** the transfer is not counted as income or expense. **When** the user enables "transfers as income and expenses", **Then** it is included.
5. **Given** the same account chosen as source and destination, **Then** the app rejects the transfer.
6. **Given** a goal account, **When** the user moves money into it, **Then** goal progress updates.

---

### User Story 4 - Keep data in sync across my devices (Priority: P2)

The user signs in on a second device by entering their password and Secret Key (scan or paste). After the first sync, both devices show the same data, edits made offline on either device merge automatically when they reconnect, and the storing service can never read any of it.

**Why this priority**: Multi-device use is the main reason to have an account at all, and it is the first place the privacy promise is tested against real-world conflicts.

**Independent Test**: With two devices signed in, make different edits offline on each (including editing the same transaction's different fields), reconnect both, and confirm both devices show an identical merged result with no data loss and no error.

**Acceptance Scenarios**:

1. **Given** a signed-in device, **When** the user adds a new device using the Secret Key and password, **Then** the new device receives all Folds the user belongs to and can work offline afterwards.
2. **Given** two devices online, **When** the user adds a transaction on one, **Then** it appears on the other within 5 seconds on the reference connection defined in SC-005.
3. **Given** both devices offline, **When** each edits a *different* field of the same record, **Then** after reconnecting both edits are kept.
4. **Given** both devices offline, **When** each edits the *same* field, **Then** after reconnecting both devices converge on the same value, the one made later, and the user can see that a conflict was resolved.
5. **Given** an interrupted sync, **When** the connection returns, **Then** sync resumes without duplicates or lost edits.
6. **Given** a tampered or replayed update from the service, **When** a device receives it, **Then** the update is rejected, the data is untouched, and the user can see a non-technical notice that something was rejected.
7. **Given** a device lost or stolen, **When** the user removes it from their account, **Then** it can no longer sync, and the user is told what that does and does not protect.
8. **Given** the account password or Secret Key is changed, **Then** all Folds remain accessible to the user and other devices are asked to sign in again.

---

### User Story 5 - Plan with envelope budgets (Priority: P2)

The user creates budgets (envelopes) for categories, accounts, or tags, sets a limit or funded amount per period, chooses whether unspent or overspent money rolls over, and sees how much is available, how fast it is being spent, and whether they are on track to overspend.

**Why this priority**: Budgeting is the main planning feature; it depends on Stories 2 and 3 but is independently valuable once they exist.

**Independent Test**: Create a monthly 300.00 budget with rollover for Groceries, spend 120.00 in month one, then in month two verify the budget shows 480.00 available before any spending, with the figures matching the transactions exactly.

**Acceptance Scenarios**:

1. **Given** a budget with a period and an amount, **When** matching expenses are recorded, **Then** "spent", "available" and "limit" update and are all displayed in the budget's currency.
2. **Given** rollover is *off*, **When** a new period starts, **Then** the available amount resets to the period's allocation.
3. **Given** rollover is *carry unspent only*, **When** a period ends with money left, **Then** it is added to the next period. **When** the period ended overspent, **Then** the deficit is not carried.
4. **Given** rollover is *carry everything*, **When** a period ends overspent, **Then** the deficit reduces the next period's available amount.
5. **Given** the current period is partly elapsed, **When** the user views the budget, **Then** it shows the average daily spending, the projected end-of-period spending, and a clear warning if projected spending exceeds what is available.
6. **Given** a refund is recorded in a budgeted category, **Then** it reduces spent for that period.
7. **Given** a budget scoped to an account group, a set of categories or tags, **Then** only matching transactions count; transfers count only when the budget is configured to include them.
8. **Given** an old transaction is edited or deleted, **Then** every affected period's figures and every rollover that depends on it are recalculated consistently on all devices.
9. **Given** a budget in a currency different from a transaction's, **Then** the transaction is converted using the rule in FR-040 and the result is exact.
10. **Given** the user chooses an income budget, **Then** it tracks received amounts against a target and does not show overspend warnings.

---

### User Story 6 - Automate recurring transactions (Priority: P3)

The user sets up recurring income, expenses and transfers (daily, weekly, monthly, yearly, with an interval), optionally requiring confirmation, optional reminders, and sees upcoming items included in projected balances.

**Why this priority**: It saves repeated manual entry, and it is the main source of duplicate-data risk when several devices are in use.

**Independent Test**: Create a monthly schedule starting on the 31st; verify occurrences land on the last valid day of shorter months without drifting, that two devices create exactly one transaction per occurrence, and that finishing the schedule stops new occurrences while keeping past ones.

**Acceptance Scenarios**:

1. **Given** a monthly schedule starting 31 January, **When** occurrences are generated, **Then** they fall on 28/29 February, 31 March, 30 April, and so on, never drifting to earlier days.
2. **Given** a schedule that requires confirmation, **When** an occurrence is due, **Then** it appears as pending, is excluded from posted balances, and posts only when the user confirms.
3. **Given** a schedule without confirmation, **When** an occurrence date arrives, **Then** it posts automatically.
4. **Given** several devices that were offline across a due date, **When** they sync, **Then** each occurrence exists exactly once.
5. **Given** "include scheduled" is on, **When** the user views balances, **Then** projected balances include future occurrences up to the chosen date.
6. **Given** a reminder offset is set, **When** the time arrives, **Then** the user is notified without revealing amounts on the lock screen unless the user allows it.
7. **Given** the user edits a schedule, **Then** only future, not-yet-created occurrences change; past transactions are untouched.
8. **Given** the user finishes a schedule, **Then** it moves to a completed list and creates no more occurrences.
9. **Given** a leap-day yearly schedule, **Then** non-leap years use 28 February.

---

### User Story 7 - Share a Fold with family or colleagues (Priority: P3)

The owner of a Fold invites another Cashfold user as an editor or viewer. The invitee verifies the owner's identity with a short fingerprint comparison, accepts, and sees the shared Fold. The owner can later change the role or remove them.

**Why this priority**: It unlocks household and small-business use, but depends on everything above and has the highest security risk.

**Independent Test**: Share a Fold with a second user as viewer, confirm they can read but not change data; promote to editor and confirm edits sync both ways; remove them and confirm they cannot read anything created afterwards.

**Acceptance Scenarios**:

1. **Given** an owner and an existing Cashfold user, **When** the owner invites them, **Then** both see a matching security fingerprint they can compare out-of-band before the invitation is accepted.
2. **Given** a viewer, **When** they try to add or change data, **Then** the app prevents it, and edits forged on their behalf are rejected by other members' devices.
3. **Given** an editor, **When** they make changes, **Then** all members see them under normal sync.
4. **Given** a removed member, **When** new data is created after removal, **Then** they cannot read it, and the owner is told that data the member already saw cannot be retracted.
5. **Given** an owner, **Then** they can see who has access, with what role, since when, and on which devices.
6. **Given** a member, **When** they leave a Fold, **Then** the Fold continues for the others, the leaver is offered an export, and their app deletes the local copy of the Fold.
7. **Given** the service tries to substitute another person's identity during an invitation, **Then** the fingerprint comparison reveals the mismatch.
8. **Given** one of the user's Folds is shared, **Then** their other Folds remain completely private.
9. **Given** an invitation with scope *from the join date onward*, **When** the invitee joins, **Then** they see only data created after joining, and the invitation screen stated this beforehand.
10. **Given** an invitee who is not discoverable by email, **When** they give the owner a shareable invitation code, **Then** the owner can invite them, and a lookup of their address still returns "not found".
11. **Given** an invitation with scope *full history*, **When** the invitee joins, **Then** they see all existing data and the existing members were informed.

---

### User Story 8 - Reach savings goals (Priority: P3)

The user creates a goal with a target amount and date, linked to a dedicated goal account, and sees progress, remaining amount, how much per month is needed, and whether it is achieved or overdue.

**Why this priority**: A motivating but non-essential layer over accounts and transfers.

**Independent Test**: Create a goal of 6,000.00 due in 12 months, transfer 1,000.00 into its goal account, and confirm progress, remaining and required monthly amount match exactly.

**Acceptance Scenarios**:

1. **Given** a goal and its account, **When** money is transferred in, **Then** saved, remaining and percentage update.
2. **Given** saved ≥ target, **Then** the goal is marked achieved.
3. **Given** the target date passed and the goal isn't achieved, **Then** it is marked overdue.
4. **Given** remaining money and months left, **Then** the required monthly saving is the remaining amount divided by remaining months, rounded up to the smallest currency unit.
5. **Given** a goal account, **Then** it accepts only transfers and balance adjustments, not ordinary spending.

---

### User Story 9 - Recover access and move my data (Priority: P3)

The user can recover access with the Emergency Kit plus their password, optionally set up a Recovery Key, change their password, rotate their Secret Key, export an encrypted backup, export readable files, and import transactions from a CSV file.

**Why this priority**: The privacy design means nobody can reset access for the user, so recovery and portability have to be excellent. They are not needed on day one, but they are needed before the app is trusted with real data.

**Independent Test**: On a new device, sign in with the Emergency Kit and password. Separately, export an encrypted backup, wipe the app, restore, and confirm all data matches. Import a CSV, undo the import, and confirm nothing from it remains.

**Acceptance Scenarios**:

1. **Given** a lost device, **When** the user signs in on a new device with the password and Secret Key from the Emergency Kit, **Then** all data returns.
2. **Given** both the password and the Secret Key are lost and no recovery option was set up, **Then** the app states clearly that data cannot be recovered by anyone, including the service operator.
3. **Given** the user enables a Recovery Key, **Then** it is shown once, can be saved offline, and can later restore access without the Secret Key.
4. **Given** the user changes their password, **Then** all data stays accessible, other devices must sign in again, and the old password stops working.
5. **Given** an encrypted export, **When** restored on a fresh install with the right credentials, **Then** the data equals the original exactly.
6. **Given** a readable (CSV) export, **Then** the app requires a fresh identity check and warns that the file is not protected.
7. **Given** a CSV import, **When** the user maps columns (date/time, currency, amount or separate income/expense columns, transaction type), **Then** a preview is shown before anything is saved, duplicates are detected, and the entire import can be undone as one batch.
8. **Given** an import with an invalid row, **Then** that row is reported with a reason and the others still import.

---

### Edge Cases

- **Money limits and precision:** amounts larger than the supported range, more decimals than the currency permits, zero amounts, negative inputs in the wrong direction, currencies with zero or more than two decimals (e.g. zero-decimal currencies, three-decimal currencies, crypto assets). All must be handled without rounding errors or overflow, and out-of-range results must be rejected, never wrapped or truncated.
- **Rounding:** wherever rounding is unavoidable (currency conversion, budget velocity, goal monthly amount), the same documented rule is used everywhere and gives the same result on all devices.
- **Time:** travelling across time zones, daylight-saving transitions, devices with wrong clocks (very fast or very slow), transactions entered for dates far in the past or future.
- **Concurrent edits:** two devices edit, delete, or restore the same record; one deletes an account while another adds a transaction to it; two devices create the same scheduled occurrence; two members re-parent the same category.
- **Orphans and invalid combinations after merging:** a transaction pointing to a deleted account or category, a category nested too deep, a transaction whose currency no longer matches its account. These must never crash the app, never silently change money, and are surfaced for the user to fix.
- **Sync and server:** the service is unreachable for days; it returns data in the wrong order, drops items, replays old items, serves a modified key or membership list, or lowers the password-strengthening settings. The app detects and refuses, and keeps working offline.
- **Account safety:** repeated wrong passwords, sign-in attempts for unknown emails (must not reveal whether an account exists), session expiry in the middle of a sync, a second device being enrolled by someone who has the password but not the Secret Key.
- **Device and storage:** app killed mid-write, disk full, database corrupted, an operating-system backup restored onto a different device, screenshot or screen recording while sensitive data is showing (cannot be prevented in a browser and is disclosed to the user), content hidden when the window loses focus or is switched away from.
- **Large data:** thousands of transactions per account, many Folds, long attachment lists. Lists and balances remain responsive.
- **Invitation lookup:** repeated lookups to discover which emails have accounts, lookups by unverified accounts, a non-discoverable invitee, an invitation to an address that later registers.
- **Account deletion:** attempting to delete an account that owns a shared Fold, or that is mid-sync, or that is signed in on several devices; devices of a deleted account must discard local data on next contact.
- **Sharing:** inviting someone who has no account, inviting oneself, inviting the same person twice, removing the only owner, an editor trying to promote themselves, a removed member's device that is offline for a long time and syncs later.
- **Localisation:** right-to-left languages, number and date formats, characters that look alike in passwords, passwords entered on different keyboards or Unicode forms.

## Requirements *(mandatory)*

### Functional Requirements

*Requirement IDs are stable identifiers, grouped by topic. They are not a gap-free sequence: FR-099 to FR-107 were added after FR-098 and sit with their topic. Do not renumber.*

**Identity, secrets and unlocking**

- **FR-001**: Users MUST be able to create an account with an email address and a password. The app MUST reject passwords that are too short or common, with an explanation.
- **FR-002**: The system MUST generate a high-entropy Secret Key on the user's device at sign-up. The Secret Key MUST never be transmitted to the service.
- **FR-003**: The app MUST present the Secret Key and account details as a saveable and printable Emergency Kit, and MUST warn that lost credentials cannot be recovered by anyone if no recovery option exists.
- **FR-004**: The password and Secret Key MUST both be required to sign in on a new device. Knowing one alone MUST NOT grant access to data, nor allow offline guessing of the other.
- **FR-005**: Equivalent passwords typed with different but visually identical Unicode encodings and with accidental leading or trailing spaces MUST be treated as the same password.
- **FR-006**: The app MUST support quick unlock with device biometrics, and MUST require the full password again after restart, after repeated biometric failure, and after a configurable inactivity period.
- **FR-007**: The app MUST lock automatically on inactivity timeout, when sent to the background, on device lock, and on explicit user request. A locked app MUST show no financial data. Whenever the page or window is hidden, loses focus or is being switched away from, the app MUST immediately hide financial content (where the platform exposes such an event), and on platforms that provide an app-switcher preview it MUST NOT disclose financial data there. Screenshots and screen recordings cannot be prevented in a web browser; the product MUST say so plainly.
  - _Amended for the desktop app by spec 006: focus loss no longer hides by default; see ADR-0012._
- **FR-008**: Users MUST be able to change their password and rotate their Secret Key. Other devices MUST be required to sign in again, and all Folds MUST remain accessible.
- **FR-009**: Users MUST be able to set up an optional Recovery Key, shown exactly once, that can restore access without the Secret Key.
- **FR-010**: Users MUST be able to view, rename, and remove their enrolled devices; a removed device MUST lose the ability to sync.

**Privacy guarantees (verifiable behaviours)**

- **FR-011**: The service MUST NOT be able to read amounts, names, notes, dates, categories, payees, tags, places, attachments or any other financial content, nor the user's password, Secret Key, or any key able to decrypt them.
- **FR-012**: Everything stored on the service MUST be either protected user content or minimal routing information (identifiers, counts, sizes, time of activity, membership). The product documentation MUST list exactly which routing information the service can see.
- **FR-013**: The sign-in process MUST NOT reveal the password to the service. A stolen copy of the service's data MUST NOT enable offline guessing of any user's password.
- **FR-014**: Sign-in failures MUST be rate-limited. The response to an unknown email MUST be indistinguishable from the response to a known one.
- **FR-015**: Communication between app and service MUST be protected against eavesdropping, tampering, and replay, even if the underlying transport protection is compromised.
- **FR-016**: Data stored on a device MUST be encrypted at rest, MUST NOT be placed in locations that an operating system backs up without the user's encryption where the platform lets the app choose, and MUST NOT appear in logs, crash reports, analytics, clipboard, or notifications unless the user explicitly allows it.
- **FR-017**: Sensitive secrets MUST be kept in memory only as long as needed, and MUST be cleared when the app locks.
- **FR-018**: A tampered, swapped, replayed, reordered or forged item from the service MUST be detected and rejected without corrupting existing data.
- **FR-019**: The app MUST refuse any server-supplied security setting weaker than the app's minimum.
- **FR-099**: The sync service MUST be open source and deployable by a technically capable user from published instructions. The app MUST let the user choose the service address at sign-up and sign-in, with the hosted instance as the default (the default address is a build-time setting, so a self-hosted build can ship with its own address), and MUST NOT depend on any address that cannot be changed.
- **FR-100**: A user MUST be able to move an account and its Folds from one service to another (hosted to self-hosted or the reverse) without losing data or changing the Secret Key, and the old service MUST be able to be told to delete its copy.

**Folds**

- **FR-020**: Every user MUST have at least one Fold; users MUST be able to create, rename, and delete additional Folds.
- **FR-021**: Each Fold MUST be fully isolated: its data, members and protection MUST NOT overlap with any other Fold's.
- **FR-022**: Deleting a Fold MUST require explicit confirmation and MUST state the consequence for all its members.

**Accounts**

- **FR-023**: Users MUST be able to create accounts of the kinds: checking, savings, credit card, cash, goal, loan.
- **FR-024**: Each account MUST have a name, a single currency, an opening balance, an opening date, an icon, a colour, and a sort position, and MAY have a credit limit (credit card and loan only).
- **FR-025**: Users MUST be able to archive and un-archive accounts, and to exclude an account from net worth.
- **FR-026**: Users MUST be able to group accounts and order them manually.
- **FR-027**: Deleting an account MUST also remove its transactions and any transfers that involve it, after an explicit warning that states what will be removed.
- **FR-028**: An account's balance MUST always equal its opening balance plus the sum of all its posted entries up to the chosen date. It MUST NOT be a separately edited number.
- **FR-029**: A goal account MUST accept only transfers and balance adjustments.

**Transactions**

- **FR-030**: Users MUST be able to record income and expenses with: amount, date and time with time zone, category, payee, up to eight tags, note, optional place, optional attachments (available once Story 9 is delivered), refund flag, pin flag, and status (pending, posted, void).
- **FR-031**: Expense amounts MUST reduce an account and income MUST increase it. The app MUST reject entries with a sign that contradicts their type.
- **FR-032**: A transaction's currency MUST equal its account's currency.
- **FR-033**: Pending transactions MUST be excluded from posted balances and included only in projections.
- **FR-034**: Users MUST be able to add a balance adjustment that creates an exact-difference entry marked as an adjustment. Adjustments MUST be excluded from income and expense reports unless the user enables "adjustments as income and expenses".
- **FR-035**: Reports MUST group transactions by the local calendar date at the time of entry, regardless of the device's current time zone.
- **FR-036**: Users MUST be able to search, filter and sort transactions by account, category, payee, tag, amount range, date range, status, and text (the search MUST work entirely on the device).

**Money and currency**

- **FR-037**: Every monetary value in storage, synchronisation, calculation, display, and export MUST be exact, with no loss of precision. Floating-point arithmetic MUST NOT be used for any money value.
- **FR-038**: The app MUST support the full set of standard currencies including zero- and three-decimal currencies, and at least one crypto asset with eight decimals. Amounts beyond the supported range MUST be rejected.
- **FR-039**: Users MUST be able to use multiple currencies in one Fold, and to pick one *base currency* per Fold for totals.
- **FR-040**: Currency conversion MUST be performed with a single, deterministic rounding rule (round half to even, applied once at the end) so every device computes identical results.
- **FR-041**: Each transaction MUST store its base-currency equivalent and the exchange rate used, frozen at entry time, so historic totals do not change when rates change. Users MUST be able to explicitly "revalue" historic entries.
- **FR-042**: Users MUST be able to refresh exchange rates on demand. Rates MUST be stored with their effective time, MUST keep working offline from the last known values, and users MUST be able to enter custom rates. Where rates come from is defined in FR-103.
- **FR-103**: The source of exchange rates (see FR-042 for refresh and storage behaviour): rates MUST be obtained from the user's chosen Cashfold service, which publishes one rate table that is identical for every user and is not personalised, so the request reveals nothing about the user's holdings. The app MUST NOT contact any third-party rate provider. The service operator MUST be able to configure the rate source, and rate publication MUST be possible to disable (rates then come only from user-entered values).

**Transfers**

- **FR-043**: A transfer MUST be one inseparable record with a source account, destination account, source amount and destination amount.
- **FR-044**: Same-currency transfers MUST have equal amounts on both sides. Cross-currency transfers MUST carry the user-confirmed amount on each side.
- **FR-045**: Editing, deleting, or restoring a transfer MUST affect both sides together, on every device.
- **FR-046**: Transfers MUST be excluded from income and expense totals by default, and included when the user enables "transfers as income and expenses".

**Categories, tags, payees**

- **FR-047**: Users MUST be able to manage a two-level category tree for income and for expense separately, with name, icon, colour, order, and archived state.
- **FR-048**: The app MUST ship with the default category set defined in `contracts/default-categories.md`, which users can edit freely.
- **FR-049**: Users MUST be able to manage tags and payees; usage counts and ranking MUST be derived from data and not be user-edited.
- **FR-050**: Merging two categories, payees or tags MUST reassign all references and keep totals consistent.

**Deletion and history**

- **FR-051**: The app MUST prevent accidental data loss with confirmations for destructive actions.
- **FR-052**: Deleted records MUST be recoverable for 30 days from a "Recently deleted" list, on every device in the Fold. After 30 days a deleted record MUST be permanently removed: the removal MUST take effect on every device and the service MUST be able to discard the associated history once every active device has confirmed it. A restore within the window MUST work on every device, including devices that were offline while the record was deleted.
- **FR-053**: Users MUST be able to see when and on which device a record was last changed.

**Budgets**

- **FR-054**: Users MUST be able to create expense budgets and income targets scoped to accounts or groups, categories, and tags, with per-period amounts.
- **FR-055**: Budget periods MUST support day, week, month, year, and custom, with an interval and an anchor date.
- **FR-056**: Each budget MUST support one of three rollover policies: none, carry unspent, carry all.
- **FR-057**: For each period the app MUST show: carry-in, allocation, spent, and available, computed from the transactions. These MUST not be stored values that can drift.
- **FR-058**: The app MUST show daily average spending and a projected end-of-period spending for the current period, with an overspend warning.
- **FR-059**: Refunds MUST reduce spent in the matching budget.
- **FR-060**: Budget views MUST offer display modes: spent, limit, available, and spent/limit.
- **FR-061**: Changing, deleting or restoring any transaction MUST update all affected budget periods and rollovers.

**Recurring transactions**

- **FR-062**: Users MUST be able to schedule recurring income, expenses and transfers with unit (day/week/month/year), interval, start date, optional end date, optional confirmation requirement, and optional reminder.
- **FR-063**: Occurrence dates MUST be calculated from the start date, not from the previous occurrence, so month-end schedules do not drift.
- **FR-064**: Each occurrence MUST result in exactly one transaction, regardless of how many devices generate it, in what order, or after what offline period.
- **FR-065**: Users MUST be able to see upcoming occurrences, finish a schedule, and edit a schedule such that only future occurrences are affected.
- **FR-066**: Projected balances MUST optionally include future scheduled occurrences up to a chosen horizon (default 90 days).

**Goals**

- **FR-067**: Users MUST be able to create goals with a name, icon, colour, target amount, currency, target date, and linked goal account.
- **FR-068**: Goals MUST show saved, remaining, percentage, status (active, achieved, overdue), and required monthly saving rounded up to the smallest currency unit.

**Reporting and dashboards**

- **FR-069**: The app MUST show account balances, net worth in the base currency, period income minus expenses, spending by category and tag, trend over time, and the day-end balance, for any selectable period (including all time and custom ranges).
- **FR-070**: All totals MUST be reproducible from the underlying transactions and MUST agree with each other across every screen.
- **FR-071**: Reports MUST honour the "adjustments" and "transfers" display options.

**Synchronisation**

- **FR-072**: All functions MUST work fully offline, including opening the app again after the browser has been closed or the page reloaded while offline, once the app has been loaded successfully at least once. Changes made offline MUST be queued and synchronised automatically when connectivity returns.
- **FR-073**: Concurrent changes MUST merge automatically with no data loss and no manual conflict dialogs for ordinary edits. All devices MUST converge on the same state regardless of the order in which changes arrive.
- **FR-074**: Edits to different fields of one record made on different devices MUST both be preserved. Edits to the same field MUST resolve deterministically to the later change, identically on every device.
- **FR-075**: Fields that must remain consistent with each other (a transaction's amount, currency, and base equivalent; all fields of a transfer) MUST be updated and merged together.
- **FR-076**: A change on one device SHOULD appear on another online device within 5 seconds on the reference connection defined in SC-005.
- **FR-077**: Deliveries MUST be idempotent: receiving the same change twice has no effect.
- **FR-078**: Where a merge produces an invalid combination (e.g. orphaned reference), the app MUST NOT guess: it MUST keep the data, mark the problem, and let the user resolve it. Every device MUST present the same problem the same way.
- **FR-079**: Clocks that are far in the future MUST NOT be able to take over conflict resolution. Changes stamped more than 24 hours ahead of the receiving device's clock MUST be set aside and the user informed.
- **FR-080**: The service MUST be unable to silently drop, reorder, or replay changes without devices detecting it.
- **FR-081**: Users MUST be able to see sync status (synced, syncing, offline, error) and the time of the last successful sync per Fold.
- **FR-082**: The service SHOULD be able to prune old history once every active device has confirmed a verified checkpoint, without losing data.

**Sharing and access**

- **FR-083**: A Fold owner MUST be able to invite existing users by email as owner, editor or viewer, and change or remove roles.
- **FR-105**: The service MUST verify control of an email address before the account can be used for sharing or invitations (the verification message contains no financial content). A self-hosted service MAY disable verification by configuration, and the app MUST then tell users that invitations rely on out-of-band identity checks.
- **FR-106**: Resolving an email address to a person for an invitation MUST be available only to signed-in, email-verified users, MUST be rate-limited, and MUST return only what is needed to start the invitation (the public identity keys). Each account MUST have a setting that controls whether it can be found by email, and a user who is not discoverable MUST still be invitable through a shareable invitation link or code that the invitee gives to the inviter. An unknown address and a non-discoverable address MUST produce the same "not found" response, so a lookup reveals only accounts that chose to be discoverable. New accounts are discoverable by default, the choice MUST be shown at sign-up, and it MUST be changeable at any time.
- **FR-107**: Invitation notifications MUST NOT reveal Fold names, member lists or any financial content; they MUST say only that the sender has invited the recipient to Cashfold.
- **FR-102**: Each invitation MUST specify the history scope: *full history* or *from the join date onward*. The invitee MUST be shown the scope before accepting. A member invited with *from the join date onward* MUST be unable to read any record created before joining, and the owner MUST be told this cannot later be widened without a new invitation.
- **FR-084**: Invitations MUST require both parties to be able to compare a short security fingerprint outside the app; for every shared Fold the app MUST require this check before the invitation is accepted.
- **FR-085**: Viewers MUST be unable to change data; changes forged by a viewer MUST be rejected by every member's device.
- **FR-086**: Removing a member MUST immediately protect all data created afterwards, and the app MUST tell the owner that data already seen cannot be recalled.
- **FR-087**: The membership history of a Fold (who was added or removed, with which role) MUST be tamper-evident and verifiable by every member.
- **FR-088**: A Fold MUST always have at least one owner. The last owner MUST NOT be removable or demotable without first transferring ownership.
- **FR-089**: Members MUST be able to leave a Fold; what happens to their local copy is defined in FR-104.
- **FR-104**: When a member is removed from a Fold or leaves it, their app MUST delete its local copy of that Fold the next time it contacts the service. A member who leaves voluntarily MUST be offered an export before deletion. The product MUST state plainly that deletion on the device cannot recall data the person already saw, exported or copied.
- **FR-101**: Users MUST be able to delete their account. Deletion MUST require a fresh identity check and explicit confirmation. If the user owns any Fold that has other members, the app MUST block deletion until each such Fold has had its ownership transferred or has been deleted. On completion the service MUST remove the account, the user's devices, and all Folds where the user was the only member, and the user's membership in any other Fold MUST be removed.

**Import, export, backup**

- **FR-090**: Users MUST be able to import transactions from CSV with column mapping, preview, duplicate detection, row-level error reporting, and one-step undo of the whole import.
- **FR-091**: Users MUST be able to create an encrypted backup and restore it on a fresh install.
- **FR-092**: Users MUST be able to export readable data (CSV) after an extra identity check and an explicit warning.
- **FR-093**: Attachments MUST be encrypted individually, large files MUST be handled in pieces, and truncation of an attachment MUST be detected.

**Quality, accessibility, localisation**

- **FR-094**: The app MUST be usable with screen readers, large text, and reduced motion, and with colour-independent indicators for gains, losses and warnings.
- **FR-095**: The app MUST support multiple languages, including right-to-left layouts, and locale-correct number, currency, and date formatting.
- **FR-096**: Core screens MUST remain responsive with at least 50,000 transactions in a Fold.
- **FR-097**: The app MUST provide a "Needs attention" area listing detected problems (orphans, rejected changes, clock problems) with plain-language explanations and a fix action.
- **FR-098**: Error messages MUST be clear, non-technical, and MUST NOT contain secrets or financial values in logs.

### Key Entities *(include if feature involves data)*

- **User Account**: a person's identity (email, display name). Has a Secret Key (held only on their devices), a password (known only to them), and a set of devices.
- **Device**: an enrolled phone, tablet, or computer with its own identity, label, and revoked state.
- **Fold**: isolated budget context with a name, base currency, members with roles, and a protection generation that advances whenever a member is removed.
- **Member / Role**: a user's relationship to a Fold: owner, editor, or viewer, with who invited them and when.
- **Account**: a place money is held or owed: kind, currency, opening balance, opening date, flags (archived, include in net worth), optional credit limit, appearance, groups.
- **Account Group**: a named, ordered collection of accounts.
- **Category**: income or expense classification with an optional parent (maximum two levels), appearance, order, archived state.
- **Payee**: a counterparty (shop, employer, person).
- **Tag**: a free-form label; many per transaction.
- **Transaction**: one income, expense or adjustment on one account: signed amount, currency, base-currency equivalent with rate, date/time/zone/local date, category, payee, tags, note, place, attachment, flags, status, origin.
- **Transfer**: one inseparable movement between two accounts with an amount on each side.
- **Exchange Rate**: a rate between the base currency and another currency at a point in time, with source.
- **Budget (Envelope)**: spending limit or income target with scope, period, amount, rollover policy.
- **Budget Period** *(derived)*: carry-in, allocation, spent, available for one period of one budget.
- **Goal**: savings target with amount, currency, date and linked goal account.
- **Schedule**: recurrence rule plus a template of the transaction or transfer to create, with start, end, confirmation and reminder.
- **Import Batch**: a group of records that came from one import, so it can be undone.
- **Change**: the unit of synchronisation: one authored, timestamped, verifiable alteration to one record.
- **Membership History Entry**: a tamper-evident record of a membership or device change.
- **Invitation**: an offer to join a Fold with a role and a history scope; created by an owner and accepted by the invitee after a fingerprint check.
- **Email Verification**: proof that a person controls an email address, required before sharing features are available.
- **Recovery Key / Emergency Kit**: the user's offline-held secrets for regaining access.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can create an account, save their Emergency Kit, and record their first transaction in under 5 minutes.
- **SC-002**: In an audit comparing everything the service stores and receives against the data the app handles, zero financial content or secrets are found in readable form.
- **SC-003**: After 10,000 randomised sequences of transactions, transfers, currency conversions and edits, every balance and total equals the independently computed exact result with zero discrepancy of even one smallest currency unit.
- **SC-004**: Two or more devices that make arbitrary offline edits, including conflicting ones, end with identical data after reconnecting in 100% of 1,000 randomised trials, in any delivery order and with duplicates.
- **SC-005**: A change made on one online device appears on another within 5 seconds for at least 95% of changes on a reference connection with at most 150 ms round-trip latency and at least 5 Mbit/s throughput.
- **SC-006**: 100% of deliberately tampered, replayed, reordered, forged or downgrade-attempt messages from the service in the test suite are detected and rejected, with no data corrupted.
- **SC-007**: Every local function of the P1 and P2 stories (everything except contacting the service itself: sync, device enrolment, rate refresh) is fully usable in airplane mode, with no waiting on the network. Changes made offline are queued for sync.
- **SC-008**: Opening the app, unlocking, and showing the dashboard takes under 2 seconds on the reference device with 50,000 transactions (reference device: Chromium on a desktop with 4× CPU throttling, fixed in `research.md` R-12 and used by the benchmark); adding a transaction takes effect on screen in under 200 milliseconds.
- **SC-009**: A removed member cannot read any content created after their removal in 100% of tests, and the owner is shown the limitation about previously seen data.
- **SC-010**: 90% of first-time testers successfully add a second device using the Emergency Kit without help.
- **SC-011**: 95% of testers who deliberately lose their device successfully regain full access on a new device using the Emergency Kit and password.
- **SC-012**: Scheduled transactions across 3 devices produce exactly one transaction per occurrence in 100% of 500 randomised offline/online trials, including month-end and leap-day schedules.
- **SC-013**: An encrypted backup restored on a fresh install matches the original data exactly in 100% of tests.
- **SC-014**: A CSV import of 5,000 rows previews in under 5 seconds, and its undo removes every imported record and nothing else.
- **SC-015**: Security review finds no case in which a locked app, a hidden or unfocused window, an app-switcher preview (on platforms that provide one), a log file, a crash report, or a notification discloses financial data.
- **SC-016**: All primary tasks (adding transactions, viewing budgets, reviewing reports) can be completed using a screen reader without sighted assistance.

## Assumptions

- **Platforms (v1)**: the first release runs in modern web browsers. Desktop and mobile apps are planned later and share the behaviour described here. Guarantees that depend on the operating system (hardware key storage, app-switcher previews, excluding data from backups) apply only where the platform provides them; the web release states its limits plainly. Devices have a screen lock; biometric hardware is optional.
- **Users**: individuals and households managing personal or small-business finances; typical data size is under 50,000 transactions per Fold; most users have 1–3 devices and 0–5 shared members.
- **Language**: the app launches in English with the localisation framework ready for more languages.
- **Connectivity**: an account can be created on a device before any service has been contacted; registration with the chosen service happens the first time the user goes online and chooses to sync. The service is optional day-to-day. Sync is required only for multi-device and sharing; a user can run Cashfold fully on a single device with the service unused after sign-up.
- **Service operation**: the service is open source and self-hostable; a hosted instance is also offered. The privacy guarantees must hold identically on both.
- **Service role**: the service stores and forwards protected data and never decides content. Its operator is treated as untrusted for confidentiality, and trusted only for availability.
- **No bank connections (v1)**: transactions come from manual entry, schedules, and file import. Direct bank feeds are out of scope because they would require sending readable data to a service.
- **No server-side search, analytics, or AI insights (v1)**: any such feature would break the privacy guarantee.
- **No password or Secret Key reset by the operator**: this is deliberate. Recovery is limited to the Emergency Kit, the optional Recovery Key, and other Fold members re-sharing access.
- **Exchange rates**: the user's service publishes a shared, non-personalised rate table fetched from a public source (configurable by the operator). The user may supply custom rates; rates are advisory and never override a user-entered amount.
- **Currencies**: standard fiat currencies plus a small configurable set of crypto assets, with up to eight decimal places and a limit of roughly 9.2×10¹⁰ whole units per amount.
- **Payments and subscriptions**: monetisation is out of scope for this feature.
- **Compatibility**: Cashfold defines its own formats. Interoperability with other products' backups is limited to CSV import.
- **Legal and compliance**: formal compliance regimes (for example financial-data regulations in particular countries) will be reviewed separately before public launch.
- **Delivery**: this feature is large. Its user stories are independently deliverable in priority order, so `/speckit-plan` should phase delivery as P1 (Stories 1–3), P2 (Stories 4–5), then P3 (Stories 6–9).
