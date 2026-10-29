# Research: Account Groups on the Accounts Page

Date: 2026-10-29. The spec has no open `NEEDS CLARIFICATION` items. This file records what the code does today and the decisions that follow.

## R-1 What the code already does

| Finding                                                                                                                                                                                                                      | Where                                                                     | Consequence                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The Accounts page builds its sections from `ACCOUNT_KINDS` only (`byKind`). Groups are never drawn.                                                                                                                          | `ui/accounts/AccountsScreen.tsx`                                          | The group view is a second way to build sections from the same list.                                                                            |
| `ledger.basics` already returns every account with its balance (`balanceMinor`, or `null` when it cannot be worked out) and every group, both sorted by `sortOrder`, then name, then id.                                     | `core/ledger/application/queries.ts` (`ledgerBasics`, `byOrder`)          | Group order in the spec ("saved order, then name") is what the query already gives. No new query is needed to show groups or compute subtotals. |
| A group has a name, an icon, a colour and a `sortOrder`. An account has `groupIds`, a **set**, so the data allows several groups per account. The page's form and the ledger projection treat it as one (the first match).   | `core/ledger/domain/records.ts`, `account.ts`, `AccountsScreen.tsx`       | A helper must pick one group deterministically (FR-017), by the groups' order, not by id order as the form does today.                          |
| Deleting a group writes only the group's deleted flag. Accounts keep their old `groupIds`, and the ledger projection drops ids of groups that no longer exist, so the accounts simply read as ungrouped.                     | `account-commands.ts` (`deleteAccountGroup`), `projections/ledger.ts:162` | "Deleting a group keeps its accounts" already holds. What is missing is the **confirmation**: `GroupManager` deletes at once, with none.        |
| Group names are checked for 1 to 80 characters (`invalid_group_name`). Duplicate names are **not** refused. `group_exists` is about a repeated id.                                                                           | `account-commands.ts` (`createAccountGroup`, `updateAccountGroup`)        | The duplicate-name rule (FR-013) is a new check in the two commands.                                                                            |
| Moving an account to a group today is two commands from the page (leave the old group, join the new), each a separate write.                                                                                                 | `AccountsScreen.tsx` (edit form)                                          | One command that sets the account's groups in a single write is atomic and syncs as one operation.                                              |
| `groupAccounts` uses set deltas on `ACCOUNT_FIELD.groupIds`; `category-commands.ts` already has `setTo(state, field, members)`, which writes a delta that makes a set exactly equal to the given members.                    | `account-commands.ts`, `category-commands.ts`                             | The new command can reuse `setTo`.                                                                                                              |
| The account menu is a flat list of `RowAction`s (`id`, `label`, `run`, `destructive?`, `disabled?`), shared by the actions button and the desktop right-click menu. There is no sub-menu.                                    | `ui/ledger/row-action.ts`, `account-actions.ts`, `RowActionsMenu.tsx`     | "Choose a group from the menu" means one item per group, or the 2-interaction goal (SC-002) is lost.                                            |
| A budget's scope holds `groupIds`; `budgets.list` returns every budget with its scope and name.                                                                                                                              | `core/budgeting/domain/budget.ts`, `ledger-handlers.ts` (`budgets.list`)  | The delete confirmation can name the budgets from data the page can already read.                                                               |
| Interface preferences are one defensively parsed JSON object in `localStorage` (`cashfold.ui`). `lists.showArchivedAccounts` already lives there. They are device-local and never synced; sign-out (spec 011) keeps `lists`. | `ui/prefs/schema.ts`, `reset-account.ts`                                  | The view choice is one more field of `lists`.                                                                                                   |
| The kit has `Radio`/`RadioGroup`, `Dialog`, `Sheet`, `ConfirmDialog`, `Badge`, `Amount`, and `Disclosure`.                                                                                                                   | `ui/kit/`                                                                 | No new component library work.                                                                                                                  |

## Decisions

### D-1 Section building is a pure function

- **Decision**: a new module `ui/accounts/account-sections.ts` with `groupOf(account, groups)` and `accountSections({ accounts, groups, view })`. It returns the sections to draw: for the group view, one per group in order, then "Ungrouped" if any account is in none; for the type view, the existing sections by kind. Each group section carries `totals`: one amount per currency, or `undefined` when any account in the group has no balance yet.
- **Rationale**: every rule in the spec (one group per account, subtotals per currency, empty groups, archived accounts) is data logic. As a pure function it is unit-tested without a screen, and the web package has no DOM test environment.
- **Alternatives**: compute inside the component. Rejected: untestable here and easy to get wrong for the edge cases.

### D-2 Subtotals are exact, per currency, from what is listed

- **Decision**: sum `balanceMinor` as `bigint` per currency code over exactly the accounts in the section (after the archived filter), and list the currencies in code order. No rate, no conversion, no float.
- **Rationale**: spec FR-004, FR-005 and constitution VI (exact money). It also means a subtotal always adds up to what is on screen, including accounts marked "Not in net worth".
- **Alternatives**: convert to the Fold's base currency with the Fold's rates (as net worth does). Rejected for this feature: rates can be missing, and the spec keeps conversion for later.

### D-3 One group per account in the page, chosen by the groups' order

- **Decision**: `groupOf` returns the first of the account's groups in the groups' order (the order `ledger.basics` returns). Moving an account uses a new command that sets the account's groups to exactly the chosen one (or none), which also tidies an account that was in several.
- **Rationale**: spec FR-017. The form's current "first in the account's own id order" is arbitrary and could disagree with the new view.
- **Alternatives**: show an account under every group it is in. Rejected: it would count its money twice.

### D-4 The view choice is a preference with a "never chosen" state

