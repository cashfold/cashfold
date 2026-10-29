# Contract: Account Groups (page ↔ worker, preference, screen, copy)

The relay API is unchanged and nothing here crosses the network. The change adds one command and tightens two, adds one preference field, and defines what the Accounts page shows and says.

## 1. Worker calls

### `ledger.moveAccountToGroup` (new)

|           |                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| args      | `{ fold, account: Id, group: Id \| null }`. The page does not pass `fold` itself: `ledger.run` adds the open Fold, as for the other ledger calls |
| effect    | In one write, the account's `groupIds` become exactly `[group]`, or empty when `group` is `null`                                                 |
| ok result | `{ ok: true, value: true }`                                                                                                                      |
| errors    | `unknown_group` (the group does not exist or is deleted), `not_found` (no such account)                                                          |
| role      | editor                                                                                                                                           |

### `ledger.createGroup` and `ledger.updateGroup` (changed)

New error `group_name_taken` when another live group already has the name (trimmed, case-insensitive). Renaming a group to a name that differs only from its own current name by case or spaces is allowed. Existing errors are unchanged: `invalid_group_name`, `group_exists`, `unknown_group`.

### `ledger.deleteGroup`, `ledger.groupAccounts`, `ledger.basics`, `budgets.list` (unchanged)

The delete confirmation reads the number of the group's accounts from `ledger.basics` and the budgets limited to the group from `budgets.list` (`budget.scope.groupIds`). `ledger.groupAccounts` stays for the account form's "Group" field until that field is moved to the new command.

## 2. Preference

`lists.accountsView: 'auto' | 'group' | 'type'` in the interface preferences (see `data-model.md`). Device-local, never synced, kept on sign-out.

## 3. Screen behaviour (testable)

| Screen                   | Condition                                | Required behaviour                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts                 | No group exists                          | As today by type; "Add group" is visible beside "Add account"; no view switch                                                                                                                                                                                                    |
| Accounts                 | At least one group exists                | A labelled switch "By group" / "By type" shows the current view; the choice is stored on first use                                                                                                                                                                               |
| Accounts                 | `auto`, some account is in a group       | Opens by group                                                                                                                                                                                                                                                                   |
| Accounts                 | `auto`, no account is in a group         | Opens by type                                                                                                                                                                                                                                                                    |
| Group view               | Each live group                          | A section headed by the group's name, with its accounts in account order, its subtotal, and rename and delete                                                                                                                                                                    |
| Group view               | A group with no listed accounts          | Still a section, says "No accounts in this group yet", no subtotal figure                                                                                                                                                                                                        |
| Group view               | Some listed account has no group         | An "Ungrouped" section after the groups; none when every listed account is in a group                                                                                                                                                                                            |
| Group view               | Subtotal                                 | One amount per currency, in currency-code order, adding only accounts in that currency; "unavailable" while a balance is not known; no conversion                                                                                                                                |
| Group view and type view | "Show archived accounts"                 | Hidden accounts are neither listed nor counted; shown accounts are both                                                                                                                                                                                                          |
| Type view                | An account in a group                    | A small label with the group's name beside its details                                                                                                                                                                                                                           |
| Account menu             | Groups exist                             | After Edit, an item "Move to {group}" for every group and "Move to Ungrouped"; the current one is disabled and reads "{group} (current group)"                                                                                                                                   |
| Account menu             | An item is chosen                        | The account moves at once; both subtotals update; "Moved to {group}" is announced; focus is not lost                                                                                                                                                                             |
| Account menu             | "Move up" or "Move down" in either view  | The account swaps places with its neighbour in the section it is shown in, and the type view and the group view then agree on the order                                                                                                                                          |
| Accounts                 | No group exists                          | Beside "Add group", one line (`ledger.groups.lede`) says what groups are for                                                                                                                                                                                                     |
| Account form             | Group field                              | Shows the account's current group; saving it uses the same single write                                                                                                                                                                                                          |
| Add or rename group      | Name empty, over 80 characters, or taken | The reason is shown next to the field and nothing is saved                                                                                                                                                                                                                       |
| Delete group             | Always                                   | A confirmation says how many accounts are in it and that they stay as ungrouped, lists any budgets limited to it as ones that will stop counting its accounts, and lists separately those that would then count nothing; Cancel has the focus; confirming deletes only the group |
| Every screen above       | —                                        | Works with the keyboard alone; headings are real headings; the subtotal is read with the group's name                                                                                                                                                                            |

## 4. New message keys

Each key must exist in `en.json`, `uk.json` and `pl.json` (`catalogue-complete.test.ts` enforces this).

| Key                                 | English                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger.accounts.view.label`        | View                                                                                                                                   |
| `ledger.accounts.view.byGroup`      | By group                                                                                                                               |
| `ledger.accounts.view.byType`       | By type                                                                                                                                |
| `ledger.accounts.groupLabel`        | Group: {name}                                                                                                                          |
| `ledger.accounts.moveToGroup`       | Move to {name}                                                                                                                         |
| `ledger.accounts.moveToUngrouped`   | Move to Ungrouped                                                                                                                      |
| `ledger.accounts.currentGroup`      | {name} (current group)                                                                                                                 |
| `ledger.accounts.currentUngrouped`  | Ungrouped (current group)                                                                                                              |
| `status.accountMoved`               | Moved to {name}                                                                                                                        |
| `status.accountUngrouped`           | Moved out of its group                                                                                                                 |
| `ledger.groups.add`                 | Add group                                                                                                                              |
| `ledger.groups.rename`              | Rename group                                                                                                                           |
| `ledger.groups.delete`              | Delete group                                                                                                                           |
| `ledger.groups.ungrouped`           | Ungrouped                                                                                                                              |
| `ledger.groups.empty`               | No accounts in this group yet                                                                                                          |
| `ledger.groups.subtotal`            | Subtotal, {name}                                                                                                                       |
| `ledger.groups.subtotalUnavailable` | Subtotal not available yet                                                                                                             |
| `ledger.groups.deleteTitle`         | Delete the group “{name}”?                                                                                                             |
| `ledger.groups.deleteAccounts`      | {count, plural, one {# account is} other {# accounts are}} in this group. They are kept and shown as ungrouped.                        |
| `ledger.groups.deleteNoAccounts`    | No account is in this group.                                                                                                           |
| `ledger.groups.deleteBudgets`       | Budgets limited to this group: {names}. They will stop counting this group's accounts, and keep counting anything else in their scope. |
| `ledger.groups.deleteBudgetsEmpty`  | These budgets have no other limit and will count nothing afterwards: {names}. Give them another account or group first.                |
| `ledger.groups.deleteConfirm`       | Delete group                                                                                                                           |
| `ledger.error.group_name_taken`     | A group with this name already exists.                                                                                                 |

Existing keys reused: `ledger.groups.title`, `ledger.groups.new`, `ledger.groups.name`, `ledger.groups.lede`, `ledger.accounts.ungrouped`, `ledger.accounts.form.group`, `ledger.edit`, `ledger.cancel`, `ledger.save`, `ledger.error.invalid_group_name`.
