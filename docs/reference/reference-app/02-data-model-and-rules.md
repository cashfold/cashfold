# 02 — Data Model, Domain Rules, Default Content

Source: `the model bundle/the latest model version (v26)` (the latest of 26 model versions; v1 is `model.mom`) decoded with `plistlib`, the ObjC class/ivar metadata, and the bundled JSON/CSV-like resources. Tags: **[M]** from the model/metadata, **[S]** from strings, **[I]** inferred (unverified).

Core Data attribute type codes in the model: 100 = Int16, 200 = Int32, 300 = Int64, 400 = Decimal, 500 = Double, 600 = Float, 700 = String, 800 = Bool, 900 = Date.

## 1. Conventions common to synced entities [M]

Every user-data entity (Account, Group, Category, Tag, Counterparty, Budget, Goal, Schedule, Transaction, Import) has:

| Field | Type | Meaning |
|---|---|---|
| `sid` | String | Stable globally unique id (UUID string); the key used for relations and sync |
| `synced` | Bool (default false) | Whether the last local change was uploaded |
| `saved` | Int64 | Last-modified timestamp (version marker used to pick changes to send) [I] |
| `session` | String | Id of the device/session that created or changed the object (sync) [I] |
| `import` | String (on most) | Id of the `Import` batch that created the object |

**There are no Core Data relationships** in the model: every link is a `sid` string stored in a String attribute (`account`, `category`, `group`, `transfer`, `counterparty`, `tag1..3`, …). Referential integrity is enforced by the app's storage layer (`Storage` subclasses: `AccountStorage`, `TransactionStorage`, `GoalStorage`, `BudgetStorage`, `TagStorage`, `CounterpartyStorage`, `ImportStorage`) [M].
*Implication for cashfold*: an id-reference model with application-level integrity and soft "archive" flags.

Money is stored as `Decimal` (`NSDecimalNumber`), never Double, except coordinates and FX rates [M].

## 2. Entities

### 2.1 Account (`CDAccount`)
| Field | Type | Notes |
|---|---|---|
| `name` | String | Unique name [S "The name is already in use"] |
| `currency` | String | Currency code of the account |
| `sum` | Decimal | **Initial balance** (`_openingBalance`) |
| `icon` | String | Icon code, `bundle/name` |
| `color` | Int16 | Palette index |
| `order` | Int16 | Sort order in lists |
| `archive` | Bool | Archived: hidden everywhere except edit mode on Accounts |
| `detail` | Int16 | Display detail level for lists/"show current balance" [I] |
| `report` | String | Report currency (used when the account is shown in group/report contexts) [I] |
| `internal` | Bool (default true) | Regular account vs. a system/goal-backing account [I] |

### 2.2 Group (`CDGroup`)
`name`, `icon`, `color`, `order`, `detail` (show-balance mode), `report` (**report currency**), and `data` (String: the member account sids, serialized, probably JSON/CSV) [M/I]. A group is a *named set of accounts*; an account may be in several groups (editor: "Include in Account Groups"). Groups act as a selectable "current scope" everywhere an account can be selected (transactions, report, goals, budgets, widgets).

### 2.3 Transaction (`CDTransaction`)
| Field | Type | Notes |
|---|---|---|
| `type` | Int16 | Expense / Income / Transfer-leg (the codes 1 = expense, 2 = income are confirmed for categories and budgets in the bundled data [M]; the transfer code is not confirmed [I]) |
| `sum` | Decimal | Amount in `currency` |
| `currency` | String | Transaction currency |
| `usd` | Decimal | Amount normalized to USD at entry time, for cross-currency aggregation [I] |
| `account` | String | Account sid |
| `category` | String | Category sid (empty = "Uncategorized") |
| `tag1`, `tag2`, `tag3` | String | **At most 3 tags**, by name (tags are referenced by *name*, not sid — see `replaceOldTagName:withNewName:`) [M] |
| `counterparty` | String | Counterparty sid (Payer for income, Payee for expense) |
| `comment` | String | Note |
| `time` | String | Time of day when "Transaction Time" is enabled [I] |
| `end` | String | Purpose unconfirmed. It is the only other string/date-like field and may hold the transaction date key [I]; see the note below |
| `place`, `latitude`, `longitude` | String, Double, Double | Optional geotag |
| `image` | String | Reference to a locally stored receipt photo (not synced) |
| `transfer` | String | Transfer destination account sid (for a transfer) |
| `pair` | String | Sid of the other leg of a transfer |
| `refund` | Bool | Refund marker (reverses an expense/income semantically) |
| `adjustment` | Bool | Balance-adjustment transaction |
| `confirm` | Bool | `true` = still **pending manual confirmation** (generated from a schedule) [I] |
| `pinned` | Bool | Pinned by the user |
| `repeat` (Int16), `repeated` (String), `origin` (String) | | Schedule linkage: the schedule's sid in `repeated`/`origin`, the occurrence info in `repeat` [I] |

