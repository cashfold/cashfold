# Feature Specification: Account Groups on the Accounts Page

**Feature Branch**: `012-account-groups-view`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Make account groups visible and useful on the Accounts page. Today a person can create groups and put accounts in them, but the Accounts page only lists accounts by type (checking, cash, credit), so a group never shows anywhere except as a choice when scoping a budget. Show the groups. The Accounts page lets a person see their accounts organised by group, with each group's name and a subtotal, and accounts that are in no group in a clearly named 'Ungrouped' place. The person can switch between viewing by group and viewing by type, and the app remembers the choice on this device. Each account shows which group it is in. Creating, renaming, deleting and choosing a group is easy to find and does not hide behind a collapsed section, and moving an account to another group takes one step. Subtotals never add amounts of different currencies together. Deleting a group still keeps its accounts, and budgets scoped to a group keep working. Everything must work in English, Ukrainian and Polish, on web and desktop, with the keyboard and a screen reader."

## Clarifications

### Session 2026-10-29

- Q: When someone has groups but has never chosen a view, should the Accounts page open "By group" or stay "By type"? → A: It opens "By group" when at least one account is in a group and no choice was made, and "By type" otherwise. A choice, once made, always wins.
- Q: When someone moves an account up or down inside a group, should that change its position in the by-type view too, or should each view keep its own order? → A: One saved order per account, shared by both views. Moving an account in a group also moves it among accounts of the same type, and no separate order is kept per group.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See accounts organised by group (Priority: P1)

A person who has put accounts into groups ("Household", "Savings", "Business") opens the Accounts page and sees their accounts organised under those groups. Each group shows its name, its accounts, and a subtotal, so they can tell at a glance how much sits in each group. Accounts that are in no group are collected under a clearly named "Ungrouped" heading.

**Why this priority**: This is the reason for the feature. Groups can be created today, but nothing on the Accounts page shows them, so they look broken and nobody can tell what they are for.

**Independent Test**: Make three accounts, put two in one group and leave one out, open the Accounts page in the group view, and check that the two accounts are under the group with the right subtotal and the third is under "Ungrouped".

**Acceptance Scenarios**:

1. **Given** at least one group with accounts in it, **When** the person opens the Accounts page in the group view, **Then** each group appears as its own section with its name as the heading, its accounts listed under it, and a subtotal.
2. **Given** a group whose accounts all use one currency, **When** the section is shown, **Then** the subtotal is the sum of those accounts' balances in that currency.
3. **Given** a group whose accounts use more than one currency, **When** the section is shown, **Then** the subtotal shows one amount per currency and never adds amounts of different currencies together.
4. **Given** accounts that are in no group, **When** the group view is shown, **Then** they appear under a heading named "Ungrouped", after the groups.
5. **Given** every account is in a group, **When** the group view is shown, **Then** no "Ungrouped" heading appears.
6. **Given** a group with no accounts, **When** the group view is shown, **Then** the group still appears, says it has no accounts yet, and shows no subtotal figure that suggests otherwise.
7. **Given** the "Show archived accounts" switch, **When** it is off, **Then** archived accounts are neither listed nor counted in a subtotal, and when it is on they are listed and counted, so a subtotal always adds up to the accounts shown under it.

---

### User Story 2 - Switch between group view and type view (Priority: P1)

A person who likes the old arrangement, by type, can keep it, and a person who thinks in groups can use that. A control on the Accounts page switches between "By group" and "By type", and the app remembers the choice on this device.

**Why this priority**: The by-type view is what everyone has today, so the new view must not take it away, and a person must be able to move between the two without effort.

**Independent Test**: Switch to "By group", reload the page and sign in again, and check that it is still "By group"; switch back and check that the accounts return to the sections by type.

**Acceptance Scenarios**:

