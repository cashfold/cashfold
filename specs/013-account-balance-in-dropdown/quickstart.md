# Quickstart: Validate Account Balances in Dropdowns

## Prerequisites
A Fold with at least: one positive account, one negative, one zero (no transactions), one in a second currency, one archived, and one account with a 60-character name.

## Run
Follow the repo's usual dev start (see the `run` skill), then run the web unit and browser tests for `apps/web`.

## Check (manual)
1. Transactions, open Filters, open the Account dropdown: each account shows name and balance matching the Accounts page.
2. Repeat in Schedules (account and transfer target), Overview (day-end chart), and Data, CSV import.
3. Negative balance reads as negative; zero account shows a zero amount; mixed currencies each show their own.
4. Narrow the window to 360px: the long name is shortened, the balance stays whole.
5. Add a transaction, reopen the dropdown: the balance has changed.
6. Keyboard only: open, arrow through, choose; a screen reader reads name and balance.
7. Switch the language to Ukrainian and Polish: no missing text.

## Expected
All seven pass; automated tests: option rendering (positive, negative, zero, null, long name), parity with the Accounts page balance, and the existing desktop listbox tests still pass.
