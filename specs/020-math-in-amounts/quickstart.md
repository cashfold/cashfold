# Quickstart: Math in Amount Fields

Prerequisites: `pnpm install`; Chromium and Firefox for Playwright.

## 1. Automated checks

```text
pnpm typecheck
pnpm exec eslint apps packages e2e scripts
pnpm vitest run
pnpm check:no-float
pnpm --filter @cashfold/web test:browser
pnpm --filter @cashfold/web build && pnpm check:bundle && pnpm check:docs
pnpm test:e2e --project=chromium --project=firefox --project=rtl e2e/ux-amount-math.spec.ts e2e/a11y.spec.ts e2e/ux-responsive.spec.ts
```

Expected: all green; initial JavaScript no larger than the figure recorded in T001.

## 2. By hand

1. Sign up, create an account in USD. Open Add.
2. Type `12.50 + 3.20 * 2 + 4` in Amount: the note under it reads "= 22.90 USD" as you type. Leave the field: the sum is still there, the note still reads 22.90. Save: the list shows 22.90.
3. Type `10 / 3`: "= 3.33 USD". Type `10 / 3 * 3`: "= 10.00 USD". Type `0.1 + 0.2`: "= 0.30 USD".
4. Type `12 +`, then `5 / 0`, then `abc`: each shows a clear message; Save does nothing; your text is kept.
5. Type `12.50`: nothing new appears; type `1.239`: the "too many decimals" error, as before.
6. Correct one number in a longer sum: the rest stays and the result updates.
7. Repeat in a transfer between two currencies, a budget limit, a goal target, a schedule, an account's opening balance and the filter's min and max.
8. Switch to Polish: `1 234,50 + 10,25` gives "= 1 244,75 PLN".
9. Rates, latitude and longitude fields: `2 + 2` is still not a calculation.
10. On a phone, the keyboard offers digits and operators on its number page.
