# Exact money

**Scope:** money files: `packages/core/src/**/{money,ledger,budgeting,scheduling}/**`, sync patches,
`shared-kernel/{money,fx,rate,amount-text}.ts`, anything named `*amount*`, and `apps/web/src/ui` code that
parses, formats or converts amounts.

Follow `_contract.md`. The rules are in `.claude/rules/money.md`; constitution VI is the standard.

- **`bigint` in minor units, signed, never `number`.** A `number` that carries money, a floating-point
  literal, `parseFloat`, `Math.*` or `.toFixed(` in a money path is a `blocker` (lint and
  `pnpm check:no-float` catch most; look for the ones they cannot, such as a `Number(...)` cast in the
  middle of a calculation).
- **One rounding rule.** Half-to-even, applied once at the end. Rounding inside a pipeline, or a second
  rounding rule, drifts.
- **Overflow is an error.** No wrapping, truncation or silent clamping.
- **Currency exponent.** Never assume two decimals; JPY has none, some have three. Conversion goes
  through scaled integer rates, not decimal division.
- **Derived, not stored.** Balances, envelope availability and goal progress are computed from
  records. A stored running total will disagree after a merge.
- **Parsing and formatting** use the shared helpers (`amount-text`, `ui/ledger/format.ts`), including for
  locales that use a comma or a space as the separator.
- **Tests.** Arithmetic and conversions have property tests; a bug fix adds the failing example.
