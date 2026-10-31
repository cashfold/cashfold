# UI Contract: Privacy Mode

The interfaces other parts of the app, the desktop shell and the tests rely on.

## 1. Shortcut

| System | Keys | Handled by |
|--------|------|------------|
| macOS desktop | ⇧⌘M | Shell table entry; sends the page the `privacy` action |
| Windows / Linux desktop | Ctrl+Shift+M | Shell table entry; sends the page the `privacy` action |
| Browser on an Apple system | ⇧⌘M | Page `keydown` listener in the unlocked shell |
| Browser elsewhere | Ctrl+Shift+M | Page `keydown` listener in the unlocked shell |

- Desktop table entry: `{ keys: ['m'], modifier: 'primary', shift: true, platforms: 'all', action: 'privacy', data: true }` (`data: true` = ignored while locked). Mod+M without Shift stays minimise.
- Platform package: `ACTION_IDS` gains `'privacy'`; `HELP_SHORTCUTS` gains `app('privacy', 'privacy', primary('M', 'shift'))`. The test that compares the table with the Help list must pass on macOS, Windows and Linux.
- The page handles the action by toggling the mode; an unlocked page only. The desktop page runs it without closing other overlays (like `palette`), because toggling hides figures and needs no dialog to close.
- The browser listener ignores presses already prevented, presses while composing text, and any combination with Alt; it works while a text field has focus.
- Help lists the shortcut: in the desktop list, and as the second row of the one-section list in a browser (with the palette's).

## 2. Store and hook (`ui/privacy/`)

```text
usePrivacy(): {
  on: boolean                       // the preference
  toggle(): void                    // flips the preference and clears reveals
  reveal(id: string): void          // 5 s; restarts if already revealed
}
useRevealed(id: string): boolean    // whether this one amount is shown now; only that amount re-renders
revealStore: { reveal(id), isRevealed(id), clear(), shownCount(), subscribe(fn) }   // memory only
REVEAL_MS = 5000
```

- `PrivacyProvider` (inside the unlocked shell) clears reveals on route change, `core.covered`, window blur and unmount (lock).
- The preference lives in `cashfold.ui` through the existing prefs store (`privacyMode`).

## 3. `Amount` (kit)

```text
<Amount minor currency locale tone showSign align className />   // unchanged props
```

| State | Output |
|-------|--------|
| Mode off | exactly today's output (text, `data-sign`, tone colour, sign) |
| Mode on, not revealed | `••••` + currency code, fixed width; `role="button"` + `tabIndex=0` + name "Hidden amount, {currency}. Press to reveal."; no `data-sign`, no tone class, no plus or minus; click, tap, Enter and Space reveal this one amount |
| Mode on, revealed | today's output for 5 seconds, then masked again |
| Mode on, inside an interactive ancestor | masked `span` without `tabIndex`; a click reveals it and does not activate the ancestor |

- The real figure is formatted only in the revealed branch.
- Masked width comes from a class (no inline style).
- Forms and exports never use `Amount`; they use `formatPlain` or the core exporters and are unchanged.

## 4. Strings from the ledger view

```text
ledger.money(minor, currency): string     // masked ("•••• USD") while the mode is on
ledger.signed(minor, currency): string    // same, with no plus or minus while masked
```

- Used only where an amount is a plain string that no one can click (see the ratchet table in `money-sources.test.ts`); everything else uses `<Amount>`.
- `interleave(template, nodes)` renders translated sentences with `<Amount>` nodes in place of placeholders (`budgets.ratio`, `schedules.transferAmount`).

## 5. Dropdown options

`AccountOption` shows the account name only while the mode is on (no balance, no mask).

## 6. Settings (Settings → Appearance → Privacy)

| Control | Stored as | Default | Description (English) |
|---------|-----------|---------|-----------------------|
| Privacy mode | `privacyMode` | off | "Hides money amounts on screen until you reveal one. Names, dates, notes and the window itself stay visible. Exports and the add and edit forms always use real figures." |
| Show details in notifications | `notificationDetails` | off (or on if amounts were allowed before) | "Includes the schedule's name and the day in reminders. Off by default, because a notification can be read on a locked screen." |
| Show amounts in notifications | `cashfold.reminders.amounts` | off | Shown only while details are on. |

- The Schedules screen keeps the "Allow notifications" button and points to this section.
- The indicator (header or sidebar) says "Privacy mode on" with an icon and toggles the mode when activated; it is absent when the mode is off, and the Settings switch and shortcut remain the way to turn it on.

## 7. Palette commands

| Id | Title | Enabled when | Does |
|----|-------|--------------|------|
| `privacy-on` | Turn privacy mode on | mode is off | `togglePrivacy()` |
| `privacy-off` | Turn privacy mode off | mode is on | `togglePrivacy()` |

`PaletteContext` gains `privacy: boolean` and `togglePrivacy(): void`.

## 8. Notification text builder

```text
textFor(reminder, { copy, details, amounts, formatDate, formatAmount, currencyOf }): NotificationText
showDueReminders(reminders, deps): Promise<number>
```

- `details: false` → the generic title and body; no name, date, amount or count, for one reminder or several.
- `details: true` → the existing title and body (name and day); `amounts: true` adds the amount.
- `formatAmount` is always the real formatter (`formatMoney`), never the masked ledger string.
- Copy keys: `schedules.notify.generic.title`, `schedules.notify.generic.body` (new), and the existing message keys for details.

## 9. Text

All new strings are added to `en.json`, `uk.json` and `pl.json` under `privacy.*` and `schedules.notify.generic.*`: the switch and descriptions, the indicator, the masked-amount name and hint, the reveal and hide announcements, the generic notification title and body, the palette titles and keywords, and `help.shortcut.privacy`. The catalogue completeness test enforces all three.
