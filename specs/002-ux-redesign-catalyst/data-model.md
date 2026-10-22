# Data Model: Interface Preferences and View Models

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

This feature adds **no domain data, no events, no projections and no wire or database schema changes** (FR-048). The domain model of [spec 001](../001-secure-finance-core/data-model.md) is untouched. What it adds is client-only presentation state.

Everything here is **device-local presentation state**: it lives in the browser on this device, is never encrypted into the Fold, never synced, never exported (FR-051), and contains no financial content. Losing it only resets the interface to defaults.

## 1. Interface Preferences (`cashfold.ui`)

One JSON object in `localStorage`, parsed defensively (R-UX-08). Unknown keys are dropped. Invalid values fall back per field. A missing or unreadable store gives all defaults.

| Field | Type | Default | Used by | Notes |
|---|---|---|---|---|
| `v` | `1` | `1` | all | Schema version. A higher unknown version is ignored and defaults are used (never overwritten until the person changes something). |
| `theme` | `'system' \| 'light' \| 'dark'` | `'system'` | FR-041 | Applied by the pre-paint script and the `ThemeProvider`. |
| `moreDetailsOpen` | `boolean` | `false` | FR-020, FR-021 | Add sheet "More details" remembered open/closed. |
| `optionalFields` | `Record<FieldId, boolean>` | per field registry default | FR-021 | Which optional fields the add form shows by default. Keys are field ids from `contracts/form-fields.md`; unknown ids are ignored. |
| `overview.period` | `PeriodChoice` | `{ kind: 'thisMonth' }` | FR-015 | See below. A `custom` value stores two ISO dates only. |
| `overview.collapsed` | `OverviewSectionId[]` | `[]` | FR-017 | Ids of collapsed secondary sections. |
| `plan.view` | `'budgets' \| 'goals' \| 'schedules'` | `'budgets'` | FR-030 | Last used Plan view. |
| `recents.account` | `Record<FoldId, AccountId>` | `{}` | FR-022 | Last account used in the add form, per Fold. |
| `recents.categories` | `Record<FoldId, CategoryId[]>` | `{}` | FR-022 | Most recently used category ids, newest first, capped at 8. |
| `hints.dismissed` | `HintId[]` | `[]` | FR-038 | One-time hints already dismissed. |
| `firstRun.dismissed` | `boolean` | `false` | FR-036 | Checklist dismissed. |
| `lists.showArchivedAccounts` | `boolean` | `false` | FR-028 | Persisted toggle. |

`PeriodChoice` is one of: `thisMonth`, `lastMonth`, `thisYear`, `lastYear`, `last30`, `last90`, `all`, or `{ kind: 'custom', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`. For `custom` both dates must be valid and `from <= to`, otherwise the field falls back to the default.

### Validation and bounds

- Total serialised size ≤ 4 KiB. Writers drop the oldest `recents` entries first when exceeding it.
- `recents.*` hold identifiers only. They are validated against the current Fold's accounts and categories at use time. An id that no longer exists is ignored and pruned on the next write.
- Ids and dates are the only values that are not booleans or enums. The plaintext-leak scan asserts that the stored value matches the schema and contains no amount, name, email or note text.

### Lifecycle

| Event | Behaviour |
|---|---|
| First visit | No key exists: defaults apply, nothing is written until the person changes a preference. |
| Change | Immediate write (debounced 0 ms), `storage` event updates other tabs. |
| Storage unavailable / quota / parse error | Defaults apply for the session. Writes are skipped silently. No error UI. |
| Sign out / lock | Preferences are kept (they are not secret). "Reset interface settings" in Settings → Appearance clears the key. |
| Account deletion on this device | The key is removed along with the other local data. |
| Schema change (future) | `v` is bumped and a pure `migrate(prev)` function maps old to new. A test fixture per version is kept. |

## 2. Field Registry (compile-time, not stored)

A static table describing each form field, used by `visibleFields()`:

| Property | Meaning |
|---|---|
| `id` | Stable id, e.g. `tx.payee`. |
| `form` | `transaction`, `transfer`, `account`, `budget`, `goal`, `schedule`, … |
| `class` | `essential`, `optional` or `technical` (FR-009). |
| `defaultVisible` | For optional fields, whether shown without expanding "More details" when the person has not chosen. |
| `appliesTo` | Predicate on form state (e.g. refund only for income). |
| `hasValue(values)` | Used for the hidden-but-filled rule. |

The full table is in [contracts/form-fields.md](contracts/form-fields.md).

### `visibleFields(form, prefs, values, mode)`

Pure function. Returns the ordered list of fields to render and a flag whether a "More details" group exists.

Rules:
1. Essential fields are always visible.
2. Optional fields are visible when `prefs.optionalFields[id]` is true (or `defaultVisible` if unset) **or** when `hasValue(values)` is true (editing an entry that already holds a value, FR-021 / edge case).
3. Optional fields that are not visible are rendered inside the collapsed "More details" group. If `prefs.moreDetailsOpen` is true or `mode` is `edit` and any of them has a value, the group is open.
4. Technical fields appear only in the "Advanced" group of that form or in Settings → Advanced, never in the default view.
5. The default view (essential + default-visible optional) MUST NOT exceed 6 fields per form (FR-009); a unit test iterates the registry and fails if it does.

## 3. View Models

Derived in the UI from existing query results. None is stored.

| View model | Built from | Fields |
|---|---|---|
| `HeadlineFigures` | `ledger.dashboard` result | `income`, `expenses`, `net`, `totalBalance`, `currency`, `period`, `activeOptions` (adjustments/transfers non-default). |
| `DayGroup` | rows from `ledger.transactions` | `localDate`, `rows`, `netMinor` (sum of loaded rows, signed), `partial` (true when more rows exist beyond the loaded page and may belong to this date). |
| `FilterChip` | applied filters | `id`, `label`, `remove()`. Built from the URL query. |
| `PlanCard` | budgets / goals / schedules queries | `title`, `progress` (0–1 or none), `statusText`, `statusTone`, `figures`. Status text is always present. |
| `NavSection` | static route table | `id`, `labelKey`, `href`, `icon`, `match(pathname)`. |
| `EmptyStateSpec` | static per list | `icon`, `titleKey`, `bodyKey`, `actionKey`, `actionHref | actionEvent`. |

### `DayGroup.partial` rule

Rows are fetched newest first with `offset 0, limit n`. A group is `partial` only for the **last** group while `rows.count > rows.items.length`. Its net total shows with a "so far" qualifier and no other group is partial. This keeps displayed totals honest without a new query.

## 4. Theme state

`ThemeProvider` exposes `{ choice: 'system'|'light'|'dark', resolved: 'light'|'dark', setChoice }`. `resolved` is what the `data-theme` attribute holds. In `system`, it follows `matchMedia('(prefers-color-scheme: dark)')` live.

## 5. State relationships

```text
cashfold.ui (localStorage) ──read/write──> ui/prefs ──> ThemeProvider ──> <html data-theme>
                                              │
                                              ├──> visibleFields() ──> AddSheet and other forms
                                              ├──> OverviewScreen (period, collapsed)
                                              ├──> PlanScreen (view)
                                              └──> recents (account, categories) ──> AddSheet defaults
Core Worker (existing, unchanged) ──queries──> view models ──> screens
```

There is no path from `ui/prefs` into the Core Worker, the event log, the sync layer or the export.
