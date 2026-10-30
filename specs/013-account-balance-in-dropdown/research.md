# Research: Account Balance in Account Dropdowns

## Where the balance comes from
- **Decision**: Read `balanceMinor` from the account rows in the existing ledger basics.
- **Rationale**: `AccountRow` already carries `balanceMinor` (posted balance today, or null if it exceeds 64 bits), the value the Accounts page shows, so FR-003 holds by construction and no new query is needed.
- **Alternatives**: a new balance query (duplicate work, risk of drift); computing in the screens (breaks the rule that balance logic stays in `core`).

## Scope
Single-choice account dropdowns only. The budget form's multi-select account picker is out of scope (see spec edge cases).

## Where the dropdowns are
Account dropdowns: transaction form, transfer form (from and to), Transactions filters, Schedules (account and transfer target), Overview day-end chart, CSV import. The account form's kind, currency and group selects are not account pickers and stay unchanged.

## Option layout
- **Decision**: One shared `AccountOption` renders name on the start side (truncating) and the balance on the end side (never truncated, tabular numerals), using the kit `Amount` for formatting and its existing gain/loss colouring.
- **Rationale**: Satisfies FR-004, FR-006, FR-007 and the narrow-screen criterion SC-006 with one implementation.
- **Alternatives**: balance in parentheses after the name (long names push it out of view); separate per-screen markup (inconsistent).

## Closed control
- **Decision**: The closed control renders the same content as the chosen option, so it also shows the balance; the name truncates first.
- **Rationale**: Headless UI renders the selected option's content in the button, so this costs nothing and keeps a person aware of the balance after choosing. Spec allows but does not require this.
- **Alternatives**: name only when closed (needs a second render path for no clear benefit).

## Currency in the label
Dropdowns that show `Name (CUR)` today drop the bracket, because `Amount` already shows the currency (FR-007).

## Unavailable balance
When `balanceMinor` is null, show the name only, with no wrong amount (existing "Balance unavailable" wording is reused as the accessible text).

## Accessibility
Option text is "Name, balance" so a screen reader announces both; the balance is real text, not an image or tooltip. Colour is never the only sign of a negative amount (the sign or minus is in the text).

## Account group and other lists
Not touched (spec edge case).
