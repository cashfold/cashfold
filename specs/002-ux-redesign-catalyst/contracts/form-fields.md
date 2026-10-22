# Contract: Form Field Classification

**Spec**: FR-008 to FR-011, FR-020, FR-021, FR-031 | **Data model**: §2 `visibleFields()`

Classes: **E** essential (always visible), **O** optional (inside the collapsed "More details"/"More options" group unless made default-visible), **T** technical (only in the form's "Advanced" group or Settings → Advanced). Rule: the default view of each form shows **at most six** fields (E plus default-visible O), **not counting the type switch** (expense / income / transfer) that forms with several types carry in the sheet header. Fields marked "header switch" are the type switch. The field ids are stable keys used by `ui/prefs`.

"Today" counts the controls the current form shows, as recorded in the baseline.

## Transaction (expense / income / adjustment) — `transaction`

| Id | Field | Class | Default visible | Applies to | Notes |
|---|---|---|---|---|---|
| `tx.kind` | Type (expense / income / transfer) | E, header switch | yes | new, edit | segmented control in the sheet header, not counted; adjustment is shown as a fixed label |
| `tx.amount` | Amount | E | yes | all | numeric keyboard; currency from account |
| `tx.account` | Account | E | yes | all | defaults to last used |
| `tx.category` | Category | E | yes | expense, income | recent first; hidden for adjustment |
| `tx.when` | Date and time | E | yes | all | defaults to now |
| `tx.payee` | Payee | O | no | expense, income | datalist/combobox of existing payees |
| `tx.tags` | Tags (max 3) | O | no | expense, income | chips with a combobox that can create |
| `tx.note` | Note | O | no | all | |
| `tx.attachment` | Attachment | O | no | expense, income | |
| `tx.place` | Place (name + "Use my location") | O | no | expense, income | |
| `tx.status` | Status (pending/posted/void) | O | no | all | shown for edit when not `posted` |
| `tx.refund` | Refund | O | no | income | |
| `tx.pin` | Pin | O | no | all | |
| `tx.coordinates` | Latitude / longitude | T | no | with place | inside an "Exact coordinates" disclosure within the place field |

Default view: the type switch plus four fields (`tx.amount`, `tx.account`, `tx.category`, `tx.when`), that is five controls in total (SC-002). Today: about 15.

## Transfer — `transfer`

| Id | Field | Class | Default visible | Notes |
|---|---|---|---|---|
| `xf.from` | From account | E | yes | |
| `xf.to` | To account | E | yes | |
| `xf.amount` | Amount sent | E | yes | |
| `xf.received` | Amount received | E | yes | only when currencies differ |
| `xf.when` | Date and time | E | yes | |
| `xf.note` | Note | O | no | |
| `xf.rate` | Exchange rate / custom rate | T | no | shown when a rate is needed or in the Advanced group |

Default view: five fields (six when currencies differ).

## Account — `account`

| Id | Field | Class | Default visible |
|---|---|---|---|
| `ac.name` | Name | E | yes |
| `ac.currency` | Currency | E | yes (editable only on create) |
| `ac.kind` | Type | E | yes |
| `ac.opening` | Opening balance | E | yes |
| `ac.openingDate` | Opening balance date | O | no |
| `ac.groups` | Groups | O | no |

(Exact kind list is whatever `AccountsScreen` offers today; no new kinds.)

## Category / tag / payee — `category`

| Id | Field | Class | Default visible |
|---|---|---|---|
| `ca.name` | Name | E | yes |
| `ca.parent` | Parent category | O | no |
| `ca.direction` | Expense or income | E | yes (fixed once created) |

## Budget — `budget`

| Id | Field | Class | Default visible | Notes |
|---|---|---|---|---|
| `bu.name` | Name | E | yes | |
| `bu.limit` | Limit | E | yes | |
| `bu.period` | Period (week/month/year/custom) | E | yes | |
| `bu.start` | Start date (anchor) | E | yes | custom period: also end date |
| `bu.categories` | Categories | E | yes | primary scope |
| `bu.every` | Every N periods | O | no | |
| `bu.allocation` | Planned allocation | O | no | |
| `bu.accounts`, `bu.groups`, `bu.tags` | Other scope filters | O | no | |
| `bu.rollover` | What is left over | O | no | |

Default view: five fields (name, limit, period, start date, categories). A custom period adds an end date as a sixth.

## Goal — `goal`

| Id | Field | Class | Default visible |
|---|---|---|---|
| `go.name` | Name | E | yes |
| `go.target` | Target | E | yes |
| `go.account` | Goal account | E | yes |
| `go.date` | Target date | E | yes |

Four fields, no optional group.

## Schedule — `schedule`

Default view: the type switch plus six fields (`sc.name`, `sc.account`, `sc.amount`, `sc.category`, `sc.repeats`, `sc.begin`); `sc.toAccount` replaces `sc.category` for transfers.

| Id | Field | Class | Default visible |
|---|---|---|---|
| `sc.name` | Name | E | yes |
| `sc.kind` | Expense / income / transfer | E, header switch | yes |
| `sc.account` | Account (and `sc.toAccount` for transfers) | E | yes |
| `sc.amount` | Amount | E | yes |
| `sc.category` | Category | E | yes (not for transfers) |
| `sc.repeats` | Repeats (unit) and `sc.every` | E | yes (every is part of the same row) |
| `sc.begin` | First date | E | yes |
| `sc.note` | Note | O | no |
| `sc.end` | Last date | O | no |
| `sc.confirm` | Ask me to confirm each one | O | no |
| `sc.reminder` | Reminder | O | no |

## Fold — `fold`

| Id | Field | Class |
|---|---|---|
| `fo.name` | Fold name | E |
| `fo.currency` | Base currency | E |

## Rules enforced by tests

1. Every form field in the app is present in this table (a test scans the registry against the components' `fieldId` props).
2. For every form the count of E plus default-visible O fields, excluding the header type switch, is ≤ 6.
3. `visibleFields()` returns a hidden O or T field as visible when it has a value.
4. Changing `optionalFields[id]` in prefs changes only that field's default visibility.
5. Autofocus: the first E field of a form receives focus when the form opens (the amount for transactions).
