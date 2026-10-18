# Contract: Core Worker Application API

The UI (React in `apps/web`) never imports `core` directly. It talks to the **Core Worker** through a typed RPC surface generated from the application layer of `packages/core`. This file lists the capabilities. Exact TypeScript signatures live in `packages/core/src/**/application` and must match this document.

## Principles

1. **Opaque handles, no secrets.** The UI receives session handles and read-model results. Key bytes, passwords after submission, and decrypted private keys never cross the RPC boundary. The Secret Key and Recovery Key cross it once, as display text, at creation.
2. **No `number` for money.** Amounts are `{ minor: bigint, currency: CurrencyCode }`. Over RPC they travel as structured-clone `bigint` (or decimal strings in JSON-only transports). User-entered text is parsed by the core with the currency's exponent.
3. **Commands append operations; queries read projections.** Every command is atomic (one SQLite transaction: op log + projections). Queries never mutate.
4. **Typed errors.** Errors are discriminated unions with no secrets or financial values.
5. **Async with cancellation.** Long operations (unlock, sync, import) accept an `AbortSignal` and report progress through events.

## Types (summary)

```text
Money            { minor: bigint, currency: CurrencyCode }
AmountInput      { text: string, currency: CurrencyCode }        // parsed exactly, or InvalidAmount
LocalDate        number (yyyymmdd integer; not money)
Moment           { utcMs: bigint, tzOffsetMin: number }
Id               string (UUID, lower-case hex with hyphens)
Role             'owner' | 'editor' | 'viewer'
HistoryScope     'full' | 'from_join'
AccountKind      'checking' | 'savings' | 'credit_card' | 'cash' | 'goal' | 'loan'
TxnStatus        'pending' | 'posted' | 'void'
Rollover         'none' | 'carry_positive' | 'carry_all'
Period           { unit: 'day'|'week'|'month'|'year'|'custom', interval: number, anchor: LocalDate, customEnd?: LocalDate }
SyncState        'synced' | 'syncing' | 'offline' | { error: SyncErrorKind }
NeedsAttention   { kind: string, ref?: Id, messageKey: string }
Result<T,E>      { ok: true, value: T } | { ok: false, error: E }
```

## Lifecycle and identity (stories 1, 4, 9)

| Command | Result | Notes |
|---|---|---|
| `createAccount({ email, password, deviceLabel, server })` | `NewAccount { secretKeyText, emergencyKit: Uint8Array }` | Secret Key returned once; password buffer wiped |
| `signIn({ email, password, secretKeyText, deviceLabel, server })` | `SessionHandle` | Enrols this device |
| `unlock({ password })` / `unlockQuick()` | `SessionHandle` | Quick unlock uses the platform credential when available; password required after browser restart |
| `lock()` | void | Wipes secrets, closes the database, terminates the worker |
| `setAutoLock(policy)` | void | |
| `changePassword({ old, next })` | void | Invalidates other sessions |
| `rotateSecretKey({ password })` | `{ secretKeyText, emergencyKit }` | |
| `enableRecoveryKey({ password })` | `{ recoveryKeyText }` (once) | |
| `recoverWithRecoveryKey({ email, recoveryKeyText, newPassword })` | `SessionHandle` | |
| `listDevices()` / `renameDevice` / `revokeDevice(devId)` | | |
| `deleteAccount({ confirmToken })` | void | Fails with `OwnsSharedFold(folds)` until transferred or deleted; on success wipes local data |
| `getServer()` / `setServer(address)` | | Chosen at sign-up/sign-in; default is the hosted instance |
| `migrateToServer(address)` | progress events | Re-registers, replays membership logs, pushes the op log, deletes the old account (ARCH §9.9) |
| `exportEmergencyKit()` | `Uint8Array` (PDF) | Requires fresh unlock |
| `verifyEmail(token)` | void | One-time token from the verification email |
| `setDiscoverable(boolean)` | void | Controls email lookup for invitations (FR-106) |

## Folds and sharing (stories 1, 7)

`lookupMember(email) → PublicKeyBundle | NotFound` (verified callers only, rate-limited), `createInvitationCode() → string`, `inviteByCode(code, …)`, `listFolds`, `createFold({ name, baseCurrency })`, `renameFold`, `deleteFold({ confirmToken })`, `inviteMember({ fold, email, role, historyScope }) → Invitation { fingerprint, historyScope }`, `acceptInvitation({ invitation, fingerprintConfirmed })` (the invitation exposes `historyScope` for display before accepting), `listMembers(fold)`, `changeRole`, `removeMember`, `leaveFold({ fold, exportFirst })`, `transferOwnership`, `membershipHistory(fold)`. After a removal or departure is observed, the core deletes the Fold's local data automatically and emits `FoldRemoved(fold)`.