*Note on dates*: the model has **no `Date`-typed attribute on Transaction**, so the transaction date must be held in a String attribute (`time` and/or `end`). Which one, and the format, is **unknown** (open question 3 in [03 §13](03-settings-sync-pro-system.md)).

### 2.4 Category (`CDCategory`)
`name`, `type` (1 expense / 2 income), `parent` (parent category sid; empty = top level; **max 2 levels** [S: "Leave '%@' for a top-level category"]), `icon`, `color`, `order`, `archive`. Default category tree: §4. Sample category sids are stable UUIDs, so default categories keep the same ids on every install, which enables sync merge and demo-data references [M].

### 2.5 Budget (`CDBudget`)
| Field | Notes |
|---|---|
| `type` (Int16) | 1 = expense budget, 2 = income budget (demo data) [M] |
| `sum` (Decimal), `currency` | Limit per period |
| `period` (Int16, default −1) | Period type: year/month/week/day (the codes are not confirmed) [I] |
| `account`, `group` | Scope: account or account group (empty = all) |
| `category`, `categories` | A single parent category sid (legacy) / a list of categories [I] |
| `tags` | Tag names to include |
| `transfer` | Transfer target account to track [I] |
| `name`, `icon`, `color` (default −32768 = none) | Optional display overrides |

