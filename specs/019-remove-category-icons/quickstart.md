# Quickstart: Categories Without Icons

Prerequisites: `pnpm install`; Chromium and Firefox for Playwright.

## 1. Automated checks

```text
pnpm typecheck
pnpm exec eslint apps packages e2e scripts
pnpm vitest run
pnpm --filter @cashfold/web test:browser
pnpm --filter @cashfold/web build && pnpm check:bundle && pnpm check:docs
pnpm test:e2e --project=chromium --project=firefox --project=rtl e2e/<categories spec> e2e/a11y.spec.ts
```

Expected: all green; initial JavaScript no larger than the figure recorded in T001 (373,867 bytes when this spec was written).

## 2. By hand

1. Sign up (English). Settings → Categories: every row is a color swatch and a name; no emoji, no gap.
2. Add a category: the form has name, type, parent and color, and no Icon field. Save it; it appears with its color.
3. Edit it and change the color; nothing about an icon is offered.
4. Switch to Polish and Ukrainian: no leftover icon text.
5. Restore a backup made before this change (or use an account made before it): its categories appear with their names and colors, no emoji.
6. Open Overview, Transactions, Plan: no emoji anywhere.
