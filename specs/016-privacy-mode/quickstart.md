# Quickstart: Privacy Mode

How to check the feature end to end. Interfaces are in [contracts/ui-contract.md](./contracts/ui-contract.md) and stored data in [data-model.md](./data-model.md).

## Prerequisites

- Dependencies installed (`pnpm install`); a test account with two accounts in two currencies, a transaction or two, a budget, a goal and a schedule due today.
- Notifications allowed for the site or app.
- For the desktop checks: a build that runs the desktop shell (see `docs/desktop.md`).

## Automated checks

```text
pnpm typecheck
pnpm exec eslint apps packages e2e scripts
pnpm vitest run                                   # masking, reveal store, interleave, prefs, notification text, shortcut agreement, source scan
pnpm --filter @cashfold/web test:browser          # masked/revealed, keyboard, nested interactive, axe in light and dark
pnpm exec playwright test -c e2e/playwright.config.ts e2e/ux-privacy-mode.spec.ts --project=chromium
cd apps/desktop && env -u ELECTRON_RUN_AS_NODE pnpm exec playwright test -c e2e/playwright.config.ts e2e/privacy.spec.ts e2e/help.spec.ts
pnpm check:bundle                                 # initial JavaScript stays inside its budget
```

Expected: all green. The source-scan test fails with the file name if someone adds `ledger.money(` or `formatMoney` in a new place.

## Manual scenarios

1. **Hide (US1)**: Settings → Appearance → turn on Privacy mode. Visit Overview, Accounts, Transactions, Plan (budgets, goals, schedules), Data → import preview. Every amount shows as blurred zeros with its currency code (`0,000.00 USD`, the same for every amount); names, dates, categories and notes are readable; no sign or red/green colour on amounts; nothing jumps.
2. **Reveal (US1)**: Click one amount: only that one shows its figure, then hides in about 5 seconds. Reveal one, then go to another screen, lock, or click away from the window: it is masked again. Revealing one amount does not reveal the same figure elsewhere.
3. **Keyboard and screen reader (US1)**: Tab to a masked amount, press Enter or Space: it reveals and focus stays. A screen reader says "Hidden amount, USD. Press to reveal." and, after reveal, the figure; a polite message says amounts were shown or hidden.
4. **Dropdowns (US1)**: Open the account dropdown in the add form and in a filter: names only while the mode is on.
5. **Shortcut and indicator (US2)**: Press ⇧⌘M (macOS) or Ctrl+Shift+M anywhere, also while typing in a field: the mode flips on every screen, the indicator appears or disappears, no character is typed. Help lists the shortcut in the desktop app and in a browser. While locked, the key does nothing.
6. **Palette (US2)**: Open the command palette: "Turn privacy mode on" is offered when off, "off" when on.
7. **Notifications (US3)**: With details off, a due reminder shows a generic message with no name, date, amount or count (try two due reminders: one generic message). Turn details on: the schedule's name and the day appear; turn amounts on: the amount appears. Privacy mode on or off makes no difference. Choosing a notification opens the schedules.
8. **Earlier choice (US3, US4)**: In a profile that had "Show amounts" on before the update, details show as on and amounts as on.
9. **Persistence (US4)**: With both settings on, restart the app and sign out and in again: both stay on. A second device on the same account does not change. The settings appear nowhere in sync or exports.
10. **Real figures where you act (US5)**: With the mode on, add and edit a transaction (the field shows what you type), export CSV and a backup (real figures), copy a masked amount (nothing real) and a revealed one (the figure).
11. **Whole-page scan (SC-001)**: With the mode on, in the browser console on each screen: `[...document.querySelectorAll('*')].filter(e => /\d[\d.,\s]*\d\s?(USD|EUR|UAH|PLN)/.test(e.textContent + [...e.attributes].map(a => a.value).join(' ')))` returns nothing (the e2e does this for every main screen).
12. **Budget**: `pnpm check:bundle` stays under its limits.

## Done when

- All automated checks pass.
- Scenarios 1 to 11 behave as described in a browser and in the desktop app on each system you can reach.
- `docs/privacy.md` and `docs/desktop.md` describe the mode, the shortcut and the notification defaults.
