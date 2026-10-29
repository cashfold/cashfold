# Data Model: Account Groups on the Accounts Page

No new stored records, tables, wire types or relay changes. One preference field, one new command, one tightened rule, and derived values that are never stored.

## Stored (existing, unchanged shape)

| Entity        | Field                        | Meaning                                                                                                                                      |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Account group | `name`                       | 1 to 80 characters. **New:** unique among the Fold's groups, ignoring case and surrounding spaces                                            |
| Account group | `icon`, `color`, `sortOrder` | Unchanged. `sortOrder` is the groups' saved order; this feature does not add a way to change it                                              |
| Account       | `groupIds` (a set)           | Which groups the account is in. The page treats it as one group (the first by the groups' order); the new command writes exactly one or none |
| Account       | `sortOrder`                  | One saved position per account, shared by both views (clarification 2). Moving an account up or down changes it for both                     |

### Validation rules

- A group name has 1 to 80 characters (existing `invalid_group_name`).
- **New:** a group name is refused when another existing group has the same name, compared the way tag and payee names are (`sameLabel`: ignoring case, accents and surrounding spaces) (`group_name_taken`). Renaming a group to its own name, or changing only its case, is allowed. Groups that already share a name are left alone.
- A move targets a group that exists and is not deleted, or "none" (`unknown_group` otherwise), and an account that exists (`not_found` otherwise).

## Device preference (existing object, one new field)

`localStorage` key `cashfold.ui`, object `lists`:

| Field                  | Values                        | Default  | Meaning                                                                                                    |
| ---------------------- | ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `showArchivedAccounts` | boolean                       | `false`  | Unchanged                                                                                                  |
| `accountsView`         | `'auto'`, `'group'`, `'type'` | `'auto'` | `auto`: never chosen. The first use of the switch stores `group` or `type`. Never synced, kept on sign-out |

Parsing is defensive: anything else becomes `'auto'` without touching the rest.

## Derived (computed when the page draws, never stored or synced)

| Value           | Rule                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account's group | The first of its `groupIds` that is a live group, in the groups' order; none if there is none                                                                                                                             |
| Effective view  | The stored `group` or `type`; for `auto`, `group` if any account (archived or not) has a group, else `type`                                                                                                               |
| Group sections  | One per live group in order, then "Ungrouped" if any listed account has no group. A group with no listed accounts is still a section                                                                                      |
| Group subtotal  | Per currency, the sum of `balanceMinor` (a `bigint`, in minor units) of the accounts listed in the section, currencies in code order. `undefined` while any listed account's balance is `null`; absent for an empty group |

### State of the view choice

```
auto ──press "By group"──▶ group
auto ──press "By type"───▶ type
group ◀──────────────────▶ type     (every press stores the choice; it never returns to auto)
```

## Entities from the spec

- **Account group**: the stored group above.
- **Group membership**: `groupIds` on the account, with the new single-write command.
- **Group subtotal**: the derived value above.
- **Accounts view choice**: the preference above.

## Order of accounts

One saved `sortOrder` per account, shared by both views. A move up or down exchanges the account with its neighbour in the section it is shown in, inside the full list of accounts in their saved order, and renumbers the list from 0 so no two accounts share a position. Only accounts whose number changes are written. This is the rule that keeps the type view and the group view in agreement.
