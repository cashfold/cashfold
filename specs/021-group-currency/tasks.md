---

description: "Task list for A Currency for Each Account Group"
---

# Tasks: A Currency for Each Account Group

**Input**: Design documents from `/specs/021-group-currency/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests (property tests for money) and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`; paths under `packages/core/src/` are written `core/...`. Money is `bigint` minor units; `pnpm check:no-float` scans `core/ledger/application/group-totals.ts`, so it must not use `Math.*`, `parseFloat` or `.toFixed(`. The bundle has little headroom (see plan, Constraints): keep the web code small and reuse existing components.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `021-group-currency`, run `pnpm vitest run` once to record a green baseline, then `pnpm --filter @cashfold/web build` and `pnpm check:bundle` and write the "initial JS" size into the PR notes (budget 375,808 bytes; later tasks must not exceed it and the plan says not to raise it again; if the new UI does not fit, split the note and link into a lazy component, research R6)

## Phase 2: Foundational (blocks every story)

**Purpose**: the optional `currency` field of the group record and its read model, which both stories use.

- [X] T002 [P] Add to `core/ledger/domain/records.test.ts`: a group record with `GROUP_FIELD.currency` (5) set to `'EUR'` decodes to `currency: 'EUR'`; a group record without it decodes to `currency: null`; a value that is not text (a number) decodes to `null`
- [X] T003 In `core/ledger/domain/tables.ts` add `currency: 5` to `GROUP_FIELD` (`{ name: 1, icon: 2, color: 3, sortOrder: 4, currency: 5 }`) with a comment that it is optional, text, and absent for groups made before spec 021 (they read as the Fold's currency); in `core/ledger/domain/records.ts` add `readonly currency: string | null;` to `AccountGroup` and read it in `decodeGroup` with `f.nullableText(GROUP_FIELD.currency) ?? null`; fix every place that builds an `AccountGroup` literal (`core/testing/ledger-fixtures.ts`, tests, `ui/accounts/*.test.*` fixtures) by adding `currency: null` (depends on T002)

**Checkpoint**: a group can carry a currency in memory; nothing writes or shows it yet.

## Phase 3: User Story 1 - Give a group a currency (Priority: P1) 🎯 MVP

**Goal**: A group is created with a currency (the Fold's unless another is chosen), the currency can be changed in the rename sheet, and it is kept, synced and backed up.

**Independent Test**: Create a group: its currency starts as the Fold's. Change it to another currency, restart: the choice is kept. Open a group made before this feature: it shows the Fold's currency. Change it on one device: the other shows it after sync.

### Tests for User Story 1

- [X] T004 [P] [US1] Add to `core/ledger/application/account-commands.test.ts`: `createAccountGroup` without a currency stores the Fold's base currency in field 5; with `currency: 'EUR'` stores `'EUR'`; with `currency: 'ZZZ'` is refused with `unknown_currency` and writes nothing; `updateAccountGroup` with `currency: 'PLN'` changes only field 5 (name, color, sort order unchanged) and with an unknown currency is refused; an update that does not mention the currency leaves it as it was; a group made without field 5 (an older device) and then renamed keeps reading as `null`; in `core/sync/application/backup.test.ts` back up a Fold that holds a group with field 5 set to `'EUR'` and restore it into another Fold: the restored group reads `'EUR'`, and restoring a group record that has no field 5 gives a group that reads `null` (the Fold's currency)
- [X] T005 [P] [US1] Update `ui/accounts/GroupDialogs.test.tsx` (`GroupFormView` markup): the form has the name field and a labelled "Currency" select (`ledger.groups.currency`) with the given currency selected, in create mode and in rename mode; the Save button is the same one; an unknown or empty currency cannot be chosen
- [X] T006 [P] [US1] Create `e2e/ux-group-currency.spec.ts` (web, skip WebKit like the other sign-up specs): sign up (USD); on Accounts add a group "Savings": the Currency select starts as USD; choose EUR and save; reopen the sheet from the group's menu and see EUR; change it to PLN and see PLN after a reload; a second browser context for the same account (the pattern of `e2e/us4-sync.spec.ts`) shows PLN after sync; create a group in a Polish-language session (`language.spec.ts` pattern) and see the label "Waluta"

### Implementation for User Story 1

- [X] T007 [US1] In `core/ledger/application/account-commands.ts` change `createAccountGroup` to accept `currency?: string` (default: the Fold's `ledger.baseCurrency`, else `'USD'`), validate it with `parseCurrency` (error `unknown_currency`), and write `[GROUP_FIELD.currency, currency]`; change `updateAccountGroup` to accept `currency?: string`, validate it the same way and set `GROUP_FIELD.currency` only when given; keep every other field and error as they are (depends on T003, T004)
- [X] T008 [US1] In `ui/accounts/GroupDialogs.tsx` add a `currency` prop and `onCurrencyChange` to `GroupFormView` rendering a `SelectField` (label `t('ledger.groups.currency')`) with the same currency options the account form offers (`ui/accounts/AccountsScreen.tsx`, the `ledger.accounts.form.currency` select; extract the option list into one small shared constant if it is not already shared); in `GroupFormDialog` keep a `currency` state (the group's currency, else `ledger.basics?.baseCurrency ?? 'USD'`, the same source the Accounts page uses to resolve a group's currency) and pass it to `ledger.run('ledger.createGroup', { name, currency })` and `ledger.run('ledger.updateGroup', { id, name, currency })`; pass the group's current currency to the dialog from `ui/accounts/GroupManager.tsx` and `AccountsScreen.tsx` where the dialog is opened (depends on T005, T007)
- [X] T009 [P] [US1] Add the strings to `ui/i18n/messages/en.json`, `uk.json` and `pl.json`: `ledger.groups.currency` ("Currency", "Валюта", "Waluta"); keep `ui/i18n/catalogue-complete.test.ts` green (depends on T008)

**Checkpoint**: US1 works on its own: a group has a currency that is chosen, kept and synced (nothing converts yet).

## Phase 4: User Story 2 - See each group in its own currency on the Accounts page (Priority: P1)

**Goal**: In the group view, a group's subtotal is one amount in the group's currency, and an account in another currency also shows its balance converted to it, with the rates used.

**Independent Test**: A group in EUR with a EUR account of 100.00, a USD account of 50.00 and a PLN account of 200.00, with rates known for USD and PLN: one subtotal in EUR equal to 100.00 plus the converted USD and PLN, each foreign row shows its "≈" figure, and a line says which rates were used.

### Tests for User Story 2

- [X] T010 [P] [US2] Create `core/ledger/application/group-totals.test.ts` for `groupBalances` with fixtures built from `core/testing/ledger-fixtures.ts`: all accounts in the group's currency (the subtotal is the plain sum and no rate is used); EUR group with USD and PLN accounts and rates (each converted figure equals `convert` with `nearestPrior` rates at the end of the day, and the subtotal equals the sum of the converted figures); the USD pivot (a USD account in an EUR group, an EUR account in a USD group); an account in a currency that is neither pivot nor group; a negative balance (a credit card) keeps its sign; a balance of `null` is skipped; the rate date returned for each row; archived accounts are not special here (the caller filters them); an amount that converts outside the signed 64-bit range sets `overflow` and gives that account `converted: null`; the same result whatever the order of the accounts; the result equals the Overview's `netWorth` for the same accounts and rates when the group's currency is the base currency
- [X] T011 [P] [US2] Create `core/ledger/application/group-totals.property.test.ts` with `fast-check`: for random accounts (currencies among USD, EUR, PLN, JPY, KWD), balances (including negative), rates and a group currency, the subtotal equals the sum of the rows' converted figures, every converted figure equals the reference `convert` of `nearestPrior` rates computed in the test, and the result does not depend on the order of the accounts (at least 1,000 cases)
- [X] T012 [P] [US2] Update `ui/accounts/account-sections.test.ts`: for the group view with groups of mixed currencies and a `rates` list, a group section carries the converted subtotal, the per-account converted figures and the rate date; a group of one currency matching its own gives the plain sum; the Ungrouped section and the by-type view keep their per-currency `totals` and have no conversion; a group with no accounts has no subtotal; the subtotal is computed from the accounts it is given, so with archived accounts left out (the page's switch off) it adds up to the rows shown, and with them included (switch on) it adds up to all of them
- [X] T013 [P] [US2] Update `ui/accounts/GroupSection.test.tsx` (server-rendered markup): a converted section shows one subtotal `Amount` in the group's currency with the rates date ("Converted at rates from …") in its tooltip; an Ungrouped section still shows one figure per currency; Privacy mode masks the converted figures (they are `Amount`s)
- [X] T014 [P] [US2] Extend `e2e/ux-group-currency.spec.ts`: create accounts "Euro" (EUR 100.00), "Dollar" (USD 50.00) and "Zloty" (PLN 200.00); enter EUR and PLN rates through the rates screen (the helper used by `e2e/us3-fx.spec.ts` or the rates form at Settings → Data) so the three currencies have a rate; add a group "Savings" in EUR holding the three; in the group view see one subtotal in EUR equal to the exact sum of the converted figures shown on the rows (compute the expected value in the test from the entered rates), a "≈" figure on the Dollar and Zloty rows and none on the Euro row, and the rates date in the subtotal's tooltip; change the group's currency to PLN and see the subtotal and figures follow while the accounts keep their balances; the Ungrouped section and the by-type view show no conversion; turn Privacy mode on and see the figures hidden

### Implementation for User Story 2

- [X] T015 [US2] Create `core/ledger/application/group-totals.ts` exporting `groupBalances({ accounts, groupCurrency, rates, asOfUtcS })` as in `contracts/ui-contract.md` §2: for an account in the group's currency its converted figure is its balance; otherwise take `nearestPrior(rates, currency, asOfUtcS)` for the account's currency and for the group's currency (USD is the pivot, `PIVOT_RATE`), then `convert(money, groupCurrency, from, to)` from `core/shared-kernel/fx`, rounded once; a currency without a rate goes into `missing` (the account's currency, or the group's when it is the one without a rate) and that account gets `converted: null`; `balanceMinor === null` accounts are skipped; an out-of-range conversion sets `overflow`; the subtotal is the sum of the converted figures (`null` when none could be converted); return each row's rate date; no `Math.*`, `parseFloat` or `.toFixed(`; export it from `core/index.ts` (depends on T010, T011, T003)
- [X] T016 [US2] In `ui/accounts/account-sections.ts` give `AccountSection` for groups a `converted` part (`{ currency, subtotal, rows by account id, ratesFrom, missing }`) built with `groupBalances` from the page's `accounts`, the group's resolved currency (`group.currency ?? basics.baseCurrency ?? 'USD'`), `basics.rates` and the end of today (`endOfDayUtcS(todayLocal())`, with `endOfDayUtcS` from `@cashfold/core` and `todayLocal` from `ui/ledger/dates`); pass `rates` and `baseCurrency` into `accountSections`; leave Ungrouped and the type view exactly as they are (depends on T012, T015)
- [X] T017 [US2] In `ui/accounts/GroupSection.tsx` draw one subtotal `Amount` in the group's currency (keeping `data-testid="group-subtotal"`), with the rates date "Converted at rates from {date}" (`ledger.groups.ratesFrom`) in the tooltip of the subtotal, and no subtitle or separate rates line; in `ui/accounts/AccountsScreen.tsx` add to an account row whose currency differs from its group's a second figure "≈ {amount}" (`ledger.groups.converted`, `data-testid="account-converted"`, the amount through `Amount`, with a `title` giving the rate date) next to the account's own balance, laid out so a narrow window and large text still fit; the approximate nature is in the text, not in color (depends on T013, T016)
- [X] T018 [P] [US2] Add the strings to the three catalogues: `ledger.groups.converted`, `ledger.groups.ratesFrom` (English: "≈ {amount}", "Converted at rates from {date}"; Ukrainian and Polish equivalents); `ledger.groups.converted` may be the same in all languages and then belongs in the "nothing but placeholders and symbols" list of `ui/i18n/catalogue-complete.test.ts` (depends on T017)

**Checkpoint**: US2 done with US1: one converted subtotal per group, with the rates used.

## Phase 5: User Story 3 - Say plainly when a rate is missing (Priority: P2)

**Goal**: A group never shows a total that silently leaves an account out, and never shows zero when nothing can be converted.

**Independent Test**: A group in EUR with a USD account and no USD rate: the subtotal counts only what can be converted, a note names USD with a link to enter rates, and entering the rate updates the page; with no convertible account the subtotal reads "No total yet".

### Tests for User Story 3

- [X] T019 [P] [US3] Extend `core/ledger/application/group-totals.test.ts`: one account without a rate gives `converted: null` for it, a subtotal of the others and `missing: ['USD']`; all foreign accounts without rates and a group with only them gives `subtotal: null` (not zero) and `missing`; a missing rate for the group's currency itself (not USD, no rate) puts the group's currency in `missing` and converts nothing foreign; two missing currencies are sorted; a rate entered later (a rates list with the rate) removes it from `missing`
- [X] T020 [P] [US3] Extend `ui/accounts/GroupSection.test.tsx` and `ui/accounts/account-sections.test.ts`: a partial section shows the subtotal of the converted accounts, the note "Left out: no exchange rate for USD" in an element with `role="status"` and a link "Enter rates"; a section with nothing convertible shows "No total yet" and no zero; the account row of the missing account shows its own balance and "no rate" in place of the "≈" figure; a section with `overflow` shows "Too large to convert" (`ledger.groups.tooLarge`) instead of a wrong figure
- [X] T021 [P] [US3] Extend `e2e/ux-group-currency.spec.ts`: a group in EUR with a USD account and no USD rate shows the note naming USD, the row's own balance and "no rate"; with only that account the subtotal reads "No total yet" and not 0.00; follow "Enter rates", enter the USD rate, come back and see the converted figure and the subtotal with the note gone; an axe check passes in the light and dark themes with the note shown

### Implementation for User Story 3

- [X] T022 [US3] In `ui/accounts/account-sections.ts` carry `missing` and the per-row `converted: null` through; in `ui/accounts/GroupSection.tsx` show, when `missing` is not empty, a `role="status"` note ("Left out: no exchange rate for {currencies}", `ledger.groups.leftOut`) with a link "Enter rates" (`ledger.groups.enterRates`) to the screen where exchange rates are entered (the same destination the Overview's missing-rates action uses, `ui/overview/OverviewScreen.tsx`), and when the subtotal is `null` replace the figure by "No total yet: exchange rate needed for {currencies}" (`ledger.groups.noTotal`) in the existing `ledger.groups.subtotalUnavailable` style; when `overflow` is set show "Too large to convert" (`ledger.groups.tooLarge`) in place of the figure, never a wrong number; in `ui/accounts/AccountsScreen.tsx` show "no rate" (`ledger.groups.noRate`) on a row whose conversion is missing (depends on T019, T020, T017)
- [X] T023 [P] [US3] Add the strings `ledger.groups.leftOut`, `ledger.groups.enterRates`, `ledger.groups.noTotal`, `ledger.groups.noRate`, `ledger.groups.tooLarge` to the three catalogues (depends on T022)

**Checkpoint**: US3 done with US1 and US2: a missing rate is never hidden.

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Update `docs/ARCHITECTURE.md` (the account group record in section 3: field 5 `currency`, optional, absent means the Fold's currency) and `docs/ledger.md` (one paragraph "Group currency": what it is, that it only changes how a group is displayed, the conversion rule shared with the Overview, and the missing-rate behavior); run `pnpm check:docs`
- [X] T025 Run `pnpm --filter @cashfold/web build`, `pnpm check:bundle`, `pnpm check:licenses`, `pnpm check:no-float` and confirm the initial JavaScript is within the 375,808-byte budget; if it is not, do not raise the budget: move the missing-rate note and the converted-figure code into a lazy component (research R6) and measure again
- [X] T026 Run the full verification (`pnpm typecheck`, `pnpm exec eslint apps packages e2e scripts`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, the web e2e specs `ux-group-currency`, `ux-account-groups`, `ux-accounts`, `ux-account-balances`, `a11y`, `ux-responsive` and `language` on Chromium, Firefox and the RTL project) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story. T003 needs T002.
- **US1 (Phase 3)**: after Foundational. This is the MVP.
- **US2 (Phase 4)**: after Foundational; it can start in parallel with US1 for the core function (T010, T011, T015), but the page work (T016, T017) shows groups with a currency, so finish US1 first for a clean demo.
- **US3 (Phase 5)**: after US2 (it extends the same section and function).
- **Polish (Phase 6)**: after the stories you ship.

### Within Each Story

- Tests first (they fail), then the implementation.
- US1: T004 → T007; T005 → T008; T008 → T009.
- US2: T010 and T011 → T015 → T016 → T017 → T018; T012 before T016; T013 before T017.
- US3: T019 and T020 → T022 → T023.

### Parallel Opportunities

- T002 alone; then T004, T005 and T006 together.
- T010, T011, T012, T013 and T014 together.
- T019, T020 and T021 together.
- T024 alongside T025.

## Parallel Example: User Story 2

```text
Task: "Create core/ledger/application/group-totals.test.ts"
Task: "Create core/ledger/application/group-totals.property.test.ts"
Task: "Update ui/accounts/account-sections.test.ts"
Task: "Update ui/accounts/GroupSection.test.tsx"
Task: "Extend e2e/ux-group-currency.spec.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 and Phase 2: the optional record field.
2. Phase 3: choose, keep and sync a group's currency.
3. **Stop and validate** with quickstart steps 3 and 8; ship if ready (a group has a currency, nothing converts yet).

### Incremental Delivery

1. Foundation, then US1 (a group has a currency).
2. US2: the converted subtotal, the "≈" figures and the rates date in tooltips.
3. US3: the missing-rate note and "No total yet".
4. Polish, docs and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- The conversion must follow the Overview's rule exactly (`nearestPrior` at the end of the day, `convert`, one half-even rounding per account); do not write a second rule.
- The currency is a display choice only: do not touch an account's currency, a balance, a transaction, a budget's scope or an export.
- Avoid: a new dependency, a migration or a SQL change, converting in the Ungrouped section or the by-type view, showing zero when nothing converts, and raising the bundle budget.
