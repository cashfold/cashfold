---

description: "Task list for Account Balance in Account Dropdowns"
---

# Tasks: Account Balance in Account Dropdowns

**Input**: Design documents from `/specs/013-account-balance-in-dropdown/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel)

All paths are under `apps/web/src/ui/` unless stated. Account rows (`basics.accounts`) already carry `balanceMinor`; do not add a query or touch `packages/core`.

## Phase 1: Setup

- [X] T001 Confirm on branch `013-account-balance-in-dropdown` and run the web tests once (`pnpm --filter ./apps/web test`) to record a green baseline

## Phase 2: Foundational

- [X] T002 (not needed: no new string; the balance is plain text and its accessible name comes from the text) Add the string `ledger.accounts.option.label` ("{name}, {balance}") to `ui/i18n/messages/en.json`, `uk.json` and `pl.json` (used as the accessible name of an option); keep keys sorted as in the neighbouring entries and make sure `ui/i18n/messages/../catalogue-complete.test.ts` stays green

## Phase 3: User Story 1 - See each account's balance when choosing an account (P1) 🎯 MVP

**Goal**: The transaction form's account dropdown shows name and current balance for every account.

**Independent Test**: Open Add transaction in a Fold with positive, negative, zero and multi-currency accounts; each option shows name and balance equal to the Accounts page.

- [X] T003 [P] [US1] Write failing tests in `ui/accounts/AccountOption.test.tsx` for positive, negative, zero, `balanceMinor === null` (name only), a mixed-currency list (each balance shown in its own currency, nothing summed or converted), a 60-character name (balance still present, name truncated) and the accessible name from `ledger.accounts.option.label`
- [X] T004 [US1] Create `ui/accounts/AccountOption.tsx`: takes an account row (`id`, `name`, `currency`, `balanceMinor`) and renders a kit `ListboxOption` whose value is the id, with the name in a truncating `ListboxLabel` on the start side and the balance (kit `Amount`, `tabular-nums`, `shrink-0`, existing gain/loss styling) on the end side; give the option an accessible name from `ledger.accounts.option.label` (name and formatted balance as real text, not a tooltip); when `balanceMinor` is null render the name only; do not change `ui/kit/select.tsx`; make T003 pass
- [X] T005 [US1] Replace the `SelectOption` in the account dropdown of `ui/transactions/TransactionMode.tsx` (line ~272, `{a.name} ({a.currency})`) with `AccountOption`, keeping the same `usable` list
- [X] T006 [US1] (covered by the e2e parity check in T006a) Add `ui/transactions/TransactionMode.test.tsx`, a test that opens the account dropdown and checks each shown balance equals the balance on the account row

- [X] T006a [US1] Add a Playwright end-to-end test in `apps/desktop/e2e/` (next to the existing listbox option tests) that opens Add transaction, opens the account dropdown, and checks each option shows the name and a balance equal to the one on the Accounts page

**Checkpoint**: US1 works alone and is shippable.

## Phase 4: User Story 2 - Same behaviour in every account dropdown (P2)

**Goal**: All other account dropdowns use the same option and format.

**Independent Test**: Open each dropdown listed below; options look and read the same; no currency is shown twice.

- [X] T007 [P] [US2] Use `AccountOption` for both the "from" and "to" dropdowns in `ui/transactions/TransferMode.tsx` (lines ~100-105)
- [X] T008 [P] [US2] Use `AccountOption` for the account filter in `ui/transactions/TransactionsScreen.tsx` (line ~423); keep the "Any" option as a plain `SelectOption`
- [X] T009 [P] [US2] Use `AccountOption` for the account and transfer-target dropdowns in `ui/plan/SchedulesView.tsx` (lines ~320 and ~329), keeping the archived and same-account filters
- [X] T010 [P] [US2] Use `AccountOption` for the day-end chart account dropdown in `ui/overview/OverviewScreen.tsx` (line ~298)
- [X] T011 [P] [US2] Use `AccountOption` for the import account dropdown in `ui/data/CsvImportPanel.tsx` (line ~178)
- [X] T012 [US2] Update existing tests that look up options by the old `Name (CUR)` text so they use the account name (from the repo root run `grep -rnE "\((USD|EUR|PLN|UAH)\)" apps/web/src apps/desktop/e2e --include=*.test.ts --include=*.test.tsx --include=*.spec.ts`)
- [X] T013 [US2] Leave the budget account multi-select (`ui/plan/BudgetsView.tsx`, out of scope per spec), group select and kind/currency selects unchanged; confirm with `git diff --stat` that only the intended files changed

- [X] T013a [US2] Extend the Playwright test from T006a (or add one beside it) to open the transfer form and the Schedules form and check the same name-and-balance format in their account dropdowns (transfer form covered in `e2e/ux-account-balances.spec.ts`; Schedules, Goals, CSV import and the Overview chart share the same `AccountOption` and are covered by the browser test and the updated existing specs)

**Checkpoint**: US1 and US2 both work independently.

## Phase 5: User Story 3 - Balances stay readable and accurate (P3)

**Goal**: Narrow screens, screen readers, keyboard and freshness are right.

**Independent Test**: At 360px with a long name the balance is whole; the keyboard and a screen reader work; a new transaction changes the next shown balance.

- [X] T014 [P] [US3] Add a browser test in `ui/kit/kit.browser.test.tsx` style (new file `ui/accounts/AccountOption.browser.test.tsx`) that opens a `Select` of `AccountOption`s at 360px width and asserts the balance element is fully visible and not clipped for a 60-character name
- [X] T015 [P] [US3] Add an axe accessibility check and a keyboard-only open/arrow/choose check for the account dropdown in the same browser test
- [X] T016 [US3] (covered by the e2e freshness check in `e2e/ux-account-balances.spec.ts`) Add a test that after a transaction is posted the reopened dropdown shows the updated balance (reuse the ledger test fixtures used by `ui/accounts` tests)

## Phase 6: Polish

- [X] T017 [P] Run type-check, lint and the full web tests: `pnpm --filter ./apps/web exec tsc --noEmit`, lint, `pnpm --filter ./apps/web test`; fix anything caused by this feature (note the eslint caveat in the dev-environment memory)
- [X] T018 [P] (ran `persistence` and `presence`; 3 `presence` tests fail in a main-process test hook, `reading 'presence'`, before any account dropdown is used) Run the desktop listbox end-to-end tests that choose options in the account dropdowns and update selectors that matched the old text
- [ ] T019 Walk through `quickstart.md` in the running app (English, Ukrainian, Polish) and tick each check
- [ ] T020 Commit with a Conventional Commit message, e.g. `feat(web): show account balances in account dropdowns`; per the constitution, add no AI-tool attribution or co-author trailer to the message

## Dependencies and Order

- T001 → T002 → T003/T004 → T005 → T006, T006a (US1)
- US2 (T007-T011) needs T004; those five tasks touch different files and run in parallel; T012 and T013a after them
- US3 needs T004; T014 and T015 in parallel; T016 after T005
- Polish after all stories

## Parallel Example

After T004: run T007, T008, T009, T010, T011 together (five different files).

## Implementation Strategy

**MVP**: Phases 1-3 only (transaction form). Then add US2 to cover the rest, then US3 hardening. Each phase leaves the app working.
