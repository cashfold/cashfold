---
description: "Task list for Account Groups on the Accounts Page"
---

# Tasks: Account Groups on the Accounts Page

**Input**: Design documents from `/specs/012-account-groups-view/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/account-groups-ui.md, quickstart.md

**Tests**: Included. The constitution requires test-first work for core and worker code and Playwright coverage for every P1 and P2 story, and the spec requires the three catalogues to stay complete (FR-019), accessible pages (FR-018) and exact subtotals (SC-004).

**Organization**: Grouped by user story. The message keys (in `apps/web/src/ui/i18n/messages/{en,uk,pl}.json`, parity enforced by `catalogue-complete.test.ts`) are all added once in T002, with the English text in `contracts/account-groups-ui.md` §4 (24 keys).

**Test environment**: the web package has no DOM test environment. Page logic is kept in pure modules, and components that need a test take `t` and their data as props so `renderToStaticMarkup` can draw them (as `apps/web/src/ui/shell/HelpDialog.test.tsx` does). Interactions are covered by Playwright. Core commands are tested with the fakes in `packages/core/src/testing`. Worker commands against the real database run as scenarios in `apps/web/src/adapters/sqlite-opfs/test-scenarios.ts`, started by `us1.browser.test.ts` (`env -u ELECTRON_RUN_AS_NODE pnpm --filter @cashfold/web test:browser`). Run Playwright with `--workers=3` and one run at a time.

**Rules quoted from `data-model.md`**:

- A group name has 1 to 80 characters (existing `invalid_group_name`), and is refused (`group_name_taken`) when another live group has the same name, compared with `sameLabel` (ignoring case, accents and surrounding spaces, as tag and payee names are). Renaming a group to a name that differs from its own only by case or spaces is allowed. Groups that already share a name are left alone.
- `lists.accountsView` is `'auto' | 'group' | 'type'`, default `'auto'`, anything else parses to `'auto'`.
- A move up or down swaps the account with its neighbour in the section it is shown in, inside the full list of accounts in their saved order, then renumbers that list from 0 and writes only the accounts whose number changed. One saved order serves both views.
- An account's group is the first of its `groupIds` that is a live group, in the groups' order. A subtotal is, per currency, the sum of `balanceMinor` (a `bigint`) of the accounts listed in the section, currencies in code order, `undefined` while any listed account's balance is `null`, and absent for an empty group.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 see accounts by group, US2 switch views, US3 know and move an account's group, US4 manage groups where they are shown

## Phase 1: Setup

- [X] T001 Read `apps/web/src/ui/accounts/{AccountsScreen,GroupManager,account-actions}.tsx` (and `account-actions.test.ts`), `apps/web/src/ui/ledger/{row-action.ts,RowActionsMenu.tsx,LedgerProvider.tsx}`, `apps/web/src/ui/prefs/{schema.ts,schema.test.ts}`, `apps/web/src/ui/shell/StatusProvider.tsx`, `apps/web/src/worker/ledger-handlers.ts`, `packages/core/src/ledger/application/{account-commands.ts,account-commands.test.ts,queries.ts}`, `packages/core/src/ledger/application/category-commands.ts` (`setTo`) and `packages/core/src/budgeting/domain/budget.ts` (`scope.groupIds`). Confirm each matches `research.md` R-1; note any difference there before coding.

## Phase 2: Foundational (blocks all stories)

**Goal**: the messages exist, the page can build sections with exact subtotals, and it knows which view to show.

- [X] T002 [P] Add the 24 message keys of `contracts/account-groups-ui.md` §4 (`ledger.accounts.view.*`, `ledger.accounts.groupLabel`, `ledger.accounts.moveToGroup`, `ledger.accounts.moveToUngrouped`, `ledger.accounts.currentGroup`, `ledger.accounts.currentUngrouped`, `status.accountMoved`, `status.accountUngrouped`, `ledger.groups.add`, `.rename`, `.delete`, `.ungrouped`, `.empty`, `.subtotal`, `.subtotalUnavailable`, `.deleteTitle`, `.deleteAccounts`, `.deleteNoAccounts`, `.deleteBudgets`, `.deleteBudgetsEmpty`, `.deleteConfirm`, `ledger.error.group_name_taken`) in English, Ukrainian and Polish in `apps/web/src/ui/i18n/messages/en.json`, `uk.json`, `pl.json`. Reuse the words already used for "group", "account", "budget" and "ungrouped" in each language, and the ICU plural form used by `data.restore.done`. `catalogue-complete.test.ts` must pass.
- [X] T003 [P] Write failing tests in `apps/web/src/ui/accounts/account-sections.test.ts` for `groupOf(account, groups)` and `accountSections({ accounts, groups, view })` (`view` is `'group' | 'type'`; `accounts` are the accounts to list, already filtered for archived ones). Cases: `groupOf` returns the first of the account's `groupIds` that is in `groups`, in the order of `groups` and not in the account's own id order, and `undefined` for an account with none or only deleted groups; an account in two groups appears once, under the earlier group, and in no other section; the group view has one section per group in `groups` order (kind `group`) and then one `ungrouped` section only when some listed account has no group; a group with no listed accounts is a section with `accounts: []` and `totals: undefined`; a section's `totals` is, per currency in currency-code order, the `bigint` sum of `balanceMinor` of its accounts (two USD accounts and one EUR account give two entries, never one); negative balances subtract; `totals` is `'unavailable'` when any account in the section has `balanceMinor: null`; the type view returns one section per account kind in `ACCOUNT_KINDS` order, holding only kinds that have accounts, each with `totals: undefined`, in the order the accounts were given; the input is not changed; and building the sections for 200 accounts and 30 groups takes under 50 ms.
- [X] T004 Create `apps/web/src/ui/accounts/account-sections.ts` with `groupOf`, `accountSections`, and the types `AccountSection` (`key`, `kind: 'group' | 'ungrouped' | 'type'`, `group?`, `accountKind?`, `accounts`, `totals`) and `CurrencyTotal` (`currency`, `minor: bigint`) per T003. Sums use `bigint` only; no floating point. Make T003 pass, and run `pnpm check:no-float`.
- [X] T005 [P] Write failing tests in `apps/web/src/ui/accounts/account-order.test.ts` for a pure `moveWithin(all, section, index, delta)`, where `all` is every account `{ id, sortOrder }` in the saved order, `section` the accounts shown in one section in their order, and the result a `Map<id, newSortOrder>` of only the accounts whose number changes, or `undefined` when the move would leave the section. Cases: the account swaps places with its neighbour in the section and every other account keeps its relative order; the case that breaks a per-section renumbering (checking accounts X in group A with order 5, Y in group B with 1, Z in group A with 7: moving X down in A gives the order Y, Z, X in the whole list, with no two accounts sharing a number); accounts of different kinds interleaved in the list; accounts with equal `sortOrder` (ties) end up with distinct numbers; moving the first up or the last down returns `undefined`; a section of one account returns `undefined`; accounts that do not change number are not in the result; the input is not changed; and applying the result to the list gives the same order whether the section was a group or a type.
- [X] T006 Create `apps/web/src/ui/accounts/account-order.ts` with `moveWithin` per the task above. Make it pass.
- [X] T007 [P] Write failing tests in `apps/web/src/ui/prefs/schema.test.ts` for `lists.accountsView`: the default is `'auto'`; `'group'`, `'type'` and `'auto'` are kept; any other value, a number or a missing field becomes `'auto'` without touching `showArchivedAccounts` or the other preferences; serialising and parsing again gives the same value; `resetAccountPrefs` (`apps/web/src/ui/prefs/reset-account.ts`) keeps it (a device preference).
- [X] T008 In `apps/web/src/ui/prefs/schema.ts` add `accountsView: 'auto' | 'group' | 'type'` to `Prefs['lists']`, `DEFAULT_PREFS` and `parsePrefs` (use the existing `oneOf` helper, fallback `'auto'`), and add a test in `reset-account.test.ts` for T007's last case. Make T007 pass.
- [X] T009 [P] Write failing tests in `apps/web/src/ui/accounts/accounts-view.test.ts` for `effectiveView(pref, accounts, groups)`: a stored `'group'` or `'type'` is returned as it is, whatever the data; `'auto'` gives `'group'` when some account (archived or not) is in a group that exists, and `'type'` when there are no groups, only empty groups, or only deleted groups; the archived switch is not an input, so flipping it never changes the result.
- [X] T010 Create `apps/web/src/ui/accounts/accounts-view.ts` with `effectiveView` per T009. Make T009 pass.

**Checkpoint**: `pnpm vitest run packages/core apps/web` is green; nothing on screen has changed yet.

## Phase 3: User Story 1 - See accounts organised by group (Priority: P1) 🎯 MVP

**Goal**: with accounts in groups, the Accounts page shows each group as a section with its accounts and an exact per-currency subtotal, and the rest under "Ungrouped".

**Independent Test**: make three accounts, put two in a group and leave one out, open the Accounts page, and see the two under the group with the right subtotal and the third under "Ungrouped" (spec User Story 1, SC-004).

### Tests for User Story 1 (write first; they must fail)

- [X] T011 [P] [US1] Create `apps/web/src/ui/accounts/GroupSection.test.tsx` rendering a presentational `GroupSectionView({ t, locale, section, actions, children })` with `renderToStaticMarkup`: a `group` section has its name in an `h2`, its subtotal with hidden text `ledger.groups.subtotal` (with the group's name) and one formatted amount per currency (two currencies are two amounts, never one number), and the section is labelled by its heading; an `ungrouped` section's heading is `ledger.groups.ungrouped` and has no actions; an empty group says `ledger.groups.empty` and shows no amount; `totals: 'unavailable'` shows `ledger.groups.subtotalUnavailable` and no amount; a negative total keeps its sign.

### Implementation for User Story 1

- [X] T012 [US1] Create `apps/web/src/ui/accounts/GroupSection.tsx` with `GroupSectionView` per T011 and a thin wrapper using `useI18n`. It renders `<section aria-labelledby>`, the heading, the subtotal beside it (the kit `Amount` for each currency, joined by a separator that reads well aloud), an `actions` slot in the heading row, and the account list as `children`. Make T011 pass.
- [X] T013 [US1] In `apps/web/src/ui/accounts/AccountsScreen.tsx` build the sections with `accountSections({ accounts, groups, view })`, where `accounts` is the existing filtered list (archived ones hidden unless the switch is on) and `view = effectiveView(pref, basics.accounts, groups)` with `pref = usePrefs((p) => p.lists.accountsView)`. For `view === 'group'` draw each section with `GroupSection` (an `ungrouped` section after the groups); for `'type'` keep the existing sections by type exactly as they are. The up and down controls keep working inside whichever section the account is in, and now use `moveWithin(basics.accounts, section.accounts, index, delta)` from `account-order.ts` in both views, writing `ledger.updateAccount { changes: { sortOrder } }` only for the accounts it returns (replacing the existing `move`, which renumbers just the visible section). Keep the empty-state and "no accounts yet" behaviour.
- [X] T014 [US1] Create `e2e/ux-account-groups.spec.ts` (follow `e2e/ux-accounts.spec.ts` and `e2e/us2-ledger.spec.ts`; Chromium and Firefox, skipping WebKit as the other ledger specs do) with the User Story 1 tests: with three accounts, two in a group (use the existing account form's Group field for now), the page opens by group with the group's name as a heading, the two accounts under it and a subtotal that equals the sum, and the third under "Ungrouped"; a group with a USD and a EUR account shows two amounts and no combined figure; an empty group is shown with "No accounts in this group yet" and no amount; archiving an account with the archived switch off drops it from the list and the subtotal, and switching it on brings both back; no "Ungrouped" heading when every account is in a group; moving an account down inside a group swaps it with the account below it in that group.

**Checkpoint**: groups are visible, with correct subtotals, in the group view.

## Phase 4: User Story 2 - Switch between group view and type view (Priority: P1)

**Goal**: a person can switch between "By group" and "By type", and the choice is remembered on this device; "never chosen" opens by group once an account is grouped.

**Independent Test**: switch to "By group", reload and lock and unlock, and see it is still "By group"; switch back and see the sections by type (spec User Story 2, SC-005).

### Tests for User Story 2 (write first; they must fail)

- [X] T015 [P] [US2] Create `apps/web/src/ui/accounts/AccountsViewSwitch.test.tsx` rendering a presentational `AccountsViewSwitchView({ t, value, onChange })` with `renderToStaticMarkup`: a radio group with the visible label `ledger.accounts.view.label`, two options `ledger.accounts.view.byGroup` and `ledger.accounts.view.byType`, the current one checked; it is a real `radiogroup` so a screen reader announces the choice.

### Implementation for User Story 2

- [X] T016 [US2] Create `apps/web/src/ui/accounts/AccountsViewSwitch.tsx` (the view from T015 using the kit `Radio`/`RadioGroup`, and a wrapper). Make T015 pass.
- [X] T017 [US2] In `AccountsScreen.tsx` render the switch only when at least one group exists, in the page header area, wrapping cleanly on a narrow screen; its `value` is the effective view and `onChange` stores `'group'` or `'type'` with `prefsStore.update((p) => ({ ...p, lists: { ...p.lists, accountsView: choice } }))`. With no groups the page has no switch (spec FR-008).
- [X] T018 [US2] Extend `e2e/ux-account-groups.spec.ts` with the User Story 2 tests: with no group there is no switch and the page is by type; with a group but no account in it the page is still by type and the switch is shown; moving the first account into a group and reloading opens by group (never chosen); choosing "By type" and reloading, and locking and unlocking, keeps by type even though accounts are grouped; choosing "By group" keeps by group after a reload; with no group the page shows the one line that says what groups are for beside "Add group"; the switch is reachable and operable with the keyboard, and axe finds no violation in either view.

**Checkpoint**: both arrangements work and the choice survives reloads. This is the MVP: run `pnpm check:bundle` from a clean build (`rm -rf apps/web/.next apps/web/out` first) before going on, since the worker bundle limit has little headroom.

## Phase 5: User Story 3 - Know an account's group and move it in one step (Priority: P1)

**Goal**: each account shows its group, and its menu moves it to another group (or out of one) in one step, atomically.

**Independent Test**: in the type view, see each account's group; open an account's menu, choose another group, and see it move at once with both subtotals updated (spec User Story 3, SC-002).

### Tests for User Story 3 (write first; they must fail)

- [X] T019 [P] [US3] Extend `packages/core/src/ledger/application/account-commands.test.ts` for a new command `moveAccountToGroup({ fold, account, group })` (`group` is an id or `null`): moving an account with no group into a group makes `groupIds` exactly that group; moving it to another group removes the first; `group: null` empties `groupIds`; an account that was in two groups ends in exactly one; the move is one submitted write, not two; `unknown_group` for a group that does not exist or is deleted, and `not_found` for an account that does not exist, in both cases with nothing written; a viewer cannot do it (editor role). Add a convergence case in the style of `transfer.convergence.test.ts`: two replicas move the same account to different groups, and two replicas where one moves an account while the other deletes the target group, and both settle on the same state with the account in no live group (read as ungrouped).
- [X] T020 [P] [US3] Extend `apps/web/src/ui/accounts/account-actions.test.ts`: `accountActions` takes `groups` (id and name, in order) and `currentGroup` (an id or `undefined`) and, after the Edit action, returns one action per group with id `move-to:<groupId>` and label `labels.moveToGroup(name)`, then `move-to:none` with `labels.moveToUngrouped`; the action of the current group (or of "ungrouped" when there is none) is `disabled` and its label is the "current group" label; with no groups there are no such actions and the existing list is unchanged; running one calls `moveToGroup(groupId | null)`.

### Implementation for User Story 3

- [X] T021 [US3] In `packages/core/src/ledger/application/account-commands.ts` add and export `moveAccountToGroup` (editor role, `foldOf: (c) => c.fold`): load the account (`not_found` otherwise) and, when `group` is not `null`, the group (`unknown_group` unless it is a live account group), then submit one draft with `sets: new Map([[ACCOUNT_FIELD.groupIds, setTo(state, ACCOUNT_FIELD.groupIds, group === null ? [] : [group])]])` reusing `setTo` from `category-commands.ts` (move it to a shared module if importing it creates a cycle). Add it to the object `createAccountCommands()` returns. Make T019 pass.
- [X] T022 [US3] In `apps/web/src/worker/ledger-handlers.ts` add `'ledger.moveAccountToGroup': { def: accounts.moveAccountToGroup as unknown as AnyCommand }` beside the other group handlers.
- [X] T023 [US3] Add a scenario `groupMove` to `apps/web/src/adapters/sqlite-opfs/test-scenarios.ts` with its test in `us1.browser.test.ts`, following the `localOnly` scenario: sign up, create two groups and an account, move it into the first and then the second through the RPC `ledger.moveAccountToGroup`, and read `ledger.basics` after each (the account's `groupIds` is exactly one group, then the other, then empty for `group: null`); a move to a deleted group returns `unknown_group` and changes nothing.
- [X] T024 [US3] In `apps/web/src/ui/accounts/account-actions.ts` implement the group actions per T020 (new optional inputs so existing callers still compile). Make T020 pass.
- [X] T025 [US3] In `AccountsScreen.tsx` pass `groups`, the account's `groupOf` and a `moveToGroup` function to `accountActions`; the function calls `ledger.run('ledger.moveAccountToGroup', { account, group })`, shows an error with `ledger.explain` if it fails, and on success announces through `status.notify('status.accountMoved', { name })` (or `'status.accountUngrouped'`). In the type view show a `Badge` with `ledger.accounts.groupLabel` beside the name of an account that has a group. Change the account form's save path to use the same command when the group field changed (replacing the two `ledger.groupAccounts` calls), and make the account form's create path do the same: when a new account is made with a group, call `ledger.moveAccountToGroup` for it after it is created instead of `ledger.groupAccounts`. After a move keep focus on the account's menu button, which is still on the page in both views unless the account left the visible section, in which case focus goes to the heading of the section it moved to.
- [X] T026 [US3] Extend `e2e/ux-account-groups.spec.ts` with the User Story 3 tests: in the type view each grouped account shows "Group: {name}" and an ungrouped one shows no label; the account menu lists "Move to {group}" for every group and "Move to Ungrouped" with the current one disabled and marked; choosing one moves the account at once with no form, both subtotals change, a status message "Moved to {group}" is announced, and the account form's Group field then shows the new group; moving in the group view puts the account in the new section; with 20 groups the menu scrolls and its last item is reachable and chosen by keyboard; axe finds no violation with the menu open; "Move up" and "Move down" on an account in the group view reorder it among its group, and the type view then lists the accounts of that type in the order the group view implies.

**Checkpoint**: an account's group is visible and changes in one step.

## Phase 6: User Story 4 - Manage groups where they are shown (Priority: P2)

**Goal**: creating, renaming and deleting groups happens on the Accounts page in plain view, with a delete confirmation that says what is kept and which budgets use the group.

**Independent Test**: with no groups, use the visible "Add group" to create two, rename one, delete the other, and see its accounts stay and read as ungrouped (spec User Story 4, SC-003).

### Tests for User Story 4 (write first; they must fail)

- [X] T027 [P] [US4] Extend `packages/core/src/ledger/application/account-commands.test.ts` for the name rule on `createAccountGroup` and `updateAccountGroup`: a name another live group has, compared with `sameLabel` (`household` with extra spaces around it, `Household`, and `Café` against `Cafe`), is refused with `group_name_taken` and nothing is written; a name of 1 to 80 characters that is free is accepted and an empty or 81-character name is still `invalid_group_name`; renaming a group to its own name, or to its own name in another case or with extra spaces, is accepted; names in Cyrillic and Polish that differ only by case (`Заощадження` and `заощадження`, `Oszczędności` and `oszczędności`) are refused, and ones that differ in letters are not; a group that was deleted frees its name; two groups that already share a name can both still be renamed to other names, and one of them can be renamed to the shared name only if it is the same group.
- [X] T028 [P] [US4] Extend `apps/web/src/ui/accounts/accounts-view.test.ts` for `budgetsUsingGroup(rows, groupId, liveGroupIds)`: returns `{ name, countsNothing }` for each budget whose `budget.scope.groupIds` includes the group, in the rows' order, and an empty list when none does or when `rows` is empty; it ignores budgets that use other groups. `countsNothing` is true when the budget has no `accountIds` and every other group in its scope is not in `liveGroupIds` (the group being deleted is its only live limit), and false when it has accounts or another live group.
- [X] T029 [P] [US4] Create `apps/web/src/ui/accounts/GroupDialogs.test.tsx` rendering presentational `GroupFormView({ t, mode, name, error, onChange, onSubmit, onCancel })` and `GroupDeleteView({ t, name, accountCount, budgets, onConfirm, onCancel })` (`budgets` is the `{ name, countsNothing }` list) with `renderToStaticMarkup`: the form has a required name field with `maxLength` 80, shows its error in a `role="alert"`, and has the confirm and cancel buttons; the delete view says how many accounts are in the group and that they are kept as ungrouped (`ledger.groups.deleteAccounts`), says `ledger.groups.deleteNoAccounts` for none, lists the budgets that keep some scope with `ledger.groups.deleteBudgets`, and those with `countsNothing` apart with `ledger.groups.deleteBudgetsEmpty`, each list only when it has entries, and its Cancel button carries `data-autofocus`.

### Implementation for User Story 4

- [X] T030 [US4] In `packages/core/src/ledger/application/account-commands.ts` add the duplicate-name check to `createAccountGroup` and `updateAccountGroup` per T027: after `cleanName`, compare the name with every live group's other than the one being updated using `sameLabel` (exported by `category-commands.ts`, the rule tags and payees already use); return `err('group_name_taken', 'A group with this name already exists')` and add `'group_name_taken'` to `GroupError`. Make T027 pass.
- [X] T031 [US4] In `apps/web/src/ui/accounts/accounts-view.ts` add `budgetsUsingGroup` per T028 (taking the rows `budgets.list` returns and the ids of the live groups). Make T028 pass.
- [X] T032 [US4] Create `apps/web/src/ui/accounts/GroupDialogs.tsx` with the two views from T029 and wrappers: a create-or-rename sheet (kit `Sheet`) that calls `ledger.run('ledger.createGroup', { name })` or `'ledger.updateGroup', { id, name }` and shows the reason from `ledger.explain` on failure, and a delete confirmation (kit `ConfirmDialog`/`Dialog`) that reads `budgets.list` through `ledger.read` when it opens, works out the budgets to name with `budgetsUsingGroup(rows, groupId, liveGroupIds)` (the ids of the live groups come from `ledger.basics`), counts the group's accounts from `ledger.basics`, and calls `ledger.run('ledger.deleteGroup', { id })` on confirm. Make T029 pass.
- [X] T033 [US4] Rework `apps/web/src/ui/accounts/GroupManager.tsx`: drop the collapsed `<details>` and its inline forms; render a visible list of the groups, each with `ledger.groups.rename` and `ledger.groups.delete` actions that open the dialogs from T032, and no list when there are no groups. It is shown in the type view only.
- [X] T034 [US4] In `AccountsScreen.tsx` put an "Add group" button (`ledger.groups.add`) beside "Add account" in the page's actions, always visible in both views, opening the create dialog; in the group view give each `GroupSection` an `actions` slot with rename and delete for that group (an `ungrouped` section has none); show `GroupManager` in the type view. When there are no groups, show `ledger.groups.lede` as one line beside "Add group" saying what groups are for.
- [X] T035 [US4] Extend `e2e/ux-account-groups.spec.ts` with the User Story 4 tests: "Add group" is visible with no groups and with some, without expanding anything; creating two groups shows them at once; an empty, 81-character and duplicate name (`household` against `Household`, compared ignoring case and spaces) each show a reason and save nothing; renaming updates the heading and every account's label; deleting shows how many accounts are in the group and that they are kept, and names the budgets limited to the group (create one limited to the group and one limited to the group and to an account first), saying that the first will count nothing and that the second will keep counting its account; confirming deletes only the group, its accounts stay under "Ungrouped" with the same balances, the budget with another limit keeps counting that account, and the one limited only to the group counts nothing and shows in needs attention; Cancel has the focus and cancels. In a second browser context signed in to the same account on the relay (follow `e2e/us4-sync.spec.ts`), a rename and a delete made on the first appear on the second, where the deleted group's accounts read as ungrouped.

**Checkpoint**: groups can be made, renamed and deleted from where they are shown, safely.

## Phase 7: Polish and cross-cutting

- [X] T036 [P] Extend `e2e/ux-account-groups.spec.ts` for language and layout: the Accounts page in both views, the move menu, the group dialogs and the delete confirmation in Українська and Polski with no raw message key visible (use the check from `e2e/us10-local-only.spec.ts`); axe on both views and the dialogs; a 360 px wide window where the switch and "Add group" wrap and the page does not scroll sideways; a very long group name and a right-to-left locale do not push the subtotal or the menu out of view (FR-018, FR-019, SC-006, SC-008).
- [X] T037 [P] Check `apps/desktop` for anything that assumes the old Accounts layout or the collapsed group manager (search `apps/desktop/src` and `apps/desktop/e2e` for `Account groups`, `kind-` ids and `GroupManager`); expect none. Record the result in `specs/012-account-groups-view/research.md`. Add the group view check to the desktop e2e only if an existing spec already drives the Accounts page.
- [X] T038 Run `pnpm check:bundle` and confirm the worker and lazy JS stays under 278 KiB (284,672 bytes) from a clean build (`rm -rf apps/web/.next apps/web/out` first). If it does not, find what was copied into many route chunks (the technique in `specs/011-sign-out-switch-account/research.md`) and load it on first use instead of raising the limit.
- [X] T039 Run `pnpm verify`, `pnpm check:no-float`, `pnpm check:bundle`, `pnpm check:docs`, the browser tests (`env -u ELECTRON_RUN_AS_NODE pnpm --filter @cashfold/web test:browser`) and `pnpm test:e2e --workers=3` (one Playwright run at a time); fix what fails. The scheduling convergence property test (`materialise.convergence.test.ts`) is known to time out intermittently under load; run it alone before treating a failure as new.
- [ ] T040 Walk through every row of `specs/012-account-groups-view/quickstart.md` by hand on the web build and the desktop app, and tick each against the spec requirement it names. Record anything that differs.

## Dependencies and order

- **Phase 1 → Phase 2 → stories**. In Phase 2: T002, T003, T005, T007 and T009 can run in parallel; T004 follows T003, T006 follows T005, T008 follows T007, T010 follows T009. Every story needs T004, T008 and T010, and the screen (T013) also needs T006.
- **US1** needs Phase 2. T011 first, then T012, then T013 (which edits `AccountsScreen.tsx`), then T014.
- **US2** needs T013 (the group view to switch to). T015, then T016, then T017, then T018.
- **US3** needs T013. The core work (T019, T021), the worker and scenario (T022, T023) and the actions (T020, T024) are independent of the screen and can start after Phase 2; T025 needs T021, T022 and T024 and edits `AccountsScreen.tsx` after T017; T026 last.
- **US4** needs T013. The core rule (T027, T030), the helper (T028, T031) and the dialogs (T029, T032) are independent of each other; T033 and T034 need T032 and edit `AccountsScreen.tsx` after T025; T035 last. T030 and T021 both edit `account-commands.ts`, so do them one after the other.
- **Polish** needs the stories it tests. T036 and T037 can run in parallel; T038 to T040 last.

## Parallel examples

- Phase 2 start: T002, T003, T005, T007 and T009 together (five different files).
- Core work of the later stories, once Phase 2 is done: T019, T020, T027, T028 and T029 together (five different test files).
- In Polish: T036 and T037 together.

## Implementation strategy

- **MVP**: Phase 2, User Story 1 and User Story 2. Together they answer the original complaint: the groups are visible, with subtotals, and a person can move between the two arrangements. Stop here, run T038 and T039 (the bundle check at the end of US2 has already run), and ship if needed.
- **Then**: User Story 3 (one-step moving), which is what makes groups pleasant to use, and User Story 4 (management in plain view and a safer delete). US4's duplicate-name rule is a behaviour change, so say so in the pull request.
- **Order inside a story**: tests, then the pure module or core command, then the worker, then the screen, then the end-to-end test. Each task leaves the repository type-checking and the tests green.
- **Reviews**: this touches no authentication, sync session or sharing, so the usual one reviewer applies. No cryptography, protocol or wire format changes, so no ADR. Commit text follows the project rule: no attribution lines.
