---

description: "Task list for Math in Amount Fields"
---

# Tasks: Math in Amount Fields

**Input**: Design documents from `/specs/020-math-in-amounts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests (property tests for money) and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`. Paths under `packages/core/src/` are written `core/...`. Money is `bigint` minor units; `pnpm check:no-float` scans the new core file, so it must not use `Math.*`, `parseFloat` or `.toFixed(`.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `020-math-in-amounts`, run `pnpm vitest run` once to record a green baseline, then `pnpm --filter @cashfold/web build` and `pnpm check:bundle` and write the "initial JS" size into the PR notes; later tasks must not raise it

## Phase 2: Foundational (blocks every story)

**Purpose**: the exact evaluator in `core`, which every story calls. Tests first.

- [X] T002 [P] Create `core/shared-kernel/amount-expression.test.ts` with examples (USD, 2 decimals, English marks): `12.50 + 3.20 * 2 + 4` is 2290 minor units; `(10 + 5) * 2` is 3000 and `10 + 5 * 2` is 2000; `120 - 15` is 10500; `84 / 3` is 2800; `-5 + 8` is 300; `2 x 3`, `2 × 3` and `2 * 3` are equal; spaces anywhere are ignored; `10 / 3` is 333 and `20 / 3` is 667 (rounded once, half to even, so `0.125 * 1` in USD is 12 and `0.135 * 1` is 14); `10 / 3 * 3` is 1000; `0.1 + 0.2` is 30; `0.333 * 3` is 100 (an operand may have more decimals than the currency inside a sum); currencies with 0 decimals (`JPY`: `100 / 3` is 33) and 3 decimals (`KWD`: `1 / 3` is 333); in Polish marks (`,` decimal, space group) `1 234,50 + 10,25` is 124475; in German marks (`.` group, `,` decimal) `1.234,50 + 10,25` is 124475; a plain number and a signed number are not expressions (`isAmountExpression('12.50')` and `'-5'` are false, `'5+3'`, `'(5)'` and `'2*3'` are true) and `evaluateAmount` is not used for them
- [X] T003 [P] Add the error cases to the same file: `12 +`, `+ 12 *`, `5 ++ 3` (but `5 + -3` is 200), `(`, `)`, `()`, `(1`, `1)`, `abc`, `12 $ 3`, an empty text and a text of only operators give `invalid_format`; `5 / 0` and `5 / (3 - 3)` give `division_by_zero`; `92233720368547758.07 + 0.01` in USD (the largest amount plus one minor unit) and `100000000000000000 * 10` give `out_of_range`; a text longer than 200 characters and 21 nested brackets give `invalid_format`; none of them throws
- [X] T004 Create `core/shared-kernel/amount-expression.ts` exporting `isAmountExpression(text)` and `evaluateAmount(text, currency, sep)`: receive the raw typed text (the web does not normalise it first) and tokenise operators `+`, `-`/`−`, `*`/`×`/`x`, `/`/`÷`, `(`, `)` and numbers made of digits and the language's marks (any whitespace, including the no-break space U+00A0 and the narrow no-break space U+202F, around an operator is ignored; whitespace between digit groups of one number is the group mark when the language's group mark is a space; each operand also gets today's typing leniency: where the decimal mark is a comma and the group mark is not a dot, one `.` inside an operand is read as the decimal mark, so `1.5 + 2.5` works in Polish; `-` after a digit or `)` is subtraction, otherwise a sign; `x` is multiplication only between operands); evaluate with exact rationals `{ n: bigint, d: bigint }` (`d > 0`, reduced by gcd, divide by multiplying by the reciprocal); at the end scale by `10n ** BigInt(exponentOf(currency))`, round once with `divRoundHalfEven` from `core/shared-kernel/money.ts`, then `money(...)` for the range check; limits 200 characters and 20 nested brackets; add `'division_by_zero'` to `AmountTextError` in `amount-text.ts`; no `Math.*`, `parseFloat` or `.toFixed(` (depends on T002, T003)
- [X] T005 In `core/shared-kernel/amount-text.ts` export the number-reading rule (the group and decimal handling `parseAmountText` uses) as a helper that `amount-expression.ts` reuses for each operand, so a number inside a sum is read exactly as a plain number is, including the typing leniency of `normalizeAmountText` in `ui/ledger/format.ts` (that web function keeps serving the plain-number path and is not changed); `parseAmountText` keeps its behavior and its tests unchanged; export `isAmountExpression` and `evaluateAmount` from `core/index.ts` (depends on T004)

