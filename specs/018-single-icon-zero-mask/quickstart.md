# Quickstart: One App Icon and Plain Zeros in Privacy Mode

Prerequisites: `pnpm install`; Chromium and Firefox for Playwright (`pnpm exec playwright install`).

## 1. Automated checks

```text
pnpm typecheck
pnpm exec eslint apps packages e2e scripts
pnpm vitest run
pnpm --filter @cashfold/web test:browser
pnpm --filter @cashfold/web build && pnpm check:bundle && pnpm check:licenses && pnpm check:docs
pnpm test:e2e --project=chromium --project=firefox --project=rtl e2e/ux-privacy-mode.spec.ts e2e/ux-privacy-switch.spec.ts e2e/ux-primary-color.spec.ts e2e/a11y.spec.ts e2e/ux-responsive.spec.ts
pnpm --filter @cashfold/desktop build, then the desktop specs: privacy, appearance, hardening
```

Expected: all green; initial JavaScript no larger than 374,121 bytes.

## 2. By hand: Privacy mode (user story 1)

1. Sign up, create an account "Checking" with 1,234.56, a negative transaction of 12.50, a EUR account with 99.99.
2. Turn Privacy mode on with the sidebar switch.
3. Overview, Accounts, Transactions: each amount reads as the same figure with zeros, blurred (`−0.00 USD` for the expense, `0,000.00 USD` style for the balance), the minus and plus signs and the red/green colours as before, the currency code sharp.
4. Switch to Ukrainian or Polish: the marks follow the language.
5. Press an amount: the real figure shows for about five seconds and the neighbours do not move; it hides again.
6. With a screen reader or the accessibility tree: "Hidden amount, USD. Press to reveal."
7. Select the text of a row and copy it: no amount in the clipboard.
8. Turn the mode off: everything is as before.

## 3. By hand: the icon (user story 2)

1. Settings → Appearance: pick each colour. The page's tab icon, touch icon and manifest link never change (`/favicon.ico`, `/icon.svg`, `/manifest.webmanifest`).
2. The address-bar colour still follows the chosen colour.
3. Appearance has no mention of the icon or of reinstalling.
4. Desktop: picking a colour leaves the dock/taskbar/window icon as the original.
5. `git ls-files | grep -c "public/icons/\|public/manifests/\|build/icons/"` prints `0`.
