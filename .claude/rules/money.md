---
paths:
  - "packages/core/src/**/*"
  - "packages/protocol/src/**/*"
  - "apps/web/src/ui/**/*amount*"
  - "apps/web/src/ui/ledger/**/*"
  - "apps/web/src/ui/plan/**/*"
  - "eslint-rules/no-number-in-money.js"
---

# Money and exact arithmetic

Constitution VI. A rounding bug in a finance app destroys trust, so this is checked three ways: lint,
a CI script and tests.

- Amounts are **signed 64-bit integer minor units held as `bigint`**. Exchange rates are scaled
  integers. Balances, envelope availability and goal progress are always derived, never stored.
- In money code (see `MONEY_FILES` in `eslint.config.js`: `money`, `ledger`, `budgeting`,
  `scheduling`, sync patches, anything named `*amount*`) these are errors:
  - `number`-typed identifiers named like money (`amount`, `balance`, `rate`, `total`, `minor`)
  - floating-point literals, `parseFloat`, `Math.*`, `.toFixed(`
- Counts, indices and durations may stay `number`; give them names that do not look like money, or
  keep them out of money files.
- One rounding rule everywhere: **half-to-even, applied once at the end** of a computation. Do not
  round in the middle of a pipeline.
- Overflow is an error. Never wrap or truncate.
- Parse and format through the shared-kernel (`Money`, `amount-text`) and the locale-aware formatters
  in `apps/web/src/ui/ledger/format.ts`. Do not hand-roll decimal parsing or `toLocaleString` on
  amounts.
- Currency has a minor-unit exponent (JPY is 0, USD is 2, some are 3); never assume 100.
- Tests: use `fast-check` property tests for arithmetic and conversion (CI runs 1000 cases via
  `FAST_CHECK_NUM_RUNS`; the seed is printed on failure), and add the failing example when you fix a
  bug.
- Before pushing, run `pnpm check:no-float` and `pnpm lint`.