**Checkpoint**: the evaluator is correct on its own; no UI changed yet.

## Phase 3: User Story 1 - Type a sum instead of working it out (Priority: P1) 🎯 MVP

**Goal**: In the add-transaction Amount field a person types a sum; the exact result is shown beside the field as they type, the sum stays in the field, and the result is what is saved. A plain number is unchanged.

**Independent Test**: Open the add sheet, type `12.50 + 3.20 * 2 + 4`: the note under the field reads `= 22.90 USD`; leave the field: the sum and the note stay; save: the list shows 22.90. Type `12 +` and save: nothing is saved and a message names the problem; the text is kept.

### Tests for User Story 1

- [X] T006 [P] [US1] Update `ui/ledger/format.test.ts`: `parseMoney('12.50 + 3.20 * 2 + 4', 'USD', 'en')` is 2290n; `parseMoney('1 234,50 + 10,25', 'PLN', 'pl')` is 124475n; every existing case for a plain number, a signed number, the typing leniency (`1 234,56`, `1234,56`, `1234.56`) and `too_many_decimals` for `1.239` still gives the same result; `parseMoney('1.5 + 2.5', 'PLN', 'pl')` is 400n (a dot for the decimal comma works in each operand); `parseMoney('10\u00a0+\u00a05', 'PLN', 'pl')` and the same with U+202F are 1500n; an invalid sum gives `invalid_format` and `5 / 0` gives `division_by_zero`
- [X] T007 [P] [US1] Create `ui/transactions/AmountInput.test.tsx` (server-rendered markup with a `LedgerProvider`-like context as the other field tests do): a plain number shows the static hint and no result; a valid sum shows `= 22.90 USD` (`ledger.amount.result`) in the note slot, which has `aria-live="polite"`; an invalid sum shows the error text in the same slot and the input is `invalid`; the input keeps its typed value and has `inputMode="text"`
- [X] T008 [P] [US1] Create `e2e/ux-amount-math.spec.ts` (web, skip WebKit like the other sign-up specs): sign up, create a USD account, open the add sheet, type `12.50 + 3.20 * 2 + 4` in Amount, see `= 22.90 USD`, blur the field and see the sum still in it and the note still there, save and see a transaction of 22.90 in the list; type `(10 + 5) * 2` and `10 + 5 * 2` and see 30.00 and 20.00; type `12 +`, `5 / 0` and `abc` and see a message each, Save saves nothing and the text is kept; type `12.50` and see no result line; type `1.239` and see the `too many decimals` error as before; fix one number inside a longer sum and see the rest kept and the result updated; paste `12.5+3` into the field (use the clipboard through the page) and see `= 15.50 USD`; after saving, open the transaction for editing and see the amount `22.90` and not the sum

### Implementation for User Story 1

- [X] T009 [US1] In `ui/ledger/format.ts` make `parseMoney` call `evaluateAmount` when `isAmountExpression(text)` is true (passing `separatorsFor(locale)`), and keep the current code path for everything else; map `division_by_zero` and `invalid_format` as errors of the same `MoneyTextError` shape so `ledger.parse` and `ledger.explain` need no change (depends on T005, T006)
- [X] T010 [US1] Make `ui/transactions/AmountInput.tsx` the one amount component: set `inputMode="text"`; when the text is a valid sum show `t('ledger.amount.result', { amount })` (the result formatted with `formatMoney(minor, currency, locale)`) in the existing hint slot, inside one `aria-live="polite" aria-atomic="true"` region, instead of the static hint; show the error from `ledger.amount.<code>` for an invalid sum as it does for an invalid number; never change the typed value (depends on T007, T009)
- [X] T011 [P] [US1] Add the strings to `ui/i18n/messages/en.json`, `uk.json` and `pl.json`: `ledger.amount.result` ("= {amount}"), `ledger.amount.invalid_expression`, `ledger.amount.division_by_zero`, and extend `ledger.amount.hint` with a short example of a sum ("You can also type a sum, such as 12.50 + 3.20 × 2"); keep `ui/i18n/catalogue-complete.test.ts` green
- [X] T012 [US1] Map the new error codes in `AmountInput.tsx`: `invalid_format` for a sum uses `ledger.amount.invalid_expression`, `division_by_zero` uses `ledger.amount.division_by_zero`, `out_of_range` keeps `ledger.amount.out_of_range`; confirm the add-transaction sheet (`ui/transactions/TransactionMode.tsx`) needs no change beyond the component (its submit already calls `ledger.parse(amount, currency)`) (depends on T010, T011)

