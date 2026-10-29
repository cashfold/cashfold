# Quickstart: Validating Account Groups on the Accounts Page

Prerequisites: Node 26 (`.nvmrc`), `pnpm install` done. Any build works; the feature needs no relay.

## 1. Automated

```sh
pnpm vitest run packages/core apps/web   # section building, subtotals, view choice, menu actions, the new command, catalogue-complete
env -u ELECTRON_RUN_AS_NODE pnpm --filter @cashfold/web test:browser   # the move command against the real encrypted database
pnpm test:e2e ux-account-groups          # the new Playwright spec (run with --workers=3, one Playwright run at a time)
```

Expected: all pass; the e2e file covers every row below that is not marked "by hand".

## 2. By hand (web, then desktop)

| # | Do | Expect (spec) |
|---|---|---|
| 1 | Sign up and open Accounts with no accounts and no groups | As today; an "Add group" button beside "Add account"; no view switch (FR-008) |
| 2 | Add a checking account "Everyday" (USD), a savings account "Rainy day" (USD), a cash account "Wallet" (EUR) | By type, as today |
| 3 | Press "Add group", add "Household" and "Savings" | Both appear at once; a view switch appears; the page is still by type (nothing is grouped yet) (FR-012, US2.6) |
| 4 | Open the menu of "Everyday" and choose "Move to Household" | It moves at once, a status line says "Moved to Household", the account shows "Group: Household" (FR-009, FR-010, FR-011) |
| 5 | Open the menu of "Rainy day" and choose "Move to Savings" | Same, in one step |
| 6 | Reload the page | It opens **by group**, because an account is now in a group and nothing was chosen (US2.5) |
| 7 | Look at the group view | Sections "Household" (Everyday, subtotal 0.00 USD), "Savings", and "Ungrouped" holding "Wallet" (FR-001, FR-002) |
| 8 | Add a transaction to "Everyday" and a EUR account to "Household" | The Household subtotal shows one USD figure and one EUR figure, never one combined number (FR-004) |
| 9 | Press "By type", reload, press "Lock" and unlock | It stays by type; the choice is remembered (FR-007, SC-005) |
| 10 | Archive "Rainy day" with the archived switch off | It disappears from Savings, and the subtotal drops it; Savings says it has no accounts yet (US1.7, US1.6) |
| 11 | Try to add a group named "household " and one with 81 characters | Each is refused with a reason; nothing is saved (FR-013) |
| 12 | Rename "Savings" to "Reserves" | The heading and every account label change |
| 13 | Make a budget limited to "Household", then delete "Household" | The confirmation says how many accounts are in it and names the budget; confirming keeps the accounts, now under "Ungrouped" (FR-014, FR-015) |
| 14 | Keyboard only: reach the view switch, a group heading, an account menu, a move item | Every control is reachable and named; Escape closes the menu (FR-018) |
| 15 | Repeat rows 3 to 7 in Українська and Polski | No untranslated key; long names fit (FR-019) |
| 16 | With a second device on a relay, rename a group and delete another on one device | The other shows the new name, and accounts of the deleted group read as ungrouped (US4.6) |
| 17 | Repeat the core rows in the desktop app | The same behaviour (FR-020) |

## 3. Accessibility and layout checks

- Axe runs on the Accounts page in both views and on the group dialogs.
- At a narrow width the view switch and "Add group" wrap and do not push the page sideways. With 20 groups the account menu scrolls and keeps its items reachable.
