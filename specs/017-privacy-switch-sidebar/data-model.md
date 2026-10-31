# Data Model: Privacy Mode Switch in the Sidebar

No data is added or changed. The control reads and flips the preference spec 016 already defined.

## The one value it uses

| Value | Where it lives | Meaning |
|-------|----------------|---------|
| `privacyMode` (boolean, default `false`) | the device-local interface preferences (`cashfold.ui`) | Whether money amounts are masked on screen. Read through `usePrivacy().on`, flipped through `usePrivacy().toggle()`. |

## What the control shows from it

| `privacyMode` | Sidebar item text | Icon | `aria-pressed` | Top-bar button name |
|---------------|-------------------|------|----------------|---------------------|
| `false` | "Privacy mode: off" | eye | `false` | "Privacy mode: off" |
| `true` | "Privacy mode: on" | crossed-out eye | `true` | "Privacy mode: on" |

## Rules

- The control holds no state of its own, so it cannot disagree with the preference.
- Nothing is stored, synced or sent because of it.
- Pressing it does what the Settings switch, the shortcut and the palette commands already do: flips the preference and hides every revealed amount.
