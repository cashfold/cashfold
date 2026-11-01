# Data Model: One App Icon and Plain Zeros in Privacy Mode

No stored data is added, changed or removed.

## Hidden amount (derived, never stored)

Made on screen from an amount that is already formatted for the person's language.

| Part | Rule |
|------|------|
| Text | the formatted figure with every digit `0` (`−1,234.56` → `−0,000.00`; `7,50` → `0,00`) |
| Sign | kept (`−`, `+`) |
| Marks | the language's group and decimal marks, kept |
| Decimals | the currency's own number, kept |
| Currency code | kept, shown as text (not blurred) |
| Colour | the same gain/loss colour as the real amount when the caller asks for it |
| Blur | applied to the zeros only, `0.4em` so it scales with the text |
| Reveal | unchanged: five seconds, hides on navigation, blur of the window, cover, mode change and lock |
| Reader | "Hidden amount, {currency}. Press to reveal." |

## App icon

Not data. One set of files, the original: `apps/web/public/{icon.svg,favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png,icon-maskable-512.png,manifest.webmanifest}` and `apps/desktop/build/icon.png`.

## Stored preference (unchanged)

`primary` (a palette id, synced across devices) keeps its meaning: it colours the interface. It no longer has any effect on an icon.
