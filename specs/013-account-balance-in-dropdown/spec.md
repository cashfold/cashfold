# Feature Specification: Account Balance in Account Dropdowns

**Feature Branch**: `013-account-balance-in-dropdown`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "In dropdown for accounts we should add an amount of the accounts. It will improve the overall experience of the users and simplify the flow for them"

## Clarifications

### Session 2026-10-30

- Q: Does "an amount of the accounts" mean each account's current balance shown next to its name? → A: Yes, the current balance of each account, shown next to its name in the open list.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See each account's balance when choosing an account (Priority: P1)

When a person opens any dropdown that asks them to pick an account (for example, when adding a transaction), each account in the list shows its name and its current balance. They can tell which account has enough money, or which is which, without leaving the form to check the Accounts page.

**Why this priority**: This is the whole request. It removes a trip to another screen and reduces picking the wrong account.

**Independent Test**: Open the account dropdown on the transaction form in a Fold with several accounts. Every option shows the account name and its current balance in the account's own currency, matching the balance on the Accounts page.

**Acceptance Scenarios**:

1. **Given** a Fold with accounts that have balances, **When** the person opens an account dropdown, **Then** each option shows the account name and its current balance with its currency.
2. **Given** an account with a negative balance, **When** the dropdown is open, **Then** the balance is shown as negative and is clearly distinguishable from a positive one.
3. **Given** accounts in different currencies, **When** the dropdown is open, **Then** each balance is shown in that account's own currency, never added or converted.
4. **Given** an option is chosen, **When** the dropdown closes, **Then** the closed control still shows the chosen account in a way that identifies it (the balance may be omitted there if it would not fit).

---

### User Story 2 - Same behaviour in every account dropdown (Priority: P2)

Every place that asks the person to choose an account (transactions, transfers' target account, schedules, the Overview chart, CSV import) shows balances the same way, so the app feels consistent.

**Why this priority**: A balance in one dropdown but not another feels like a bug, but the first dropdown already delivers most of the value.

**Independent Test**: Open each account dropdown in the app and check that the option layout and balance format are identical.

**Acceptance Scenarios**:

1. **Given** any screen with an account dropdown, **When** it is opened, **Then** options show name and balance in the same format as in every other account dropdown.
2. **Given** a dropdown that already shows the currency next to the name, **When** it is opened, **Then** the currency is not shown twice.

---

### User Story 3 - Balances stay readable and accurate (Priority: P3)

Balances are correct at the moment the dropdown is opened, are readable on small screens and with long account names, and work with keyboard and screen readers.

**Why this priority**: Quality of the main feature; it matters but is not the value on its own.

**Independent Test**: With a long account name on a narrow window, open the dropdown with the keyboard only and listen with a screen reader; name and balance are both reachable and understandable.

**Acceptance Scenarios**:

1. **Given** a very long account name, **When** the dropdown is open on a narrow screen, **Then** the balance remains fully visible and the name is shortened.
2. **Given** a screen reader user, **When** they move through the options, **Then** each option is announced with the account name and its balance.
3. **Given** a transaction was just added, **When** the dropdown is opened again, **Then** the balances include that transaction.

### Edge Cases

- A new account with no transactions shows a zero balance, not a blank.
- Archived accounts that appear in a dropdown show their balance the same way; archived accounts that are hidden today stay hidden.
- Accounts marked "not in net worth" still show their balance.
- Very large or very small amounts keep the app's usual number formatting and the person's language and locale.
- A Fold with a single account still shows the balance in the dropdown.
- If a balance cannot be worked out (for example, it is too large to hold), the account name is shown without a balance rather than a wrong amount. Account dropdowns only appear once the Fold's accounts are loaded, so there is no half-loaded state to handle.
- The dropdown for choosing an account *group* or any non-account list is not changed.
- Multi-select account pickers (such as the budget's account scope) are out of scope; this feature covers single-choice account dropdowns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every dropdown that asks the person to choose an account MUST show, for each option, the account name and its current balance.
- **FR-002**: The balance MUST be shown in the account's own currency using the app's existing money formatting and the person's language and locale.
- **FR-003**: The balance MUST equal the balance shown for the same account on the Accounts page at the same moment.
- **FR-004**: Negative balances MUST be visibly distinct from positive ones, consistent with how the app shows them elsewhere.
- **FR-005**: The system MUST NOT add up, convert or compare balances across currencies in these dropdowns.
- **FR-006**: Name and balance MUST be visually separated (for example, name on the start side, balance on the end side) so that a long name never hides the balance.
- **FR-007**: Account dropdowns MUST show the balance in one consistent format across all screens, and MUST NOT repeat a currency that the balance already carries.
- **FR-008**: Each option MUST be announced to assistive technology with both the account name and its balance, and keyboard selection MUST keep working as it does today.
- **FR-009**: The balance MUST be the same balance the Accounts page shows for that account, and MUST be current at the moment the dropdown is opened.
- **FR-010**: Which accounts are offered in each dropdown (for example, excluding archived accounts or the source account of a transfer) MUST NOT change.
- **FR-011**: The new text for any balance wording MUST be available in English, Ukrainian and Polish.
- **FR-012**: Showing balances MUST NOT send any financial data to the server; it is computed on the person's device from already available data.

### Key Entities

- **Account**: A place where money is held, with a name, a currency and a current balance.
- **Account balance**: The current amount in an account, derived from its transactions in the account's own currency. It is not stored separately.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test with 8 accounts, a person can find the account with the most money from the dropdown alone, without opening another screen, in under 10 seconds.
- **SC-002**: 100% of account options in every account dropdown show a balance equal to the Accounts page balance, checked across positive, negative, zero, archived and multi-currency cases.
- **SC-003**: In a manual check, a person adding a transaction can see the balance of every account without leaving the form (zero extra screen visits).
- **SC-004**: Every account dropdown passes automated accessibility checks and can be used entirely with the keyboard.
- **SC-005**: Every new string appears in English, Ukrainian and Polish, with no untranslated key visible.
- **SC-006**: With a 60-character account name on a 360px-wide screen, the full balance stays visible in 100% of options.

## Assumptions

- "Amount of the accounts" means each account's **current balance** (what the account holds now), not the number of accounts. Confirmed by the requester.
- The balance is shown in every single-choice account dropdown in the app, including those for a transfer's destination, schedules, overview and CSV import, because consistency is part of the goal.
- When the dropdown is closed, the selected account may show just its name (and currency where it does today), since space is limited; the balance is for the open list.
- Balances use the same definition as the Accounts page, including accounts marked "not in net worth".
- No new stored data, setting, or sync change is needed: balances are derived on the device.
- Mobile shells are not part of this feature.
- Reuses the existing shared dropdown component introduced in the recent listbox work.
