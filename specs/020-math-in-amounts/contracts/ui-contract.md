# UI Contract: Math in Amount Fields

## 1. Core (`packages/core/src/shared-kernel/amount-expression.ts`)

```text
isAmountExpression(text: string): boolean
evaluateAmount(text: string, currency: CurrencyCode, sep: Separators): Result<Money, AmountTextError>
// AmountTextError gains 'division_by_zero'
```

`evaluateAmount` never throws, never uses `number` arithmetic, and rounds once at the end with `divRoundHalfEven`. It is the same `Result` as `parseAmountText`.

## 2. Web (`ui/ledger/format.ts`)

```text
parseMoney(text, currency, locale)   // unchanged signature: a sum when isAmountExpression(text), else the current rules
ledger.parse(text, currency)         // unchanged; every form already calls it
```

## 3. The amount field (`ui/transactions/AmountInput.tsx`; `AmountField` forwards to it)

| Part | Value |
|------|-------|
| Input | text input, `inputMode="text"`, `autoComplete="off"`; keeps exactly what was typed, also after blur |
| Plain number | the current hint ("Up to 2 decimal places…") and the current errors |
| Valid sum | the note under the input reads "= 22.90 USD" (`ledger.amount.result`) |
| Invalid sum | the note shows the error (`invalid_expression`, `division_by_zero`, `out_of_range`) and the input is `invalid` |
| Note element | one `aria-live="polite"` region in the existing hint slot: no extra element, no layout shift |
| Where | every money field: the add sheet, both transfer amounts, opening balance, limit, balance target, budget limit and allocation, goal target, schedule amounts, filter min and max |
| Not here | exchange rates, coordinates and text fields |

## 4. Strings (EN, UK, PL)

Added: `ledger.amount.result`, `ledger.amount.invalid_expression`, `ledger.amount.division_by_zero`. Changed: `ledger.amount.hint` (adds the sum example).

## 5. Unchanged

The stored value, sync, backups, exports, Privacy mode's rules for lists (forms show real figures), and the rule that a plain number with too many decimals is an error.
