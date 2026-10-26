# Contract: menus, shortcuts and quick actions

> **Superseded in part by [spec 007](../007-desktop-native-feel/spec.md):** the application menu bar is removed. Shortcuts stay, but are plain keyboard shortcuts in the shell's shortcut table (`apps/desktop/src/main/shortcuts.ts`, entries flagged `data: true`), with no menu entry and no menu to disable. Read "menu" below accordingly.

`CmdOrCtrl` is Command on macOS and Control on Windows and Linux. Each shortcut is shown in the menu in the platform's own notation. Labels come from `menu-labels.ts` in the language the app is shown in. A platform's own shortcut wins over ours if they clash, and the menu shows what really works.

## Action ids (closed set; `cashfold:menu-action`)

| Id | What the page does | Shortcut | Menu |
|----|--------------------|----------|------|
| `new-transaction` | opens the add sheet | `CmdOrCtrl+N` | File |
| `lock` | locks the app | `CmdOrCtrl+L` | File |
| `settings` | goes to Settings | `CmdOrCtrl+,` | app menu (macOS), File (others) |
| `search` | goes to Transactions and focuses its search field | `CmdOrCtrl+F` | Edit |
| `go:overview` | goes to Overview | `CmdOrCtrl+1` | View |
| `go:transactions` | goes to Transactions | `CmdOrCtrl+2` | View |
| `go:accounts` | goes to Accounts | `CmdOrCtrl+3` | View |
| `go:plan` | goes to Plan | `CmdOrCtrl+4` | View |
| `go:settings` | goes to Settings | `CmdOrCtrl+5` | View |
| `import` | goes to Settings → Data with the import panel focused | `Shift+CmdOrCtrl+I` | File |
| `export` | goes to Settings → Data with the export panel focused | `Shift+CmdOrCtrl+E` | File |

While locked, every id except `lock` is disabled in the menu; if one still arrives, the page ignores it (or shows the unlock screen). No action id carries data.

## Menu structure

None. Spec 007 removed the menu bar: Windows and Linux show no menu, and macOS keeps only the menu named after the app (About, Hide, Hide Others, Show All, Quit). The shortcuts in the table above are handled by `shortcuts.ts`; the "Menu" column is no longer used. Settings is reached from the app's own navigation.

## Tray / menu-bar item

Show Cashfold · Add transaction · Lock · Quit. The same entries in every state; none shows a balance, an amount, a Fold or an account name. "Add transaction" while locked shows the window so the person can unlock.

## macOS dock menu and Windows jump list

Tasks: Add transaction, Lock. A "Recent Folds" group with up to 5 Fold names **only while the app is unlocked**; the group is removed on every lock, on a system lock and on quit, and both menus are reset to tasks only at every start (the jump list persists in the operating system, so a crash must not leave names behind). Entries start the app (or its running copy) with `--action=add-transaction`, `--action=lock` or `--action=open-fold:<0..4>`; the argument is matched against this closed set and anything else is ignored.

## Native context menu (rows)

Items are the ones the row's actions button already offers, in the same order, with the same labels and the same confirmations. The page builds both from one function per row type:

| Row | Actions |
|-----|---------|
| transaction | `edit`, `pin` or `unpin`, `duplicate`, `delete` (destructive) |
| account | the account's existing actions (add transaction, adjust balance, edit, archive or restore, delete) |

Keyboard: the context-menu key and Shift+F10 open the same menu.

## Notifications

Title and body come from the existing reminder text (`schedules.notify.message.*`). The body shows an amount only if "show amounts in notifications" is on. After an unlock, several missed reminders are one notification (`schedules.notify.message.many`). A notification never carries the Secret Key, a password or a link.