**Checkpoint**: US1 works on its own: sums in the add-transaction field.

## Phase 4: User Story 2 - The same in every other amount field (Priority: P2)

**Goal**: Every money field behaves the same way; fields that are not money do not.

**Independent Test**: In each field listed in FR-002 type `100 / 4 + 5` and see `= 30.00`; save and check the stored value. In an exchange-rate, latitude or longitude field `2 + 2` is not a calculation.

### Tests for User Story 2

- [X] T013 [P] [US2] Extend `e2e/ux-amount-math.spec.ts`: type `100 / 4 + 5` and see `30.00` saved in a transfer (both amounts, with a second currency), an account's opening balance, credit limit and balance target, a budget's limit and allocation, a goal's target, a schedule's amount, and in the transaction filter's min and max (the filter then lists the matching transactions); in a JPY account (no decimals) and a KWD account (3 decimals) the result uses that currency's decimals; with Polish selected `1 234,50 + 10,25` shows `= 1 244,75 PLN`; in the exchange-rate field and the place latitude and longitude fields `2 + 2` is not turned into a result
- [X] T014 [P] [US2] Create `ui/transactions/AmountInput.browser.test.tsx` (pattern of `ui/kit/kit.browser.test.tsx`, real Chromium): axe passes in light and dark and with `dir="rtl"` for a plain number, a valid sum and an invalid sum; the note slot has the same height with the hint, the result and the error (no layout shift); the live region's text changes to the result as the value changes; keyboard use needs no extra stops

### Implementation for User Story 2

- [X] T015 [US2] Make `ui/ledger/AmountField.tsx` a thin wrapper that renders `AmountInput` with the same props (`label`, `currency`, `value`, `onChange`, `hint`, `required`), so `ui/plan/BudgetsView.tsx`, `GoalsView.tsx` and `SchedulesView.tsx` get the same behavior with no edit; add the `required` prop to `AmountInput` (depends on T012)
- [X] T016 [US2] In `ui/transactions/TransactionsScreen.tsx` replace the two `InputField`s for the filter's min and max (`ledger.filter.min`, `ledger.filter.max`) with `AmountInput` (pass the selected account's currency; with no account chosen the fields stay `disabled` and show no currency; empty means no limit; the "min is above max" error still comes from the panel's own validity check, which already calls `ledger.parse` and so understands sums, and is passed to the field's error); leave the date fields as they are (depends on T012)
- [X] T017 [US2] Check that the other money fields reach `AmountInput`: the account opening balance, credit limit and balance target in `ui/accounts/AccountsScreen.tsx` and both transfer amounts in `ui/transactions/TransferMode.tsx` already use it; confirm the exchange-rate fields (`ui/ledger/transfer/RateManager.tsx`, `ui/overview/OverviewScreen.tsx`, `ui/transactions/RatePrompt.tsx`) and the place fields keep a plain `InputField` and parse no sums (depends on T015, T016)

**Checkpoint**: US2 done with US1: every money field takes a sum.

## Phase 5: User Story 3 - Exact results, with no surprise rounding (Priority: P2)

**Goal**: Results are exact, rounded once at the end, and shown before saving; a plain number with too many decimals is still an error.

**Independent Test**: Type `0.1 + 0.2`, `10 / 3 * 3` and `10 / 3`: the notes read `= 0.30`, `= 10.00` and `= 3.33` before anything is saved; `1.239` is still refused.

### Tests for User Story 3

