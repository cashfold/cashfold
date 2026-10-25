# Quickstart: validating the language control placement

Prerequisites: dependencies installed; run Playwright one invocation at a time with `--workers=3` (see the repo notes).

## 1. Automated

```sh
pnpm vitest run apps/web                                   # unchanged unit tests still pass
env -u ELECTRON_RUN_AS_NODE npx playwright test -c e2e/playwright.config.ts \
  --project=chromium --project=rtl --workers=3 e2e/language.spec.ts e2e/shell.spec.ts
env -u ELECTRON_RUN_AS_NODE npx playwright test -c e2e/playwright.config.ts --project=pseudo e2e/pseudo-walk.spec.ts
```

Expected: all pass. The language spec counts the controls per route (contract rule 3 to 5).

## 2. By hand

1. Browser set to Polish, clear site data: `/` is Polish, with no language control. `/recover/` and `/add/` the same.
2. Open `/sign-up/`: there is a control. Choose Українська, type an email address: the page changes at once and the address stays. Reload: still Ukrainian.
3. Create the account: the Secret Key page is Ukrainian and has no control; after it, the first Fold is called "Особистий".
4. Lock and open the unlock page: Ukrainian, no control.
5. Settings → Appearance: choose "Automatic" with a Polish browser: the app becomes Polish. Browse every other screen: no control anywhere.
6. From any signed-in screen, count the steps to the language field (Settings, Appearance, the field): at most 3 (SC-005).
7. Desktop app: the menu follows the language chosen in Settings.

See [the contract](contracts/language-control-placement.md) for the rules these steps check.
