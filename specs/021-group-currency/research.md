# Research: A Currency for Each Account Group

What was found in the repository, the decision, and what else was considered.

## R1. What exists today

**Finding**:
- A group is a record with `name`, `icon`, `color`, `sortOrder` (`GROUP_FIELD = { name: 1, icon: 2, color: 3, sortOrder: 4 }`); `decodeGroup` reads them; `createAccountGroup` and `updateAccountGroup` (`account-commands.ts`) write them; the form (`GroupDialogs.tsx`) asks only for a name.
- `accountSections` (`ui/accounts/account-sections.ts`) builds the sections of the Accounts page. For a group it adds the balances per currency (`totalsOf`) and never mixes currencies; an account with an unknown balance makes the subtotal `'unavailable'`.
- `ledgerBasics` already returns `baseCurrency`, `accounts` (with `balanceMinor`), `groups` and `rates` (the Fold's exchange rates in force).
- The Overview's `netWorth` converts each account's balance to the base currency: for the account's currency and the target currency it takes `nearestPrior(rates, currency, endOfDayUtcS(asOf))` (USD is the pivot, rate 1), then `convert(amount, target, from, to)` (one bigint division, one half-even rounding); a currency without a rate goes into `missing` and the account is left out; the Overview shows a "Missing exchange rates" notice with an "Enter rates" action.

**Decision**: do the same thing for a group, with the group's currency as the target.

## R2. Where the group's currency is stored

**Decision**: a new optional field on the group record, `GROUP_FIELD.currency = 5`, text (a currency code).
- A group made before this has no field 5: `decodeGroup` returns `currency: null` and the page reads it as "the Fold's currency" (`basics.baseCurrency`, else USD as everywhere else).
- A new group stores the chosen currency at creation (the Fold's currency unless the person picked another), so a later change of the Fold's currency does not move it.
- Records are per-field last-writer-wins, so a device that does not know field 5 neither breaks nor erases it. Older backups restore without it.
- The SQL tables are not written by the app (the ledger is built in memory from records), so there is no migration.

**Alternatives considered**: storing the currency in the Fold's settings record as a map of group id to currency (rejected: a second place to keep in step, and deleting a group would leave stale entries); making the field required and back-filling every old group (rejected: every device would write a patch for every group, and an old device would write none).

## R3. How the conversion is done

**Decision**: a pure function `groupBalances` in `core/ledger/application/group-totals.ts`.

```text
groupBalances({ accounts, groupCurrency, rates, asOfUtcS }) →
  rows:      per account { id, own balance, converted: Money | null, rateAsOf: seconds | null }
  subtotal:  Money | null          // the sum of the converted figures; null when nothing could be converted
  missing:   CurrencyCode[]        // currencies with no rate, sorted
  overflow:  boolean               // a converted amount was outside the supported range
```

- An account already in the group's currency is its own converted figure (no rate used).
- Otherwise it uses the Overview's rule verbatim: `nearestPrior` for the account's currency and the group's currency at `asOfUtcS` (the end of today, so the latest rate dated today or earlier), then `convert`.
- Each converted figure is rounded once (inside `convert`); the subtotal is the plain sum, so it equals the figures shown (spec FR-008). An account with an unknown balance (`balanceMinor === null`) is skipped as today (the section says "not available yet").
- The rows also return which rate date each conversion used, so the page can say "at rates from 2026-10-30" (FR-007).

**Alternatives considered**: converting the group's total as one amount per currency (rejected: the figures shown per account would not add up to the subtotal once rounded); doing it in the page (rejected: it must follow `netWorth`'s rule and be testable without React).

## R4. What the page shows

**Decision**:
- The group section's subtotal is `subtotal` when at least one account converted. If some accounts lack a rate, the subtotal is of the others and the section shows a note ("Left out: no exchange rate for USD", `role="status"`) with a link to the rates; if none could be converted, the subtotal is replaced by "No total yet: exchange rate needed for …" (never zero).
- An account row keeps its own balance and, when its currency differs from its group's, adds a second amount "≈ 183.20 EUR" (the symbol and the word "approximately" for screen readers; not color alone) and a `title`/description with the rate date. Rows in the by-type view and in Ungrouped are unchanged.
- The rates date is in tooltips, not on the page: the subtotal says "Converted at rates from 30 Oct 2026" (the oldest date used) and each "≈" figure its own date.

## R5. Group form

**Decision**: add a currency choice to the add-and-rename form using the same `SelectField` and currency list the account form uses (`ledger.accounts.form.currency`), labelled "Currency", defaulting to the Fold's currency. Renaming and changing the currency happen in the same sheet (one Save). The form passes `currency` to `createGroup`/`updateGroup`.

## R6. Bundle

**Finding**: 374,644 bytes on a laptop against a 375,808 budget (CI measures about 630 bytes higher). The conversion function and the UI add some code; the picker and `convert` are already in the bundle.

**Decision**: keep the new UI small (no new component library, reuse `SelectField`, `Amount`, `Notice`); measure after the first working build (T001, the final polish task) and, if it does not fit, split the group-balances note and link into a lazy component rather than raise the budget again.

## R7. Testing approach

- Core: examples (one currency, three currencies, an account in the group's currency, a negative balance, the pivot currency, a missing rate for one account, for all accounts, an unknown balance), property test (the subtotal equals the sum of per-account conversions; the conversion equals `netWorth`'s for the same inputs; order of accounts does not matter), the commands (create with and without a currency, update, unknown currency refused), the record (a group without field 5 decodes to `null`; a group with it decodes).
- Web: `accountSections` with groups of mixed currencies; the section markup in each state (converted, partial, none); the form.
- Accessibility: the e2e specs run axe on a mixed-currency group with a missing rate in the light and dark themes, and the RTL project runs the same specs in a right-to-left layout; there is no separate browser test.
- E2E: create a group in EUR, add EUR, USD, PLN accounts, enter rates, see the subtotal; change the group's currency and see it follow; remove a rate and see the note; two browser contexts for the sync.