1. **Given** at least one group exists, **When** the person opens the Accounts page, **Then** a clear control offers "By group" and "By type", and the current choice is visible and announced.
2. **Given** the person chooses "By group", **When** they reload the app or lock and unlock it, **Then** the Accounts page opens in the group view.
3. **Given** the person chooses "By type", **When** they look at the page, **Then** accounts are listed in sections by type exactly as before.
4. **Given** no group exists yet, **When** the person opens the Accounts page, **Then** the page is as it is today with no view control, and a visible "Add group" action explains that groups collect related accounts.
5. **Given** a person who has never chosen a view and has at least one account in a group, **When** they open the Accounts page, **Then** it opens by group, so the groups they made are the first thing they see.
6. **Given** a person who has never chosen a view and has no account in any group (no groups, or only empty groups), **When** they open the Accounts page, **Then** it opens by type, as it always has.
7. **Given** a person who has chosen a view, **When** their groups or accounts later change, **Then** their choice still decides the view, until they choose again.

---

### User Story 3 - Know an account's group and move it in one step (Priority: P1)

A person looking at an account sees which group it belongs to, without opening it, and can move it to another group in a single step from the account's own menu.

**Why this priority**: Without it a person must open the account's edit form, find a hidden "Group" field and save, which is why groups feel disconnected from the accounts they hold.

**Independent Test**: In the type view, check that each account shows its group; open an account's menu, choose another group, and check that the account moves at once and the old and new subtotals change.

**Acceptance Scenarios**:

1. **Given** the type view, **When** an account is in a group, **Then** the account shows that group's name next to its details; an account in no group shows no group label.
2. **Given** an account's menu, **When** the person opens it, **Then** it offers every group and "Ungrouped" as choices, with the current one marked.
3. **Given** the person picks a different group from that menu, **When** they confirm by choosing it, **Then** the account moves immediately, without opening a form, and the subtotals of both groups update.
4. **Given** the group view, **When** the person moves an account to another group, **Then** it leaves its section and appears in the new one in the order of the new group.
5. **Given** a screen reader or the keyboard alone, **When** the person moves an account, **Then** the change is announced ("Moved to Savings") and focus stays somewhere sensible, not lost.
6. **Given** an account that is moved, **When** the person checks the account's edit form, **Then** its "Group" field shows the new group.

---

### User Story 4 - Manage groups where they are shown (Priority: P2)

Creating, renaming and deleting groups, and seeing which accounts a group holds, happen on the Accounts page itself, in plain view, not inside a collapsed section.

**Why this priority**: It makes groups discoverable and removes the sense that they are an obscure setting. It follows from the first three stories.

**Independent Test**: With no groups, use the visible "Add group" action to create two groups, rename one, delete the other, and check that its accounts remain and are shown as ungrouped.

**Acceptance Scenarios**:

1. **Given** the Accounts page, **When** the person looks for group controls, **Then** "Add group" is visible without expanding anything, and each group heading offers rename and delete.
2. **Given** the person adds a group with a name, **When** they confirm, **Then** it appears at once as a section, empty, ready to receive accounts.
3. **Given** a group name that is empty, too long, or already used by another group, **When** the person tries to save it, **Then** they are told what is wrong and nothing is saved.
4. **Given** the person chooses to delete a group, **When** the confirmation opens, **Then** it says how many accounts are in it and that they will be kept and shown as ungrouped, and it names any budgets that are limited to this group and says they will stop counting its accounts, saying so plainly for a budget that would then count nothing.
5. **Given** the person confirms the deletion, **When** it finishes, **Then** the group is gone, its accounts are listed as ungrouped with their balances unchanged, and nothing else is deleted.
6. **Given** groups are renamed or deleted on another device, **When** this device next syncs, **Then** the page shows the new names, and accounts of a group deleted elsewhere appear as ungrouped.

---

### Edge Cases

