# Data Model: Privacy Mode

No domain concept, event or synced record is added. These are device preferences and short-lived page state.

## 1. Device preferences (in `cashfold.ui`)

The existing device-local JSON object, same parsing rules (field by field, defaults, `v: 1`). Never synced, exported or sent.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `privacyMode` | boolean | `false` | Whether money amounts are masked on screen. |
| `notificationDetails` | `'auto'` \| `'on'` \| `'off'` | `'auto'` | Whether notifications include the schedule name and the day. `'auto'` means the person never chose: it behaves as `'on'` if the older "show amounts" flag is on, otherwise as `'off'`. |

**Rules**
- An invalid value falls back to its default without touching other fields. A missing field is the default.
- The two fields add under 60 bytes; the object stays under its 4 KB cap (`MAX_PREFS_BYTES`).
- Signing out keeps both (`resetAccountPrefs` copies everything except the Fold-keyed recents and the getting-started card).
- Effective notification details = `notificationDetails === 'on'` or (`'auto'` and the amounts flag is on).

## 2. Older device flag (unchanged)

| Key | Values | Meaning |
|-----|--------|---------|
| `cashfold.reminders.amounts` | `'1'` / `'0'` | Whether notifications may also show the amount (only meaningful when details are on). Kept as it is so a person's earlier choice survives (FR-021). It is also read by `notificationDetails: 'auto'`. |

## 3. Reveal state (memory only)

| Field | Meaning |
|-------|---------|
| `id` | An opaque key for one drawn amount (one per `Amount` instance). |
| `until` | When the reveal ends (about 5 seconds after it started). |

**Rules**
- Never stored, never in the URL, never logged.
- At most one timer per id; a new reveal of the same id restarts it; revealing one id does not reveal any other.
- Cleared on: route change, window blur, privacy cover, lock, sign-out, and any change of the Privacy mode setting.

## 4. Masked amount (a rendering, not stored)

| Part | Value |
|------|-------|
| Text | `••••` then the currency code, fixed width |
| Name for assistive technology | "Hidden amount, {currency}. Press to reveal." |
| Absent while masked | the figure, its sign, its direction, gain or loss colour, any `data-` attribute that varies with the figure |

## 5. Notification text (a value, not stored)

| Case | Title | Body |
|------|-------|------|
| Default (details off), one or many | "Cashfold has a reminder" (generic) | "Open Cashfold to see it." (generic) |
| Details on, one reminder | "Due: {name}" | "Scheduled for {date}" |
| Details on and amounts on, one reminder | "Due: {name}" | "Scheduled for {date}: {amount}" |
| Details on, several reminders | generic (no count) | generic |

The tag used to replace a notification is the reminder key (an id), not text.

## 6. State transitions

```text
privacyMode off --toggle (shortcut, indicator, Settings, palette)--> on   (reveals cleared)
privacyMode on  --toggle--> off                                              (reveals cleared)
masked amount --click / Enter / Space--> revealed (5 s)
revealed --timeout | route change | blur | cover | lock | toggle--> masked
locked --any--> (no store, no shortcut, nothing shown)
```
