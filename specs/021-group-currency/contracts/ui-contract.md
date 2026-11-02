# UI Contract: A Currency for Each Account Group

## 1. Commands (`packages/core`)

```text
createAccountGroup({ fold, id, name, icon?, color?, currency? })   // currency defaults to the Fold's; stored explicitly
updateAccountGroup({ fold, id, name?, icon?, color?, sortOrder?, currency? })
// both refuse an unknown currency with unknown_currency
```

Web: `ledger.createGroup({ name, currency })`, `ledger.updateGroup({ id, name?, currency? })` pass it through.

## 2. Query (`packages/core/src/ledger/application/group-totals.ts`)

```text
groupBalances({ accounts: AccountRow[], groupCurrency: CurrencyCode, rates: ExchangeRate[], asOfUtcS: number }) → {
  rows: Array<{ id, converted: Money | null, rateAsOf: number | null }>,
  subtotal: Money | null,
  missing: CurrencyCode[],
  overflow: boolean,
}
```

Pure, bigint only, the same rule as the Overview's `netWorth`.

## 3. The group form (`ui/accounts/GroupDialogs.tsx`)

| Field | Value |
|-------|-------|
| Group name | as today |
| Currency | `SelectField`, the currencies the account form offers, the Fold's currency first; same Save button for create and for rename |

## 4. The Accounts page, group view

| Part | Value |
|------|-------|
| Section heading | the name only |
| Subtotal | one `Amount` in the group's currency, `data-testid="group-subtotal"`; with a missing rate it is of the others and the note below says so; with none convertible: "No total yet" |
| Note | `role="status"`: "Left out: no exchange rate for USD, PLN" with a link "Enter rates" to where rates are entered |
| Account row | the account's own balance as today; when its currency differs from its group's: a second figure "≈ 183.20 EUR" (`data-testid="account-converted"`), or "no rate" |
| Rates date | the tooltip (`title`) of the subtotal and of each "≈" figure: "Converted at rates from 30 Oct 2026"; no separate line |
| Privacy mode | converted amounts are `Amount`s and follow it |
| Ungrouped section and by-type view | unchanged |

## 5. Strings (EN, UK, PL)

Added: `ledger.groups.currency`, `ledger.groups.converted` ("≈ {amount}"), `ledger.groups.noRate`, `ledger.groups.leftOut`, `ledger.groups.noTotal`, `ledger.groups.ratesFrom`, `ledger.groups.enterRates`, `ledger.groups.tooLarge`.

## 6. Unchanged

Account balances and currencies, transactions, budgets (including those scoped to a group), the Overview, exports, and the sync format for every other field.