- **Decision**: `lists.accountsView` is `'auto' | 'group' | 'type'`, default `'auto'`, parsed defensively like its neighbours. `effectiveView(pref, accounts, groups)` returns `pref` when it is `group` or `type`; for `auto` it returns `group` if some account (archived or not) is in a group that exists, else `type`.
- **Rationale**: clarification 1. A stored `'auto'` is "never chosen"; the first press of the switch stores `'group'` or `'type'` and ends the automatic behaviour for good. The test for "some account is in a group" ignores the archived switch so the view does not jump when that switch is flipped.
- **Alternatives**: store nothing until chosen. Rejected: `auto` makes the three states explicit and testable.

### D-5 "Move to group" is a menu item per group

- **Decision**: `accountActions` takes the groups and the account's current group, and adds one action per group plus "Ungrouped", labelled "Move to {name}", after Edit. The current one is disabled and labelled "{name} (current group)". Choosing one calls the new command and announces "Moved to {name}".
- **Rationale**: spec FR-010 and SC-002 (two interactions: open the menu, choose). The flat `RowAction` model has no sub-menu, and a dialog would add a step. With many groups the menu list scrolls.
- **Alternatives**: a "Move to group…" item that opens a dialog (three steps); a sub-menu (new component, and the desktop native menu cannot nest the same way).

### D-6 One new command, one changed pair

- **Decision**: add `moveAccountToGroup { account, group | null }` to the ledger commands (a single write that sets `groupIds` to exactly the chosen group or none). Make `createAccountGroup` and `updateAccountGroup` refuse a name that another group already has, ignoring case and surrounding spaces, with a new error `group_name_taken`. Leave existing duplicates untouched.
- **Rationale**: FR-011 (atomic move), FR-013. Both are command-side rules, which belong in `core`, not in the page.
- **Alternatives**: keep two commands for the move (a failed second write would leave the account ungrouped); check names only in the page (another device could still create a duplicate, and the rule would not be tested in `core`).

### D-7 The delete confirmation reads data the page already has

- **Decision**: the confirmation counts the group's accounts from `ledger.basics` and finds budgets limited to it from `budgets.list` with a pure helper `budgetsUsingGroup(rows, groupId)`. No new query.
- **Rationale**: nothing new needs computing, and the ledger context should not read budget records (contexts talk through ids and the page). It follows YAGNI.
- **Alternatives**: a `describeGroupDeletion` query like `describeAccountDeletion`. Rejected: it would pull budget data into the ledger context.

### D-8 Group management is always visible

- **Decision**: "Add group" sits in the page's action row beside "Add account", in both views. In the group view each group's heading has its own actions (rename, delete). In the type view a visible list of the groups with the same actions replaces the collapsed `<details>`. Create and rename use one small sheet; delete uses the confirmation from D-7.
- **Rationale**: FR-012. The same two dialogs serve both views.
- **Alternatives**: keep one manager for both views. Rejected: in the group view it would repeat what the headings already show.

### D-9 Accessibility

- **Decision**: each section is a `<section>` labelled by its heading; the subtotal sits with the heading and reads "Subtotal, {group}: …" through hidden text; the view switch is a radio group with a visible label; moving an account announces through the existing polite status region; focus returns to the moved account's new row, or to its menu button when the row is gone from view.
- **Rationale**: FR-018. All of these use parts the kit already has.

### D-10 Moving up and down works on the whole list

- **Decision**: a pure `moveWithin(all, section, index, delta)` in `ui/accounts/account-order.ts` returns the new positions. It swaps the account with its neighbour in the shown section inside the full ordered list of accounts, renumbers that list from 0, and returns only the accounts whose number changed. Both views use it.
- **Rationale**: the existing `move` renumbers just the visible section from 0. That works for one kind, but in a group view it gives accounts of one group numbers that collide with accounts of the same kind in another group, so the type view's order would become arbitrary. One shared order (clarification 2) needs the move to be defined on the whole list.
- **Alternatives**: keep renumbering the section (breaks the shared order); keep a separate order per group (new saved data, rejected in the clarification).

### D-11 What deleting a group does to budgets

- **Decision**: no change to budgets. A budget's scope keeps the deleted group's id, and the existing rule treats a missing scope member as matching nothing and flags the budget (`budgeting.scope_orphan`). So a budget with other accounts, groups, categories or tags keeps counting those, and one whose only limit was the group counts nothing. The confirmation tells the person this, and lists those budgets apart. The page works it out with a pure `budgetsUsingGroup(rows, groupId, liveGroupIds)` over `budgets.list`.
- **Rationale**: changing how budgets treat deleted members is a separate decision with its own risk (silently widening a budget would be worse). Warning is cheap and honest.
- **Alternatives**: remove the group from budgets' scopes on delete (a write to every such budget, and an empty scope would mean "everything", which silently broadens it).

## Out of scope (confirmed)

Reordering groups; converting subtotals to the base currency; group totals on the Overview; a group filter on Transactions; collapsing sections.

## Desktop check (T037, 2026-10-29)

Searched `apps/desktop/src` and `apps/desktop/e2e` for `Account groups`, `kind-` ids, `GroupManager` and the group message keys: none. The desktop specs that touch the Accounts page (`sync-parity`, `data-location`, `backup`) only read `account-row` and `account-balance` by test id, and both are unchanged. No desktop spec drives the group view, so none was added.

One desktop-specific finding: the native pop-up menu (`PopupMenuRequestSchema` in `packages/platform/src/schemas.ts`) takes at most 12 items with ids of 1 to 24 lower-case letters and hyphens. The one-per-group "Move to" actions have ids `move-to:<group id>` and could exceed 12, so `AccountsScreen` leaves them out of the right-click menu; the actions button on the row still lists them all.
