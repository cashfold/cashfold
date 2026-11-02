# Data Model: A Currency for Each Account Group

## Account group record

| Field | No. | Type | Meaning |
|-------|-----|------|---------|
| name | 1 | text | unchanged |
| icon | 2 | text or null | unchanged |
| color | 3 | integer | unchanged |
| sortOrder | 4 | integer | unchanged |
| **currency** | **5** | text (a supported currency code), optional | **new**: the currency the group is shown in |

- Absent (every group made before this feature, and any group whose device never wrote it) means "the Fold's currency". The read model returns `currency: null` for it.
- A value must be a supported currency code; the commands refuse an unknown one (`unknown_currency`).
- The field is per-field last-writer-wins, like the others. Nothing else about a group or its accounts changes when it changes.

## Read model

```text
AccountGroup { id, name, icon, color, sortOrder, currency: string | null }
```

The page resolves the currency to show as `group.currency ?? basics.baseCurrency ?? 'USD'`.

## Group balances (derived, never stored)

| Part | Rule |
|------|------|
| Converted figure of an account | the account's balance converted to the group's currency with the rates in force at the end of today, rounded once, half to even; the balance itself when the currencies are equal |
| Subtotal | the sum of the converted figures of the accounts that could be converted (archived accounts only when the switch is on) |
| Missing | the currencies (the account's or the group's) that have no rate in force, sorted |
| Rate date | the date of each rate used, so the page can say when the conversion is from |
| Range | a converted figure outside the signed 64-bit range is reported as an overflow, not shown |
