# Verification on real machines: A Native Desktop Experience

The packaged tests simulate system events (`powerMonitor.emit`, `second-instance` with launch arguments, dispatched drops, a recorded native menu, the notification constructor), so a green run does not prove what a real system does. These checks need a person at a real machine. **None of them has been done yet**: the result columns are empty on purpose, and anything that fails becomes a follow-up item, not a silent skip.

How to fill a row: write the system and its version, `pass`, `fail` or `n/a`, the date, and a line on what was seen. A failure gets its own follow-up item in the pull request.

## Systems

| Code | System                                                                |
| ---- | --------------------------------------------------------------------- |
| M    | macOS (Apple silicon, current release)                                |
| W11  | Windows 11                                                            |
| W10  | Windows 10                                                            |
| L-A  | A Linux desktop on the allow-list for the tray (KDE Plasma or XFCE)   |
| L-G  | Plain GNOME on Linux, with no tray extension                          |

## V1 to V6

| #   | What to check                                                                                                                                                                                                                                                              | Systems            | Result (system, pass or fail, date, notes) |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| V1  | Which of the screen lock, sleep, screen saver and fast user switching lock the app, and after how many seconds (target: within 5). Click another window and confirm the data stays on screen. Set a one-minute idle time and confirm a minimised window locks at one minute. | M, W11, W10, L-A, L-G |                                            |
| V2  | A tray icon is really shown on the desktops of the allow-list, and plain GNOME does **not** offer "keep running in the background" (closing quits).                                                                                                                         | L-A, L-G           |                                            |
| V3  | Reminder notifications from the page, in a packaged and signed build: permission, a click brings the app forward and opens the schedules, one notification per occurrence, one summary after an unlock. Nothing while locked.                                                | M, W11, W10, L-A   |                                            |
| V4  | CSV is offered under "Open with" but Cashfold is **not** made the default CSV program; a backup file opens in Cashfold by default; `cashfold://` links open the app.                                                                                                       | M, W11, L-A        |                                            |
| V5  | The frame: drag by the bar, double-click to maximise, Windows snap layouts, the traffic lights clear of the content and gone in full screen, the smallest window, keyboard access to the system buttons (Alt+Space on Windows). Vibrancy and Mica look right in both themes (text over them is readable) and the sidebar turns plain when reduced transparency or high contrast is switched on. | M, W11, W10, L-A   |                                            |
| V6  | Start at login: with it on, sign out and in; within 10 seconds the app is running, locked, and has no window, with its icon in the tray or menu bar (SC-006). Turning it off removes it. Then the review by people who use native finance apps (SC-010).                     | M, W11, W10, L-A   |                                            |

## Also by eye (not automated)

| What                                                                                                                                                                                                 | Systems  | Result |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| Quit, set the system to dark, start cold: no light frame appears at any point (US2). With a translucent material the window has no colour of its own; the material follows the system theme.      | M, W11   |        |
| The Windows taskbar count (overlay images 1 to 9 and "9+") and the macOS dock count follow the number of waiting entries, and are gone while locked.                                              | M, W11   |        |
| The macOS dock menu and the Windows jump list show the two tasks, then up to five recent Folds while unlocked, and only the tasks after a lock, a system lock and a restart.                       | M, W11   |        |
| A keyboard-only and screen-reader pass of sign-in, add transaction, Settings → Desktop (SC-007 of spec 007).                                                                                        | M, W11   |        |

## What was checked by machine, and where it falls short

- Run on macOS (Apple silicon) only, from source with the test build: unit tests, the web and the desktop packaged-style specs (`appearance`, `shortcuts`, `gestures`, `presence`, `intake`, `frame`, `native-feel`, `a11y-desktop`), and the web browser specs `a11y`, `ux-responsive`, `ux-shell`, `ux-list` and `us6-schedules` on Chromium.
- The full packaged suite (`pnpm --filter @cashfold/desktop test:packaged`) was started once on this machine and did not finish in a useful time: launches of the unpacked, ad-hoc signed app were slow and its sign-up steps timed out. It has to be run in CI (all three systems) and on a clean machine before this is called verified.
- Windows and Linux have not been run at all.
