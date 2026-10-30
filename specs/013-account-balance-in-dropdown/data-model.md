# Data Model: Account Balance in Account Dropdowns

No new stored or synced data.

## Account option (view model, not stored)
| Field | Source | Notes |
|-------|--------|-------|
| id | `AccountRow.id` | option value |
| name | `AccountRow.name` | start side, truncates |
| currency | `AccountRow.currency` | used only to format the balance |
| balanceMinor | `AccountRow.balanceMinor` | `bigint` or `null`; `null` means show name only |

## Rules
- Balance is the same value the Accounts page shows (FR-003).
- Balances in different currencies are never combined (FR-005).
- Which accounts are offered in each dropdown is unchanged (FR-010).
