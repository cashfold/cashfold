# Research: Math in Amount Fields

What was found in the repository, the decision, and what else was considered.

## R1. How money text is read today

**Finding**: `parseAmountText` (`core/shared-kernel/amount-text.ts`) reads one signed number with the language's group and decimal marks, requires well-formed groups (`1,234` but not `1,23`), refuses more decimals than the currency has (`too_many_decimals`) and returns a `Money` (a `bigint` of minor units, range-checked). The web wraps it as `parseMoney` (`ui/ledger/format.ts`), which first normalises the typing leniency (an ordinary or no-break space as the group mark, a dot for a decimal comma where that is unambiguous). `ledger.parse` is that function, and every form calls it on submit: the add-transaction sheet, transfers, budgets, goals, schedules, the account opening balance and balance target. The transaction filter's min and max call it too, through plain text inputs.

**Decision**: add the sums to `parseMoney`. Every caller then understands them with no change.

## R2. Where the evaluator lives and how it computes

**Decision**: a new pure module `core/shared-kernel/amount-expression.ts`.

- **Tokenise**: operators are `+`, `-`/`−`, `*`/`×`/`x`, `/`/`÷`, `(` and `)`. A number is a run of digits and the language's marks. Whitespace between a digit and an operator is ignored; whitespace between digit groups is read as the group mark when the language uses a space (`1 234,50 + 10,25` in Polish).
- **Evaluate** with exact rationals: a value is `{ n: bigint, d: bigint }` with `d > 0` and reduced by the gcd. `+ − ×` are exact, `÷` multiplies by the reciprocal (division by zero is an error), brackets follow the usual precedence. Nothing is rounded until the end, so `10 / 3 * 3` is `10` and `0.1 + 0.2` is `0.3`.
- **Finish**: scale by `10^exponent` and round once with `divRoundHalfEven` (already in `money.ts`), then `money(...)` for the range check.
- **Bounds**: a maximum text length (200 characters) and nesting depth (20), so the form cannot freeze; the rationals' size is bounded by the input length.

**Rationale**: it follows constitution VI exactly (integers only, one half-even rounding at the end) and needs no dependency. A hand-written recursive-descent parser over a token list is about 150 lines.

**Alternatives considered**: `eval`/`Function` (rejected: unsafe and floating point); a math library such as `mathjs` or `decimal.js` (rejected: a dependency and a bundle cost for four operators, and constitution IX); evaluating in `number` then converting (rejected: forbidden for money).

## R3. Operands with more decimals than the currency

**Finding**: the spec says a plain number with too many decimals stays an error and a calculated result is rounded once.

**Decision**: inside a sum an operand may have any number of decimals (`0.333 * 3` is `1.00` in a two-decimal currency) because it is part of a computation, and only the final result is rounded. A text with no operator keeps today's rules, including `too_many_decimals`. A signed number (`-5`) is a plain number; brackets make it a sum (`(5)` is a sum that evaluates to 5.00).

## R4. What counts as "a sum"

**Decision**: `isAmountExpression(text)` is true when, after trimming, the text contains an operator other than a single leading sign, or a bracket. That is the only switch: `parseMoney` calls the evaluator for those and the current code for everything else, so no existing input changes meaning. The ambiguous characters are handled by position: `-` after a digit or a closing bracket is subtraction, otherwise it is a sign; `x` is multiplication only between two operands.

## R5. Showing the result without moving the layout

**Finding**: `InputField` has one note slot under the input for a hint or an error (`note(hint, error)`). `AmountInput` already puts "Up to 2 decimal places. Nothing is rounded." there.

**Decision**: when the text is a valid sum, the hint slot shows the result ("= 22.90 USD") instead of the static hint, in a polite live region (`aria-live="polite"`, `aria-atomic`), so there is no new element and no layout shift; an invalid sum shows the error in the same slot, as errors do today. The calculation stays in the input (clarification of 2026-11-02). The result is formatted with `formatMoney` for the person's language (real figures: forms are exempt from Privacy mode).

## R6. Two components for one job

**Finding**: `transactions/AmountInput.tsx` (on `InputField`) and `ledger/AmountField.tsx` (on `TextField`) are the same logic twice.

**Decision**: keep `AmountInput` as the one implementation, and make `AmountField` a thin wrapper that forwards to it, so the five callers of `AmountField` (budgets, goals, schedules) need no edits. The filter's min and max switch to `AmountInput` (they keep their own "min is above max" validation).

## R7. Keyboards on phones

**Finding**: the amount fields set `inputMode="decimal"`. The decimal keypad on iOS and Android has no `+ − × ÷ ( )`, so a sum cannot be typed on it.

**Decision**: switch the money fields to `inputMode="text"` so the full keyboard is available (the person reaches digits and operators on its number page). This costs the one-tap number pad for plain amounts on phones. **Alternative**: keep `decimal` and add a small row of operator buttons (`+ − × ÷ ( )`) shown only on touch devices — better on phones, but it is new UI beyond the spec; it is noted as a follow-up. Desktop keyboards are not affected.

## R8. Strings

**Decision**: new keys in EN, UK and PL: `ledger.amount.result` ("= {amount}"), `ledger.amount.invalid_expression` (the sum is incomplete or has a character that cannot be used), `ledger.amount.division_by_zero`, and a longer `ledger.amount.hint` that still says up to N decimals and adds "You can type a sum, such as 12.50 + 3.20 × 2". `ledger.amount.out_of_range` is reused for a result that is too large.

## R9. Bundle size

**Finding**: the initial JavaScript had about 1.2 KB of headroom under its 374,784-byte budget after the last build. The evaluator is small but is reached from the money forms.

**Decision** (measured: the evaluator in the main bundle put it 474 bytes over): `evaluateAmount` is its own chunk, a subpath export `@cashfold/core/amount-expression`, loaded with `import()` by `loadAmountExpression()` in `ui/ledger/format.ts` as soon as the ledger mounts (`LedgerView.mathReady`). Only the tiny `isAmountExpression` (own file `is-amount-expression.ts`) is in the main bundle. Until the chunk is there a sum is neither an error nor a result. The chunk is stored for offline use like every other. The budget was not raised (374,644 of 374,784 bytes).

## R10. Testing approach

- Unit: precedence, brackets, unary minus, the `x` rule, spaces, languages with `,`/`.`/space marks, currencies with 0, 2 and 3 decimals, every error (empty bracket, double operator, unclosed bracket, division by zero, unknown character, too long, too deep, out of range), plain numbers unchanged.
- Property (`fast-check`): random expressions over small integers and decimals evaluated by the module equal a reference computed with `bigint` fractions in the test, rounded once half to even; `a + b - b` equals `a`; `x * y / y` equals `x`.
- Browser (Chromium, axe): the field with a sum, an error and a plain number in light, dark and right-to-left; the live region text; no height change when the result appears.
- E2E: the add sheet, a transfer, a budget limit, a goal target, a schedule and the filter, in English and Polish.