- [X] T018 [P] [US3] Create `core/shared-kernel/amount-expression.property.test.ts` with `fast-check`: random expressions built from small integers and decimals, the four operators and brackets, evaluated by the module in currencies with 0, 2 and 3 decimals, equal a reference computed in the test with `bigint` fractions and one half-even rounding (at least 1,000 cases per currency); `a + b - b` equals `a`; `x * y / y` equals `x` when `y` is not zero; the result of `a / b * b` equals `a` for any non-zero `b`; an expression never throws, whatever the random text
- [X] T019 [P] [US3] Add to `e2e/ux-amount-math.spec.ts`: `0.1 + 0.2` shows `= 0.30 USD`, `10 / 3 * 3` shows `= 10.00 USD`, `10 / 3` shows `= 3.33 USD` and saving it records 3.33, `20 / 3` shows `= 6.67 USD`, a result far above the supported range shows the existing "too large" message and cannot be saved, and a plain `1.239` is still refused with the `too many decimals` message

### Implementation for User Story 3

- [X] T020 [US3] Run `core/shared-kernel/amount-expression.property.test.ts` (T018) and fix anything it finds in `core/shared-kernel/amount-expression.ts` (rounding of negative results — the result of `-10 / 3` is -333 and ties go to the even neighbour in both directions — and reduction of fractions); the tests from T002 and T003 stay green (depends on T004, T018)

**Checkpoint**: US3 done with US1 and US2: results are exact in every field.

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T021 [P] Add a short paragraph to `docs/ledger.md` ("Amounts you type"): a money field accepts `+ − × ÷` and brackets; the result is exact and rounded once at the end, half to even; a plain number with too many decimals is still an error; only the result is saved; run `pnpm check:docs`
- [X] T022 Run `pnpm --filter @cashfold/web build`, `pnpm check:bundle`, `pnpm check:licenses`, `pnpm check:no-float` and confirm the initial JavaScript stays within its budget of 374,784 bytes (the figure recorded in T001 had about 1.2 KB of headroom) and that no `package.json` changed; if it does not fit, do not raise the budget: move `evaluateAmount` into a lazy chunk that `parseMoney` loads the first time `isAmountExpression` is true (parsing then waits for that chunk, which the service worker already has for offline use) and measure again
- [X] T023 Run the full verification (`pnpm typecheck`, `pnpm exec eslint apps packages e2e scripts`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, the web e2e specs `ux-amount-math`, `ux-add`, `us2-ledger`, `a11y` and `ux-responsive` on Chromium, Firefox and the RTL project) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Foundational. This is the MVP.
- **US2 (Phase 4)**: after US1 (it builds on the component).
- **US3 (Phase 5)**: after Foundational; its tests can start as soon as the evaluator exists, independent of the UI stories.
- **Polish (Phase 6)**: after the stories you ship.

### Within Each Story

- Tests first (they fail), then the implementation.
- Core: T002 and T003 before T004; T004 before T005.
- US1: T006 before T009; T007 before T010; T009 and T011 before T012.

### Parallel Opportunities

- T002 and T003 together.
- T006, T007 and T008 together; T011 alongside T009 and T010.
- T013 and T014 together; T015 and T016 together.
- T018 and T019 together; T021 alongside T022.

## Parallel Example: User Story 1

```text
Task: "Update ui/ledger/format.test.ts"
Task: "Create ui/transactions/AmountInput.test.tsx"
Task: "Create e2e/ux-amount-math.spec.ts"
Task: "Add the strings to the three catalogues"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 and Phase 2: the exact evaluator.
2. Phase 3: sums in the add-transaction field, with the result line.
3. **Stop and validate** with quickstart steps 1 to 6; ship if ready.

### Incremental Delivery

1. Foundation, then US1 (MVP).
2. US2: every other money field and the filter.
3. US3: the property tests and the rounding checks that prove the results are exact.
4. Polish, docs and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- Money stays `bigint` end to end: no `number`, `Math.*`, `parseFloat` or `toFixed` in `amount-expression.ts` (the `check:no-float` script fails the build otherwise).
- A text with no operator must follow today's code path exactly, including `too_many_decimals` for a plain `1.239`.
- Avoid: `eval` or `Function`, a math library, storing or syncing the expression, changing exchange-rate or coordinate fields, and raising the bundle budget.
