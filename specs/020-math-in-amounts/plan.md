# Implementation Plan: Math in Amount Fields

**Branch**: `020-math-in-amounts` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-math-in-amounts/spec.md`

## Summary

A person can type a sum (`12.50 + 3.20 * 2 + 4`) in any money field. The field keeps what was typed, shows the exact result beside it, and the result is what is saved. A plain number behaves exactly as today.

The work is one new pure function in `core` and a small change to the one component every amount field already goes through:

1. **`core` (`shared-kernel`)**: `evaluateAmount(text, currency, separators)` reads numbers with the language's marks, evaluates `+ − × ÷` and brackets over exact rationals (a numerator and a denominator, both `bigint`), and rounds once, half to even, to the currency's minor units. It returns the same `Result<Money, AmountTextError>` as `parseAmountText`, with two new error codes.
2. **Web**: `parseMoney` (`ui/ledger/format.ts`) calls it when the text contains an operator, so `ledger.parse` — which every form already calls on submit — understands sums with no change at the call sites. The two amount components (`transactions/AmountInput.tsx` and `ledger/AmountField.tsx`, which duplicate each other today) become one, which shows the result in the hint slot under the field. The transaction filter's min and max switch to it.

## Technical Context

**Language/Version**: TypeScript (strict), React in a Next.js static export

**Primary Dependencies**: none new. Existing: `Money`, `divRoundHalfEven`, `exponentOf`, `parseAmountText` rules, `fast-check` (already used for property tests)

**Storage**: none. Only the result (whole minor units) is saved, as today

**Testing**: Vitest (evaluator unit and property tests, `parseMoney`, field markup), kit browser tests with axe (light, dark, right-to-left), Playwright e2e

**Target Platform**: web app, installed web app, Electron desktop

**Project Type**: web application plus desktop shell

**Performance Goals**: evaluating on every keystroke is instant (a few hundred characters at most); no work for a plain number beyond one character scan

**Constraints**: constitution VI (bigint minor units, no floating point, one half-even rounding at the end; `check:no-float` scans the new file), strict CSP, WCAG 2.2 AA, EN/UK/PL strings, no new dependency, initial JavaScript within its budget (374,784 bytes when this plan was written; the evaluator is a lazy chunk, and the feature's remaining 0.8 KB led to raising the budget by 1 KiB, research R9)

**Scale/Scope**: one new core module and its tests, one component merged and extended, one filter changed, about 6 strings per language

## Constitution Check

- **I Zero-Knowledge**: Pass. The evaluation is local; nothing is sent.
- **II DDD / III Hexagonal**: Pass. The evaluator is a pure function in `core/shared-kernel`, next to `amount-text.ts`, with no I/O and no UI imports.
- **IV CQRS / V Event Sourcing & CRDT**: Pass. No commands or events change; the saved value is the same `bigint` as today.
- **VI Exact Money**: Pass, and the point of the design. Operands and operators work on `bigint` rationals; there is no `number`, `Math.*`, `parseFloat` or `toFixed`; the single rounding is `divRoundHalfEven` at the end.
- **VII Local-First**: Pass. Works offline.
- **VIII Security Hygiene**: Pass. A hand-written parser, no `eval` and no `Function`; input length and nesting are bounded.
- **IX Simplicity**: Pass. One function, no dependency; the two duplicate components become one.
- **Workflow**: no protocol or wire change; `docs/ledger.md` gets one short paragraph.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/020-math-in-amounts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/shared-kernel/amount-expression.ts        # NEW: evaluateAmount (its own chunk, subpath export)
packages/core/src/shared-kernel/is-amount-expression.ts     # NEW: the tiny check, in the main bundle
packages/core/src/shared-kernel/amount-expression.test.ts   # NEW: examples, errors, languages, currencies
packages/core/src/shared-kernel/amount-expression.property.test.ts   # NEW: exactness against a bigint reference
packages/core/src/shared-kernel/amount-text.ts              # share the number-reading rules (export the operand reader)
packages/core/src/index.ts                                  # export the new functions
apps/web/src/ui/ledger/format.ts (+ format.test.ts)         # parseMoney: sums when an operator is present
apps/web/src/ui/transactions/AmountInput.tsx                # the one amount component: result in the hint slot, inputMode, aria-live
apps/web/src/ui/ledger/AmountField.tsx                      # becomes a thin alias of AmountInput (callers unchanged)
apps/web/src/ui/transactions/TransactionsScreen.tsx         # filter min and max use AmountInput
apps/web/src/ui/i18n/messages/{en,uk,pl}.json               # ledger.amount.result, .invalid_expression, .division_by_zero, hint
apps/web/src/ui/transactions/AmountInput.browser.test.tsx    # NEW: axe, RTL, keyboard, no layout shift
e2e/ux-amount-math.spec.ts                                  # NEW: add sheet, transfer, budget, goal, filter, languages
docs/ledger.md                                              # one paragraph
```

**Structure Decision**: the evaluator lives in `core/shared-kernel` beside the existing amount text parser so both share the number-reading rules; the web layer only calls it and draws the result.

## Phasing

1. **Phase 1 (US1, US3)**: the evaluator with its exactness and error tests; `parseMoney`; the merged amount component with the result line; the add-transaction field. Ships on its own.
2. **Phase 2 (US2)**: the remaining money fields (all already go through the component or `ledger.parse`) and the filter; the e2e across fields and languages.
3. **Phase 3**: docs, build, bundle and full verification.

## Complexity Tracking

No constitution violations to justify.
