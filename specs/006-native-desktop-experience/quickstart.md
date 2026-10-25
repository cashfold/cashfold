# Quickstart: validating the native desktop experience

Prerequisites: dependencies installed; a machine of each system for the checks marked by hand; run one Playwright invocation at a time and, for the web suite, `--workers=3`. The desktop test build keeps the Node inspector fuse on so Playwright can attach (`CASHFOLD_TEST_BUILD=1`).

## 1. Automated (per area, in delivery order)

```sh
pnpm vitest run apps/desktop packages/platform apps/web          # shell logic, schemas, page side
pnpm --filter @cashfold/desktop test:packaged                    # packaged-app suite incl. the new specs
env -u ELECTRON_RUN_AS_NODE npx playwright test -c e2e/playwright.config.ts --workers=3 --project=chromium --project=rtl   # the web app is unchanged
pnpm check:bundle && pnpm check:docs
```

Expected: all pass; the web bundle sizes are unchanged within the budget; `hardening.spec.ts` lists the new bridge keys.

## 2. By hand, on each system

1. **Lock policy (P1).** Unlock, switch to another program: content stays. Lock the computer (and, separately, start the screen saver and put it to sleep): after you return the app is locked within 5 s and showed nothing in the window switcher. Set the idle time to 1 minute and leave it: it locks. Turn on "Hide when I switch to another window": switching hides at once. Minimise the window and leave it: it locks at the idle time, not after one minute.
2. **First frame (P2).** System dark, quit and start: no light frame at any moment. Theme "Light" with a dark system: opens light. Change the system theme with "System" chosen: follows within a second.
3. **Menus (P3).** Use each shortcut in [menu-and-shortcuts](contracts/menu-and-shortcuts.md) and its menu entry; both do the same; the menu shows the working shortcut. Switch the language to Polish: the menus change. Lock: the data entries are disabled.
4. **Gestures (P4).** Right-click a transaction and an account: the same actions as the actions button, delete asks to confirm. Drop a CSV on the window: the import preview opens with it. Drop a picture on the add sheet: it shows as the attachment. Drop an unsupported or huge file: a message, nothing changes. Lock and drop: nothing is read.
5. **Presence (P5).** Create entries that ask for confirmation: the dock icon or taskbar button shows the count and falls as you confirm. Close the window with "keep running": a reminder that falls due appears as a native notification within a minute; choosing it brings the app forward. Lock the app: the badge disappears and no reminder appears; unlock: one summary notification. Use the tray item, dock menu and jump list entries; while locked they show no Fold names.
6. **Starting and opening (P6).** Turn on "Start Cashfold when I sign in", sign out and in: the app is running and locked, with no window in the way. Closing the window: quit or keep running as chosen; defaults are quit on Windows and Linux, keep running on macOS; on GNOME without an extension "keep running" is not offered. Double-click a `.cashfold-backup` and open a `.csv` with Cashfold: the app opens at the restore form and the import preview, locked-first if needed, doing nothing until confirmed. Open `cashfold://add-device?email=a@example.com&server=https://relay.example.com`: the add-device screen with those two fields filled. Open a link with `&key=C1-…` or a `#fragment`: refused with a message. Start a second copy: the first comes forward.
7. **Start at login timing and review (V6).** With start at login on, time from signing in to the app running and locked (at most 10 s); ask three people who use native finance apps to do the main tasks and note anything that feels like a website.
8. **Frame (P7).** Drag by the bar, double-click it, snap and maximise it, enter and leave full screen, shrink to the minimum size: nothing is under the buttons. Use the bar's controls by keyboard (and Alt+Space on Windows). Turn on reduced transparency or high contrast: the sidebar becomes plain.

## 3. Verification tasks on real machines

V1 to V5 in [research.md](research.md): lock and sleep events and their delay, status icon on Linux desktops, notifications in a packaged signed build, file association rank, and the frame details.

See [the contracts](contracts/) and [the data model](data-model.md) for what each step checks.