## Ledger commands and queries (stories 2, 3, 8)

Commands: `createAccountRecord`, `updateAccount`, `archiveAccount`, `deleteLedgerAccount({ confirm })`, `groupAccounts`, `createCategory`, `moveCategory`, `mergeCategories`, `addTransaction(draft)`, `updateTransaction`, `deleteTransaction` / `restoreTransaction`, `adjustBalance({ account, target: AmountInput, date })`, `addTransfer(draft)`, `updateTransfer`, `deleteTransfer`, `addGoal`, `updateGoal`, `deleteGoal`, `setCustomRate`, `refreshRates` (reads the user's service rate table; never a third party), `revalue(txnIds)`.

Queries: `accountBalance({ account, asOf, includeScheduled }) → Money`, `netWorth({ fold, asOf }) → Money`, `listTransactions({ filter, sort, page })`, `search({ text, filter })`, `spendingByCategory({ period, options })`, `incomeVsExpense({ period, options })`, `dayEndBalances({ account, range })`, `goalProgress(goal) → { saved, remaining, percent, status, requiredPerMonth }`, `recentlyDeleted(fold)`, `needsAttention(fold)`.

`options` always includes `adjustmentsAsIncomeExpense: boolean` and `transfersAsIncomeExpense: boolean`.

## Budgets (story 5)

Commands: `createBudget`, `updateBudget`, `deleteBudget`.
Queries: `budgetPeriod({ budget, periodIndex }) → { carryIn, allocation, spent, available, limit }`, `budgetVelocity(budget) → { burnPerDay, projected, overspend }`, `listBudgets({ fold, displayMode })`.

## Schedules (story 6)

Commands: `createSchedule`, `updateSchedule`, `finishSchedule`, `confirmOccurrence(txnId)`, `skipOccurrence`.
Queries: `upcoming({ fold, horizonDays })`, `listSchedules({ fold, completed })`.
Event: `OccurrencesMaterialised(count)` after each sync or app foreground.

## Import, export, backup (story 9)

`importCsvPreview({ file, mapping }) → Preview { rowsOk, rowsFailed: RowError[], duplicates }`, `importCsvCommit(previewId) → ImportBatchId`, `undoImport(batch)`, `exportEncryptedBackup({ passphrase? }) → Uint8Array`, `restoreBackup({ bytes, credentials })`, `exportCsv({ fold, filter }) → Uint8Array` (requires fresh identity check), `addAttachment(stream)`, `openAttachment(id) → stream`, `removeAttachment(id)`.

## Sync (story 4)

`syncNow(fold?)`, `syncState(fold) → SyncState`, `lastSynced(fold) → Moment | null`.
Events: `SyncStateChanged`, `RemoteChangesApplied(fold, recordIds)`, `OpQuarantined(reason)`, `NeedsAttentionChanged`, `FoldRemoved(fold)`, `AccountDeleted`.

## Multi-tab behaviour

Exactly one Core Worker owns the database (Web Locks). Other tabs call the same API through the leader worker and receive the same events over a `BroadcastChannel`. Locking in one tab locks all tabs.

## Error taxonomy

`InvalidAmount`, `AmountOutOfRange`, `CurrencyMismatch`, `ArchivedAccount`, `InvariantViolation(rule)`, `NotFound`, `PermissionDenied(roleRequired)`, `Locked`, `AuthFailed` (uniform), `RateLimited(retryAfter)`, `ServerRejected(kind)`, `ServerTampering(kind)`, `KdfBelowFloor`, `Offline`, `Conflict(kind)` (only for non-mergeable user actions), `Storage(kind)`, `UnsupportedBrowser(feature)`, `OwnsSharedFold(folds)`, `AccountDeleted` (410, triggers local wipe), `EmailNotVerified`, `LookupRateLimited(retryAfter)`, `Cancelled`.

## Traceability

| Area | Spec requirements |
|---|---|
| Lifecycle/identity | FR-001…FR-010, FR-014 |
| Folds/sharing | FR-020…FR-022, FR-083…FR-089, FR-102, FR-104 |
| Service and account lifecycle | FR-099…FR-101, FR-103 |
| Ledger | FR-023…FR-053 |
| Money/FX | FR-037…FR-042 |
| Budgets | FR-054…FR-061 |
| Schedules | FR-062…FR-066 |
| Goals | FR-067…FR-068 |
| Reports | FR-069…FR-071 |
| Sync | FR-072…FR-082 |
| Import/export | FR-090…FR-093 |
