# Quickstart: A Currency for Each Account Group

Prerequisites: `pnpm install`; Chromium and Firefox for Playwright.

## 1. Automated checks

```text
pnpm typecheck
pnpm exec eslint apps packages e2e scripts
pnpm vitest run
pnpm check:no-float
pnpm --filter @cashfold/web test:browser
pnpm --filter @cashfold/web build && pnpm check:bundle && pnpm check:docs
pnpm test:e2e --project=chromium --project=firefox --project=rtl e2e/ux-group-currency.spec.ts e2e/ux-accounts.spec.ts e2e/a11y.spec.ts
```

Expected: all green; initial JavaScript within its budget.

## 2. By hand

1. Sign up (base currency USD). Create accounts "Euro" (EUR, 100.00), "Dollar" (USD, 50.00), "Zloty" (PLN, 200.00).
2. Settings → Rates (or Overview → Enter rates): enter EUR and PLN rates.
3. Accounts → add a group "Savings", choose EUR as its currency, and put the three accounts in it.
4. Group view: one subtotal in EUR; the Dollar and Zloty rows also show "≈ … EUR"; the tooltip of the subtotal and of each "≈" figure says which rates the conversion used.
5. Edit the group, change its currency to PLN: the subtotal and the converted figures follow; the accounts keep their own balances.
6. Remove the PLN rate (or use a currency without one): the group says what is left out and names the currency; "Enter rates" opens the rates; entering one updates the page at once. With no usable rate the subtotal reads "No total yet", not 0.00.
7. Turn on Privacy mode: the converted figures are hidden like the others.
8. Open the same account on a second device after sync: the group has the same currency.
9. The Ungrouped section and the by-type view still show one figure per currency and no conversion.
