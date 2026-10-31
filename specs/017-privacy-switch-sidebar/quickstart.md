# Quickstart: Privacy Mode Switch in the Sidebar

How to check the feature end to end. Interfaces are in [contracts/ui-contract.md](./contracts/ui-contract.md).

## Prerequisites

- Dependencies installed (`pnpm install`); a test account with an account or two so amounts are on screen.
- Spec 016 (Privacy mode) present on the branch.

## Automated checks

```text
pnpm typecheck
pnpm exec eslint apps packages e2e scripts
pnpm vitest run                                                  # markup in both states, strings in three languages
pnpm --filter @cashfold/web test:browser                         # axe, keyboard, narrow and wide, long labels
pnpm exec playwright test -c e2e/playwright.config.ts e2e/ux-privacy-mode.spec.ts e2e/ux-privacy-switch.spec.ts --project=chromium
cd apps/desktop && env -u ELECTRON_RUN_AS_NODE pnpm exec playwright test -c e2e/playwright.config.ts e2e/privacy.spec.ts e2e/help.spec.ts
pnpm check:bundle                                                # initial JavaScript stays inside its budget
```

Expected: all green.

## Manual scenarios

1. **Always there (US1)**: unlocked, Privacy mode off, on every main screen the sidebar footer shows "Privacy mode: off" with an eye icon, above Help. You never open Settings.
2. **Turn on (US1)**: press it (mouse, tap, Enter or Space): every amount on the screen is masked at once and the item reads "Privacy mode: on" with a crossed-out eye; focus stays on it.
3. **Turn off (US1)**: press again: amounts show, the item reads "off".
4. **Narrow window (US1)**: make the window narrow (under 1024 px): a compact eye button appears in the top bar before Add, with no menu opened. One tap turns the mode on; its icon changes. Open the drawer: the labelled item is there too, and pressing it does not close the drawer. At 320 px nothing is pushed off: menu button, title (shortened), privacy, Add.
5. **Wide window**: widen it again: the top-bar button is gone and the sidebar item remains.
6. **State follows every route (US2, US3)**: turn the mode on in Settings, with the shortcut, and with the command palette in turn: each time both controls show it. Turn it on with the control: the Settings switch is on.
7. **Screen reader and keyboard (US2)**: Tab to the control (it is near Help and Lock) and hear "Privacy mode: on" or "off" as a toggle button with its pressed state; after changing it by any route, hear "Privacy mode on" or "off" politely, and focus does not move.
8. **Themes, language, text size (US2)**: check light and dark, a different primary color, Ukrainian and Polish, and larger text: the label stays inside the sidebar and nothing overlaps Help or Lock.
9. **Locked (US3)**: lock the app: no privacy control on the lock screen; unlock: it is back, in the state you left.
10. **One control**: there is never a second privacy button in the sidebar.

## Done when

- All automated checks pass.
- Scenarios 1 to 10 behave as described in a browser and in the desktop app.
- `docs/privacy.md` says the switch is always in the sidebar.
