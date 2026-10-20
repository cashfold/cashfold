# Contract: Default Category Set (FR-048)

Original list authored for Cashfold. Two levels (root and child). Names are localisable message keys; the English text is shown. Users can rename, move, archive or delete any entry. Category ids are `UUIDv5(namespace = fold_id, name = <key>)` so a fresh Fold on any device gets the same ids.

## Expense categories

| Key | Root | Children |
|---|---|---|
| `expense.food` | Food & Drink | Groceries, Restaurants, Coffee & Snacks |
| `expense.home` | Home | Rent or Mortgage, Utilities, Maintenance, Furnishings |
| `expense.transport` | Transport | Fuel, Public Transit, Taxi & Rideshare, Parking, Vehicle Maintenance |
| `expense.health` | Health | Doctor, Pharmacy, Insurance, Fitness |
| `expense.personal` | Personal | Clothing, Beauty & Care, Gifts |
| `expense.leisure` | Leisure | Entertainment, Hobbies, Subscriptions, Travel |
| `expense.family` | Family | Childcare, Education, Pets |
| `expense.finance` | Finance | Fees & Charges, Taxes, Loan Interest |
| `expense.other` | Other | (none) |

## Income categories

| Key | Root | Children |
|---|---|---|
| `income.work` | Work | Salary, Bonus, Freelance |
| `income.investment` | Investments | Interest, Dividends |
| `income.other` | Other income | Refunds, Gifts Received, Reimbursements |

## Rules
- The set is created once when a Fold is created, as ordinary editable records (not special-cased afterwards).
- Maximum depth is two levels; the set respects that limit.
- Each default has an icon key and colour index chosen from the app's own design tokens.
