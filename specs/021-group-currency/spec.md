# Feature Specification: A Currency for Each Account Group

**Feature Branch**: `021-group-currency`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "I think that groups should have a currency as well as fold. And we should convert all accounts of the groups to this currency during displaying amounts, for example at the accounts page"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Give a group a currency (Priority: P1)

A person who keeps their savings in several currencies (a euro account, a dollar account, a złoty account) puts them in a group called "Savings" and says that the group is counted in euros. A Fold already has a currency that its totals are shown in; now a group has one too. When the person creates a group, its currency starts as the Fold's currency, and they can choose another one. They can change it later in the same place where they rename the group.

**Why this priority**: Everything else in this feature depends on a group having a currency, and the choice is useful to a person only once it exists.

**Independent Test**: Create a group, see that its currency starts as the Fold's, change it to another currency, close and reopen the app, and see that the choice was kept. Open a group made before this feature and see that it has the Fold's currency.

**Acceptance Scenarios**:

1. **Given** the form for a new group, **When** the person opens it, **Then** it asks for a name and a currency, and the currency is the Fold's currency until they choose another.
2. **Given** a group, **When** the person edits it, **Then** they can change its name and its currency, and the change is saved with the same actions as renaming.
3. **Given** a group created before this feature existed, **When** the person looks at it, **Then** it shows the Fold's currency and works as if that had been chosen.
4. **Given** the person changes a group's currency, **When** they look at the accounts in it, **Then** the accounts keep their own currency, their balances and their transactions: only how the group is shown changes.
5. **Given** the person has more than one device, **When** a group's currency is changed on one, **Then** the other devices show the new currency after they sync, like any other change to a group.

---

### User Story 2 - See each group in its own currency on the Accounts page (Priority: P1)

A person opens the Accounts page in the group view. Each group section shows its name, its accounts and a subtotal, and the subtotal is in the group's currency: the euro, dollar and złoty accounts of "Savings" are added up as euros. Next to an account whose currency differs from the group's, the page also shows the balance converted to the group's currency, so the person can see how much each account contributes to the subtotal, while the account's own balance in its own currency stays visible.

Today a group with accounts in several currencies shows one subtotal per currency, because the page never adds amounts of different currencies together. With a currency on the group, one figure is enough.

**Why this priority**: It is the purpose of the feature: a single, meaningful subtotal for a group that mixes currencies.

**Independent Test**: Make a group in euros with a euro account of 100.00, a dollar account of 50.00 and a złoty account of 200.00, with exchange rates known for the dollar and the złoty. Open the Accounts page in the group view and check that the subtotal is in euros and equals 100.00 plus the converted dollars and złoty, and that each foreign account shows its converted amount.

**Acceptance Scenarios**:

1. **Given** a group whose accounts are all in the group's currency, **When** the section is shown, **Then** it looks as it does today: the subtotal is the sum of the balances.
2. **Given** a group with accounts in other currencies and a known exchange rate for each, **When** the section is shown, **Then** the subtotal is one amount in the group's currency, made by converting each account's balance with the Fold's exchange rates and adding them up.
3. **Given** an account in a currency other than its group's, **When** its row is shown, **Then** the row shows the balance in the account's own currency and the converted amount in the group's currency, marked as an approximate conversion.
4. **Given** the converted amounts are shown, **When** the person looks at the page, **Then** they can tell which exchange rates were used (and from which date) without leaving the page.
5. **Given** accounts in no group, **When** the "Ungrouped" section is shown, **Then** it keeps its current behavior: one subtotal per currency, with no conversion, because it has no currency of its own.
6. **Given** Privacy mode is on, **When** the converted amounts are shown, **Then** they are hidden like every other amount.
7. **Given** the page is shown by type instead of by group, **When** the person looks at it, **Then** it is unchanged.
8. **Given** the "Show archived accounts" switch, **When** it is off, **Then** archived accounts are neither listed nor counted in a converted subtotal, and when it is on they are listed and counted, so a subtotal always adds up to the rows above it.

---

### User Story 3 - Say plainly when a rate is missing (Priority: P2)

A person has a group in euros with a dollar account but has never entered a dollar exchange rate. The page does not guess: the subtotal leaves the dollar account out and says so, names the currency that needs a rate, and offers a way to enter the rate, the same way the Overview page does for its totals.

**Why this priority**: A wrong total is worse than none. It is needed to make the feature safe, but the main flow works without it.

**Independent Test**: Make the group above without a dollar rate. The subtotal counts only what can be converted, a note names the dollar, and entering the rate updates the subtotal at once.

**Acceptance Scenarios**:

1. **Given** an account whose currency has no known rate to the group's currency, **When** the section is shown, **Then** the account's own balance is still shown, its converted amount is replaced by a note that no rate is known, and the subtotal leaves it out.
2. **Given** a subtotal that leaves accounts out, **When** the section is shown, **Then** it says which currencies are missing, so the figure cannot be mistaken for a complete total.
3. **Given** the note about a missing rate, **When** the person follows its action, **Then** they reach the place where exchange rates are entered, and after entering one, the Accounts page shows the converted amount and the new subtotal.
4. **Given** every account in a group is in a currency without a rate, **When** the section is shown, **Then** the subtotal is not shown as zero: it says that no total can be given yet.

---

### Edge Cases

