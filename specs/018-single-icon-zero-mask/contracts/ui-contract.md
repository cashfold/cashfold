# UI Contract: One App Icon and Plain Zeros in Privacy Mode

The interfaces the rest of the app and the tests rely on.

## 1. Hidden amount (`ui/kit/amount.tsx`, `ui/privacy/mask.ts`)

```text
zeroed(text: string): string                       // every digit becomes "0"; nothing else changes
maskedMoney(formatted: string): string             // = zeroed(formatted), for places that can only hold text
<Amount ... />                                     // masked: same element, zeros from data-zeros, sign and tone colour kept
```

| Part | Value |
|------|-------|
| Zeros | generated content from `data-zeros`, `aria-hidden`, `select-none`, blur `0.4em`, `data-privacy-mask` kept |
| Currency | text next to the zeros, `aria-hidden` while masked |
| Sign | part of the zeros text (`−0,00`, `+0,00` where the real amount shows `+`) |
| Colour | `text-(--success)` / `text-(--danger)` as with the mode off (`tone="auto"`) |
| `data-sign` | present, as with the mode off |
| Width | no fixed minimum; the masked box equals the revealed box within 1 px |
| Name | button with `aria-label` "Hidden amount, {currency}. Press to reveal." (or a visually hidden label inside a clickable row), as today |
| Reveal | click, tap, Enter, Space, five seconds, hides again, as today |

`LedgerView.money()` and `.signed()` return `zeroed(formatMoney(...))` and `zeroed(formatSigned(...))` while the mode is on. Forms and exports keep using `format.ts` and the core.

No digit from 1 to 9 is present for a hidden amount in text, labels, titles, descriptions, tooltips, chart values or the clipboard.

## 2. Icon

| Where | Value |
|-------|-------|
| Page links (`layout.tsx`) | `/favicon.ico`, `/icon.svg`, `/apple-touch-icon.png`, `/manifest.webmanifest`; never rewritten at run time |
| Desktop | `build/icon.png`; the shell never sets a dock or window icon from a colour |
| Settings → Appearance | the primary colour description does not mention the icon; no installed-icon note |

## 3. Removed

- Page: `mirrorPrimaryIcon` (and `ui/theme/mirror-icon.ts`); the `theme-color` meta effect stays, in `ThemeProvider`.
- Platform package and bridge: `setPrimaryColor`, `CHANNELS.primaryColor`, `PrimaryColorRequestSchema`, `PRIMARY_COLORS`.
- Shell: `app-icon.ts` and the `appIcon` test hook.
- Files: `apps/web/public/icons/`, `apps/web/public/manifests/`, `apps/desktop/build/icons/`.
- Strings: `settings.appearance.primary.installedNote`; `settings.appearance.primary.description` loses "and the app icon" (EN, UK, PL).
- Generator: the per-colour loop in `scripts/gen-brand-assets.mjs`.

## 4. Unchanged

The `primary` preference and its sync, the picker, `data-primary` token overrides, the Privacy mode switch, shortcut, palette commands, announcements and the rules for when revealed amounts hide.