Budget with no category/tags = an *overall* budget (the demo's first budget: 3000 total).

### 2.6 Goal (`CDGoal`)
`name`, `icon`, `color`, `sum` (target, Decimal), `currency`, `date` (Date; optional deadline), `account` (tracked account sid), `group` (tracked group sid). Progress is derived from the tracked account/group balance, not stored (`previewBalanceCalculator`, `calcCurrentSumForGoal:`). Note that `saved` here is the sync version stamp, not "money saved" [M/I].

### 2.7 Schedule (`CDSchedule`)
A transaction template plus recurrence:
- Template fields mirror a Transaction: `type`, `account`, `transferAccount`, `category`, `sum`, `currency`, `transferSum`, `transferCurrency`, `tags`, `counterparty`, `comment`, `place`, `latitude`, `longitude`.
- Recurrence: `period` (Int16: unit), `frequency` (Int16: every N units), `begin` (String: first date), `end` (String: last date or none), `last` (String: last generated occurrence), `done` (Date: completion time).
- Behavior flags: `confirm` (Bool: require manual confirmation), `reminderMinutes` (Int16, default −1 = no reminder).
- UI-level repeat options: Daily, Weekly, Monthly, Annually [S]. Demo data uses `period` 3/4/5 with `frequency` 1–4. A plausible mapping is 3 = month, 4 = week, 5 = day, but this is **not confirmed** [I].

### 2.8 Tag (`CDTag`), Counterparty (`CDCounterparty`), Place (`Place`, non-persistent)
- Tag: `name`, `color`, `count` (usage count, denormalized).
- Counterparty: `name`, `color`, `count`, `last` (Date, last used; supports "By Last Used" sort).
- Place: a plain object (name + coordinates) *derived from transactions' `place/latitude/longitude`* for Reports by "Places"; there is no Place table [M].

### 2.9 Rate (`CDRate`)
`currency` (String), `time` (Int32: timestamp of the snapshot), `value` (Float): units of currency per 1 USD. Bundled snapshot `BaseRates.json` has 182 currencies keyed by UNIX time `1749164400` (2025-06-06), used as the offline fallback; the app updates rates online [M/S].

### 2.10 Import (`CDImport`)
`sid`, `date`, `done` (Bool), `session`, `saved`, `synced`. Marker row for a CSV import batch; entities created by the import carry its `sid` in `import` (account, category, counterparty, tag, transaction) so the batch can be identified or undone [M/I].

## 3. Calculation and business rules

### 3.1 Balances [S/M/I]
- **Current balance** (account) = initial balance + sum of its transactions up to the **end of today** (signed: income +, expense −, transfers by leg). Quote: "Sum of transactions through the end of today, plus the initial balance of the account(s)".
- **Balance on date** = initial balance + transactions through the end of the selected period/date.
- **Group balance** = Σ member account balances, each converted to the group's report currency.
- **Period balance** = income − expenses within the period.
- `includeScheduled` option: adds not-yet-created scheduled occurrences to sums/charts (`BalanceCalculator.includeScheduled`).
- `BalanceCalculator` is parameterised with `accounts`, `dateFrom`, `dateTo`, `periodBreakdown`, `currency`, `includeScheduled` and runs asynchronously on an `NSOperationQueue` with a QoS (`calcWithCompletion:`).

### 3.2 Currencies and conversion [S/M/I]
- Every account has one currency. Reports and dashboards convert into: the group's **report currency**, the user's **General Currency** (if enabled and selected), or the account's own currency.
- Conversion goes through the USD-based rate table: `amount_in_B = amount_in_A × rate[B] / rate[A]`. Transactions also store `usd` at entry [I].
- **Comparison currency**: shows an extra estimated amount in a second currency (display only).
- Option "Round summary amounts to whole numbers for all currencies" affects *summaries only*; entries keep decimals.
- "Fixed decimal separator" input mode: typing digits shifts into the fractional part (like a cash register), for currencies with minor units.
- Cryptocurrencies (BTC, ETH, LTC, XMR, XRP, DASH, DOGE, …) are first-class currency codes with names in the strings.

### 3.3 Transfers [S/M/I]
- A transfer moves value between two accounts and may change currency (separate source and destination amounts; "Transfer: Amount / Currency").
- Stored as two linked rows (`pair`, `transfer`). Editing or deleting acts on both.
- Reports: by default transfers are **excluded** from income/expense. With "Transfers as Income and Expenses" on, each leg counts as an expense (source) / income (destination). Per-category reports list transfers as their own items ("Transfer: Account").
- Goals typically track a dedicated savings account, and "saving" is a transfer into it (the demo has `totalNumberOfTransfers` per goal).

### 3.4 Reports [S/M/I]
- **Type**: Expenses or Income. **Breakdown**: Categories (with transfers and subcategory drill-down), Tags, Counterparties (payer/payee), Places.
- **Period**: any `Period` (day/week/month/quarter/year/last-N-days/all/custom). Month and year boundaries are shifted by *First Day of Month*.
- **Percent** = item sum / total sum. **Sort** by Standard order, Amount, Name, Frequency, Last used. "Other" merge for tiny slices (threshold shown as [[percent]]).
- **Tags caveat**: one transaction can carry up to 3 tags, so tag sums can exceed the total. This is stated in the UI.
- **Filter**: include/exclude lists over categories, tags, counterparties.
- **Bar chart**: sums per subperiod (days in a week/month, weeks, months in a year, years…), optional stacking by breakdown item, and an optional budget line.
- **Significant** transactions (main list mode): a "show only the big ones" view; the threshold rule is unknown [I].

### 3.5 Budgets and goals [S/M/I]
- **Budget consumption** for a period = Σ expenses matching the scope (account/group, categories incl. subcategories, tags, transfer target) in the budget's currency (converted as needed); optionally including scheduled transactions. Display modes: Expense (spent), Limit, Available (limit − spent), "Expense / Limit".
- A budget is evaluated for the **current period of its type** (the Plan screen's period selector lets the user view other periods; the bar chart shows a budget line).
- Income budgets (`type = 2`) track expected income against actual.
- **Goal progress** = tracked account/group balance (converted into the goal currency) vs. target `sum`; remaining = target − saved; "Overdue" when `date` has passed and not reached; "Goal Achieved" at ≥ 100%. Preview in the editor uses the current balance of the chosen account.

### 3.6 Scheduled transactions [S/M/I]
- Occurrences are generated from `begin` stepping by `frequency × period` until `end` (or never ending), and skipping `done` ones.
- Generation happens when the app is open or in the background refresh task. Each created transaction links back to the schedule (`repeated`/`origin`).
- `confirm = true`: the created transaction is *pending* (not counted until confirmed [I]) and shown in the list with a **Confirm** action; the badge counts pendings.
- A reminder notification fires `reminderMinutes` before the due time (or at the due time). Completed schedules are listed under "Completed"; "Finish" ends a schedule early.

### 3.7 Limits (free tier) [S/M]
See [03 §6](03-settings-sync-pro-system.md). `Max items allowed: %@` caps the number of rows in some lists/pickers for non-PRO users.

## 4. Default category tree (`en.lproj/Categories.<ext>`, format "CB,11,2021-05-08")

CSV-like lines: `C,<sid>,<name>,<type>,<icon>,<color>,<order>,<parentSid>`; `//` comments. 85 categories in total. Localized per language (`Categories.<ext>` exists in each `*.lproj`), with the same sids.

**Expense (type 1)** — top-level (subcategories after the colon):
1. Groceries
2. Home: Furniture; Household Chemicals; Household Goods; Maintenance; Renovation; Rent; Tableware; Utility
3. Clothing & Shoes: Accessories; Clothing; Footwear; Underwear
4. Eating Out: Cafes; Fast Food; Restaurants
5. Transport: Carsharing; Public transport; Taxi
6. Entertainment: Active Recreation; Books; Clubs & Bars; Exhibitions & Museums; Hobby; Music & Video; Software & Games
7. Kids: Baby Clothes; Baby Food; Classes; Goods for Children; Healthcare; Toys
8. Travel: Car Rental; Hotel; Services; Souvenirs; Tickets
9. Healthcare: Dentistry; Fitness & Sport; Medical Services; Medicines
10. Beauty: Barbershops; Beauty Products; Beauty Salon
11. Hardware: Appliances; Consumer Electronics
12. Communication: Cellular; Internet; Internet-Services
13. Car: Accessories; Car Care Products; Car Insurance; Car Parts; Car Service; Car Wash; Fuel; Parking; Toll Roads; Traffic Fines
14. Pets: Accessories & Toys; Pet Food; Pet Services; Veterinary Services
15. Taxes
16. Education
17. Etc.: Charity; Gifts

**Income (type 2)**: Salary; Business Income; Etc.

Each category has a default icon (`bundle/name`) and a palette color index. Subcategories inherit the parent's color [I].

## 5. CSV import mapping (`ImportAssistant`)

Pipeline [M]: pick file → copy to an inbox folder → detect **encoding** → parse CSV (`CSVParser`) → detect **header row** (switch) → detect **column types** (text/number/date-time/currency/empty) → detect **date format** and **number locale** (including ISO-8601) → user assigns columns → computes **distinct values** per assignable column → user maps values (Correspondence step) → `createImportedData`: create new accounts (random color), categories (by type), counterparties, then transactions; mark the batch; cleanup. Optionally **upload the file to the vendor's server** ("Send File") when recognition fails.

Column roles: Date, Time, Date and Time, Amount, Amount (income), Amount (expense), Currency (+income/expense variants), Account (+income/expense variants), Category, Counterparty, Tags, Note, Transaction Type, Not Used. *Separate income/expense amount/account/currency columns* support bank statements with debit/credit columns.

Free tier: limited number of imports.

## 6. Backup and sync payloads

- **Backup** (`JSONBackup`): `{ items: [...], date, version, syncAccount }`, a JSON dump of all entities, stored in iCloud via `UIDocument` (`BackupDocument`); restore **replaces all local data**.
- **Sync** (`SyncSyncer`): incremental, cursor-based. It tracks per-entity "changed" and "deleted" flags (accounts, groups, categories, tags, budgets, transactions, goals, counterparties, imports, schedules). Deletions are queued by `sid` (`sidsToDelete`, persisted). It `send`s objects in batches (max counts), `fetch`es with a server cursor (reset on "Perform Full Synchronization"), and has fetch-interval backoff (`updateFechInterval`), a pause/resume state, and `checkSchemeUpgrade` for model upgrades. Images are not synced. See [03 §4](03-settings-sync-pro-system.md).

## 7. Demo data (`DemoData.json`)

Seeded when the user starts without data; removable via banner or Settings ("Remove Example Data").
- **Accounts (9)**: Cash ×3 (currency types 1, 2, 3: the first three currencies, e.g. local/major ones), Green Card (1500 initial), Yellow Card (3500), Red Card (2500), Purple Card (3000), "For a Trip" and "For a House" (flagged `isGoal`: savings accounts that back goals).
- **Groups (3)**: Cash (3 cash accounts), Bank Cards (4 cards), Savings (Goals) (2 goal accounts).
- **Goals (2)**: "House by the Sea" (target 20,000, +990 days, 30% progress, 4 transfers), "Round-the-World Trip" (8,000, +150 days, 70%, 7 transfers).
- **Budgets (13)**: an overall expense budget (3000) plus per-top-category expense budgets (Groceries 400, Home 900, Eating Out 150, Transport 70, Entertainment 200, Clothing & Shoes 250, Healthcare 250, Travel 200, Etc. 350) and income budgets (Salary 3500, Business Income 750, Etc. 550), each with a number of generated transactions.
- **Schedules (9)**: weekly/monthly expenses and a monthly salary.
- **Tags (3)**: My Hobby, Vacation, Project A. **Counterparties (9)**: planet-themed company names. **Places (9)**: world cities with coordinates. **Transfers**: 4 totalling 1000.
- Generated transactions are randomised around these parameters (`probability`, `numberOfTransactions`) [I].
- Non-PRO users can try PRO features with demo data (`isAllowedProForDemoMode`, `isDemoAccount/Group`).

*cashfold reuse note*: the structure is useful as a template for a first-run sample, but the names, numbers and content should be original.