- A person has many groups (for example 20): the page stays usable, with group headings that can be reached quickly by keyboard and by a screen reader's heading list, and a long page does not lose the controls.
- A group or account name is very long, or written in a script that is wider or runs right to left: names wrap or cut off cleanly and never push the subtotal or the menu out of view.
- An account is in more than one group (possible for data written by another device): it is shown under the first of its groups in the groups' order, once only, and counted in one subtotal only, so no money is counted twice.
- An account is excluded from net worth: it is listed in its group as usual, with the existing "Not in net worth" label, and its balance is counted in the group's subtotal because the subtotal adds exactly what is listed.
- A credit account with a negative balance: the subtotal adds it as a negative amount, so a group of a bank account and a credit card shows what is left after the card.
- The balance of an account cannot be shown yet (still loading): the subtotal waits until every account in the group has a balance, instead of showing a total that is too small.
- Two accounts in one group in different currencies, and a third in the same currency as the first: the subtotal shows one figure per currency, each adding only the accounts in that currency.
- The person archives the last account of a group while archived accounts are hidden: the group stays, shows that it has no accounts, and its subtotal disappears.
- The person deletes a group that a budget is limited to: the confirmation names the budget before anything is deleted. The budget stops counting that group's accounts; it keeps counting whatever else is in its scope, and a budget whose only limit was this group counts nothing afterwards and is flagged for attention, as a budget with any deleted member already is.
- The person is offline: everything on the page works, since groups and accounts are stored on the device.
- The interface is in Ukrainian or Polish: every new label, heading, message and announcement is translated, and long words fit.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The Accounts page MUST offer a view organised by group, in which each group is a section with the group's name as its heading, its accounts listed under it, and a subtotal.
- **FR-002**: In the group view, accounts that are in no group MUST appear in a section named "Ungrouped", shown after the groups, and only when there is at least one such account.
- **FR-003**: A group with no accounts MUST still be shown in the group view, with a plain statement that it has no accounts yet, and without a subtotal figure.
- **FR-004**: A group's subtotal MUST add exactly the accounts listed under it, so it changes when archived accounts are shown or hidden, and MUST NOT add amounts of different currencies together: it shows one amount per currency.
- **FR-005**: Subtotals MUST be exact to the smallest unit of each currency and MUST NOT use any rate or conversion.
- **FR-006**: The Accounts page MUST offer a control to switch between the group view and the type view whenever at least one group exists, with the current choice visible and announced to assistive technology.
- **FR-007**: The chosen view MUST be remembered on this device across reloads, locking and unlocking, and MUST NOT be synced to other devices or shared with other accounts. A person who has never chosen sees the group view when at least one account is in a group, and the type view otherwise; a person who has chosen always sees their choice.
- **FR-008**: When no group exists, the Accounts page MUST look and work as it does today, with a visible "Add group" action and no view control.
- **FR-009**: Every account MUST show which group it is in, when it is in one, in the type view, and the group view MUST make it clear through the section heading.
- **FR-010**: Each account's menu MUST offer every group and "Ungrouped" as direct choices, with the current one marked, and choosing one MUST move the account at once, without opening the edit form.
- **FR-011**: Moving an account MUST update both groups' subtotals and the account's "Group" field in the edit form, and MUST be announced to assistive technology.
- **FR-012**: Creating, renaming and deleting a group MUST be available on the Accounts page without expanding a collapsed section.
- **FR-013**: A group's name MUST have 1 to 80 characters (the existing limit) and MUST NOT duplicate another group's name, compared the way tag and payee names already are (ignoring case, accents and surrounding spaces). A refused name MUST be explained and nothing saved. Groups that already share a name are left as they are and still shown.
- **FR-014**: Deleting a group MUST require confirmation that states how many accounts are in it, says they will be kept as ungrouped, and names every budget limited to the group, saying that those budgets will stop counting its accounts and singling out any that would count nothing.
- **FR-015**: Deleting a group MUST NOT delete, change or hide any account, balance or transaction. A budget limited to the group MUST keep counting whatever else is in its scope (other accounts, groups, categories and tags); a budget whose only limit was the group counts nothing afterwards, as the existing rule for a deleted scope member says, and the confirmation warns of it beforehand.
- **FR-016**: Groups MUST be shown in their saved order, then by name. The controls that move an account up or down MUST keep working within whichever section the account is shown in, whether a group or a type. An account has one saved position that both views share, so a move in one view is the same move in the other, and no separate order is kept per group. A move exchanges the account with the neighbour above or below it in the section it is shown in, leaves every other account's relative order as it was, and produces the same order in the other view.
- **FR-017**: An account that belongs to more than one group MUST be shown and counted once, under the first of its groups in the groups' order.
- **FR-018**: The page MUST work for the keyboard alone and for a screen reader: each section has a real heading, each subtotal is read with its group's name, and every control has a name that says what it does.
- **FR-019**: Every new or changed string MUST be available in English, Ukrainian and Polish.
- **FR-020**: The feature MUST behave the same in the web app and in the desktop app, and MUST need no network.

