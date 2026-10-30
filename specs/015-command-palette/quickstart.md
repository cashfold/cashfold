# Quickstart: Command Palette

How to check that the feature works end to end. Details of the interfaces are in [contracts/ui-contract.md](./contracts/ui-contract.md) and the stored data in [data-model.md](./data-model.md).

## Prerequisites

- Dependencies installed (`pnpm install`).
- A test account with a Fold that has at least three accounts (two with similar names), two envelopes and two goals, plus a second Fold with its own account.
- For the desktop checks: a build that runs the desktop shell (see `docs/desktop.md`).

## Automated checks

```text
pnpm typecheck
pnpm lint
pnpm vitest run                                  # matcher, registry, history, ranking, guards, shell table vs Help list
pnpm --filter @cashfold/web test:browser         # dialog roles, keyboard, announcements, axe (light and dark, reduced motion)
pnpm test:e2e                                    # open, jump, lock with the palette open (web and desktop projects)
pnpm check:bundle                                # no new dependency, size within budget
```

Expected: all green. The desktop shortcut test fails if the shell table and the Help list disagree on the palette shortcut on any of macOS, Windows or Linux.

## Manual scenarios

1. **Jump (US1)**: Unlocked, on Overview. Press ⌘K / Ctrl+K. The box opens with the cursor in it and the shortcut in the placeholder. Type `chk`: "Checking" appears with its letters highlighted. Type `cafe`: an item named "Café" appears. Press Down, Enter: the app shows that account's transactions. Repeat for an envelope and a goal: the Plan screen opens on the right tab with that row focused.
2. **Close and focus (US1)**: Open the palette from a text field, press Escape: the cursor is back in that field. Open it and press the shortcut again: it closes.
3. **No match (US1)**: Type `zzzz`: "No results" is shown; Enter does nothing.
4. **Actions (US2)**: Run "Add transaction" (form opens), "Switch theme" (theme changes), "Help and shortcuts" (Help opens), "Sign out / use a different account" (the usual confirmation appears, nothing changes until confirmed), "Lock now" (the app locks). With one account, "Switch account" behaves as in the existing flow.
5. **History (US3)**: Open and run a few items several times. Reopen with an empty box: Recent shows the last ones newest first; Frequent shows the most used, without repeats. Delete one of them in another tab: it disappears from the list. In Settings → Data and storage, press "Clear palette history": both sections are empty and the screens and common actions show instead.
6. **Account leaves the device (US3)**: Use the palette for a while, then sign out (or use a different account) and sign back in: the history is empty. The palette storage key is gone from the browser's storage view right after sign-out.
7. **Several Folds (clarification)**: Switch to the second Fold: only its accounts, envelopes and goals are listed.
8. **Locked (US4)**: Lock the app with the palette open: it vanishes with the lock. While locked, press the shortcut: nothing opens and no names appear (also with the window hidden or blurred and "hide content when I switch window" on).
9. **Another dialog (US4)**: Open Help, press the shortcut: the palette does not open. With the palette open on desktop, press ⌘N / Ctrl+N: the palette closes and the add form opens.
10. **Keyboard and screen reader (US4)**: With only the keyboard, complete scenario 1. With VoiceOver / NVDA, check that the dialog is named, the highlighted option is read with its type, and the result count is announced after typing stops. Turn on reduced motion: no animation. Check light and dark themes and two primary colors.
11. **Help and parity (US5)**: Open Help in the desktop app: the shortcut is listed with ⌘K or Ctrl+K. In a browser: Help shows the same row. Compare results for the same data in a browser and in the desktop app: same items, order and actions.
12. **Privacy (SC-007)**: In the browser's storage view, the only palette data is `cashfold.palette` with ids, counts and times; no names. The network panel shows no request caused by opening the palette.

## Done when

- All automated checks pass.
- Scenarios 1–12 behave as described on one browser and on each desktop system you can reach.
- `docs/desktop.md` lists the shortcut and `docs/privacy.md` states that palette history stays on the device.
