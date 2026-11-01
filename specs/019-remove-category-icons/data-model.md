# Data Model: Categories Without Icons

No stored data is added, changed or erased.

## Category

| Part | Before | After |
|------|--------|-------|
| name, direction (income / expense), parent, color, sort order, archived | stored and shown | unchanged |
| icon | stored (field 4), shown as an emoji | **reserved**: never written, read and ignored |

- Record field numbers: `direction 1, parentId 2, name 3, icon 4 (reserved), color 5, sortOrder 6, archived 7`. Field 4 is never reused.
- A record from an older device or a backup may carry field 4 (a text key such as `utensils`). It decodes, merges and syncs like any field; the app does not look at it.
- The read model (`Category`) has no `icon`. The SQL column `category.icon` stays in the schema and is left empty.
- Default categories: the 13 roots and their children are created with a name, a direction, a parent and a color only.

## Not changed

Account groups, accounts and goals keep their own `icon` field.
