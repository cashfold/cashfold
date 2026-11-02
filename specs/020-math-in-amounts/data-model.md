# Data Model: Math in Amount Fields

No stored data is added or changed. The saved value is the result, a signed 64-bit count of minor units, as today.

## Amount expression (temporary, never stored)

| Part | Rule |
|------|------|
| Text | at most 200 characters; at most 20 levels of brackets |
| Numbers | digits with the language's group and decimal marks, any number of decimals |
| Operators | `+`, `-` / `−`, `*` / `×` / `x`, `/` / `÷`, `(`, `)` |
| Value while evaluating | an exact rational: numerator and denominator, both `bigint`, denominator greater than zero, reduced |
| Errors | `invalid_format` (incomplete, unknown character, unbalanced or empty brackets, two operators in a row), `division_by_zero`, `out_of_range` |

## Amount result (what is saved)

| Part | Rule |
|------|------|
| Value | the rational scaled by `10^exponent` of the currency and rounded once, half to even, to a `bigint` |
| Range | within the signed 64-bit range, else `out_of_range` |
| Currency | the field's currency |
| Plain number | a text with no operator and no bracket (a signed number counts) keeps today's rules, including `too_many_decimals` |