- A group whose currency is one that none of its accounts use: still valid; every account is converted.
- A group with no accounts: shows its currency in its heading or form but no subtotal figure, as today.
- A group's currency is changed while the Accounts page is open on another device: the page follows after sync.
- An account is moved from one group to another: it is converted to the new group's currency at once.
- An exchange rate changes: converted amounts and subtotals follow the new rate.
- The balance is negative (a credit card): the converted amount keeps its sign and the subtotal adds and subtracts correctly.
- A very large balance or a rate that would make the converted amount too large: the section says the amount is too large instead of showing a wrong figure.
- Rounding: each account is converted exactly and rounded once, to the group currency's decimals, by the app's one rounding rule; the subtotal is the sum of the rounded converted amounts, so the subtotal always equals the sum of the figures shown above it.
- Budgets scoped to a group are not changed by this feature: a group's currency affects how the group is displayed, not what a budget counts.
- Deleting a group still keeps its accounts and does not delete or change anything else.
- Right-to-left layouts, narrow windows, large text, light and dark themes, and screen readers: the converted amounts read as amounts with their currency, and "approximately" is not conveyed by color alone.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every account group MUST have a currency. A new group MUST start with the Fold's currency, and the person MUST be able to choose any currency the app supports.
- **FR-002**: The person MUST be able to see and change a group's currency in the same place where they create and rename the group.
- **FR-003**: A group created before this feature MUST be treated as having the Fold's currency, with no action from the person and nothing lost.
- **FR-004**: A group's currency MUST be kept with the group: it MUST survive restarts, follow the person across their devices like the group's name, and be included in backups and restores.
- **FR-005**: In the group view of the Accounts page, a group's subtotal MUST be a single amount in the group's currency, made by converting each account's balance with the Fold's exchange rates and adding the results.
- **FR-006**: An account whose currency differs from its group's MUST show, besides its own balance, its balance converted to the group's currency, marked as an approximate conversion.
- **FR-007**: The page MUST let the person see which exchange rates (and the date of each) the conversions used.
- **FR-008**: Conversions MUST be exact and rounded once per account, to the group currency's decimals, using the app's single rounding rule, so a subtotal equals the sum of the converted figures shown for its group.
- **FR-009**: An account with no known exchange rate to the group's currency MUST be left out of the subtotal; the page MUST say that it is left out and which currencies lack a rate, MUST still show the account's own balance, and MUST link to where rates are entered. A group with no convertible account MUST NOT show a zero total.
- **FR-010**: Accounts in no group MUST keep today's behavior: one subtotal per currency and no conversion. The by-type view MUST be unchanged.
- **FR-011**: Archived accounts MUST be listed and counted in the converted subtotal only when the "Show archived accounts" switch is on, as for subtotals today.
- **FR-012**: A group's currency MUST affect only how the group is displayed. It MUST NOT change an account's currency, balance or transactions, a budget's scope or limits, or any exported figure.
- **FR-013**: Converted amounts MUST follow Privacy mode like every other amount.
- **FR-014**: The new texts MUST exist in every language the app offers, and the page MUST stay usable by keyboard and screen reader, with the approximate nature of a conversion not conveyed by color alone.

### Key Entities

- **Account group**: a name, a currency (new; defaults to the Fold's), and the accounts in it. Its currency decides how its accounts' balances are combined for display.
- **Fold currency**: the currency the Fold's totals are shown in; the starting value for every new group's currency and the value used for groups made before this feature.
- **Exchange rate**: the Fold's existing rate between a currency and the others, with the date it applies from; used to convert for display and never to change a stored amount.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can create a group with a chosen currency, or change an existing group's currency, in no more steps than renaming a group takes today plus one choice.
- **SC-002**: In a group of accounts in three currencies with known rates, the Accounts page shows exactly one subtotal, in the group's currency, and it equals the sum of the converted figures shown above it in 100% of cases checked.
- **SC-003**: In a check of at least 1,000 random groups of accounts, balances and rates, 100% of subtotals equal the exact conversion of each account rounded once and added, and 0 subtotals add amounts of different currencies without converting them.
- **SC-004**: When any rate is missing, 100% of affected sections say so and name the currency, and 0 show a total that silently leaves an account out.
- **SC-005**: 100% of groups that existed before the feature show the Fold's currency and work as before, with no action from the person.
- **SC-006**: A change of a group's currency reaches a second device after sync and shows there in 100% of tries.
- **SC-007**: The Accounts page with converted amounts passes the automated accessibility checks in light and dark themes and in a right-to-left layout.

## Assumptions

- The conversion uses the exchange rates the Fold already has (the ones the Overview page uses for its totals), with the same rule for which rate applies; this feature adds no new place to get rates and no automatic rate fetching.
- "Display" means the Accounts page in the group view, as in the request. Other places that show a group (a budget scoped to a group, the Overview) are not changed by this feature; they may follow later.
- Only the group view of the Accounts page converts; the by-type view and the Ungrouped section keep showing one figure per currency.
- A group's currency is a display choice, not an accounting one: no transaction, balance or export changes with it.
- A group made before this feature is read as having the Fold's currency by default; the currency is stored with a group only once it is chosen or changed, so older devices and backups keep working.
- The converted figure for an account is shown beside the account's own balance, not instead of it, so the person can always see the real balance.
- The date of a rate is shown in the same way the rest of the app shows rate dates; if no date is known, the page says so.