### Key Entities

- **Account group**: A named collection of accounts, with an optional icon and colour and a saved order. It exists inside one Fold and is not shared with other Folds.
- **Group membership**: Which group an account is in. Today it can hold several groups for one account, but the page treats an account as being in one group (FR-017).
- **Group subtotal**: What the listed accounts of a group add up to, per currency. It is derived from balances and never stored or synced.
- **Accounts view choice**: Whether the Accounts page shows "By group" or "By type". It is a preference of this device.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a test with a Fold of 12 accounts in 3 groups, a person can say which group an account belongs to, and what a group holds, within 5 seconds of opening the Accounts page.
- **SC-002**: A person can move an account to another group in 2 interactions or fewer (open the menu, choose the group), with no form.
- **SC-003**: A person with no groups can create a group and put their first account in it in under 1 minute.
- **SC-004**: 100% of group subtotals equal the sum of the listed accounts' balances in each currency, and no subtotal ever mixes two currencies, checked across a set of mixed-currency, archived, negative-balance and empty-group cases.
- **SC-005**: The chosen view survives 100% of reloads and lock cycles on the same device.
- **SC-006**: The Accounts page has no accessibility violations in either view, and every action can be done with the keyboard alone.
- **SC-007**: In usability checks after release, 9 of 10 people can tell what groups are for after seeing the Accounts page once (a measured outcome, not build work).
- **SC-008**: Every new screen string appears in English, Ukrainian and Polish, with no untranslated key visible in any of them.

## Assumptions

- A person who has never chosen a view gets the group view as soon as one account is in a group, because that is when groups matter; until then, and for anyone with no grouped account, the page is as it is today. The view control appears only once a group exists, and a choice, once made, is never overridden.
- A group's subtotal adds the accounts listed under it, including accounts marked as not counted in net worth, so what a person sees adds up. The existing "Not in net worth" label stays on those accounts.
- Subtotals are per currency and use no exchange rate. A single converted total, in the Fold's base currency, is a possible later improvement and is not part of this feature.
- The page treats an account as being in one group. The existing "Group" choice in the account form is the same choice made from the menu.
- Reordering the groups themselves is out of scope: they appear in their saved order, then by name. Accounts keep their existing up and down controls within each section, and their one saved order, which both views share. No new saved data is needed for ordering.
- Showing groups elsewhere, such as group totals on the Overview or a group filter on Transactions, is out of scope and can follow.
- Budgets limited to account groups keep their current behaviour, including that a deleted group in a scope matches nothing and the budget is flagged for attention; this feature only warns about it in the delete confirmation.
- The limit of 1 to 80 characters on group names is the existing one. Refusing a duplicate name is new: today two groups may share a name, which would be confusing on a page that shows both, so the rule is added here and existing duplicates are not touched.
- Mobile shells are not part of this feature.
