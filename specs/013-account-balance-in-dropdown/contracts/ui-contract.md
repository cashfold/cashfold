# UI Contract: Account Option

No external interface changes. The internal UI contract:

**`AccountOption`** (used inside a kit `Select` in place of `SelectOption` with a name string)
- Input: an account row (id, name, currency, balanceMinor).
- Output: a selectable option whose visible text is the name (truncating) and the formatted balance (never truncated), whose accessible name includes both, and whose value is the account id.
- `balanceMinor === null`: name only.
- Negative balance: shown with the app's usual negative formatting and loss styling.
- Disabled and keyboard behaviour: same as the kit `SelectOption`.
