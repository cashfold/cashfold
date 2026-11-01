# Research: One App Icon and Plain Zeros in Privacy Mode

What was found in the repository, the decision, and what else was considered.

## R1. What a masked amount is today

**Finding**: `privacy/mask.ts` returns a constant, `0<group>000<decimal>00`, for every amount (`maskedFigure(locale)`). `Amount` draws it from a `data-zeros` attribute through CSS generated content with a blur of `0.4em`, then the currency code, with no sign, no `data-sign` and no tone colour. A fixed minimum width (`MASK_WIDTH_CLASS`, `14ch`) keeps neighbours still on reveal. `LedgerProvider.money()` and `.signed()` return `maskedMoney(currency, locale)` for plain-text places. Nothing formats the real figure while masked.

**Decision**: the masked text is the real text with each digit as `0`.

## R2. How to make the zeros

**Decision**: `zeroed(text) = text.replace(/\d/g, '0')`, applied to what `formatMoney`/`formatSigned` already produce for that amount and locale. That one rule keeps the minus (`−`), the plus, the group and decimal marks of the language, the number of decimals and the position of the currency code. It also works for non-Latin digit sets only if a locale prints them; the app formats with ASCII digits, so `\d` is enough (checked against `separatorsFor`).

**Rationale**: smallest possible change, exact (no number parsing or arithmetic), and the same code path for the visible span and the plain-text helpers.

**Alternatives considered**: building the shape from digit counts of the `bigint` (rejected: a second formatter to keep in step with `formatAmount`); keeping the constant and only adding a sign (rejected: it would still not look like the amount).

## R3. Where the digits live in the page

**Finding**: the existing guard (spec 016) is that no digit of a hidden amount is in the page text. With zeros there is still nothing real to protect in the digits, but the shape would be copyable and findable as text, and the screen reader must say "hidden amount", not "zero comma zero zero zero".

**Decision**: keep the technique: zeros are drawn from `data-zeros` as generated content, `aria-hidden`, `select-none`, blurred, and the accessible name stays "Hidden amount, {currency}. Press to reveal." The plain-text helpers (tooltips, chart values, labels) return the zeroed text, which holds only zeros, so the e2e scan changes from "no figure" to "no non-zero digit" (R7).

## R4. Sign and colour

**Decision** (clarification 2026-11-01): the masked span keeps `data-sign` and the `tone="auto"` colour classes, and the plus for gains. Only the digits change.

## R5. The icon: what exists, and what stays

**Finding**: spec 014 added: ten icon sets (`apps/web/public/icons/<id>/`, `apps/desktop/build/icons/<id>.png`), ten manifests (`public/manifests/<id>.webmanifest`), `mirror-icon.ts` (swaps the icon, touch-icon and manifest links and the `theme-color` meta, then calls the shell), a `setPrimaryColor` bridge member with its channel, schema and handler, `app-icon.ts` in the main process, a generator loop in `scripts/gen-brand-assets.mjs`, two Settings strings, and tests and docs. The original files (`public/icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `manifest.webmanifest`, `build/icon.png`) are the default and are what `layout.tsx` links, so "the icon we had before" is already there.

**Decision**: delete everything that exists only for colour-following. Keep the `primary` preference, the picker, `data-primary` and the token overrides.

**`theme-color` meta**: `mirror-icon.ts` also sets the browser's address-bar colour to the chosen primary. That is not the icon. **Decision**: keep that behavior (a three-line effect in `ThemeProvider`), so the picker continues to colour the browser chrome. **Alternative**: drop it too (rejected: the spec says everything else keeps working).

## R6. The shell bridge

**Finding**: `setPrimaryColor` crosses the bridge only to change the dock/window icon. `PRIMARY_COLORS` in `@cashfold/platform` is used only for that schema and `app-icon.ts`; the web palette has its own ids.

**Decision**: remove the member, the channel (`cashfold:primary-color`), `PrimaryColorRequestSchema`, `PRIMARY_COLORS`, the handler, the main-process module and its test hook, and the entry in `apps/desktop/e2e/hardening.spec.ts`'s list of bridge members. A removed channel narrows the surface; there is nothing to keep compatible because page and shell ship together.

## R7. Tests that depend on the old mask

**Finding**: `e2e/ux-privacy-mode.spec.ts` scans readable text for a figure (`FIGURE = /\d[\d.,\s ]*[.,]\d{2}\s?(USD|…)|[+−]\d/`). Zeroed text such as "0,000.00 USD" would match it.

**Decision**: the scan keeps its purpose (no real figure) but a match counts only if it holds a digit from 1 to 9. The mask itself is asserted separately: its zeros equal the shape of the real figure with digits replaced. Unit tests in `mask.test.ts`, `amount.test.tsx` and the browser tests are rewritten for the new shape (sign kept, colour kept, shape equals the real one, the blur still scales with text size).

## R8. Width on reveal

**Finding**: the fixed `min-w-[14ch]` existed because the old mask was one constant width.

**Decision**: remove it. The zeros have the same length as the figure, so revealing moves nothing, which a browser test asserts (same box width masked and revealed within a pixel).

## R9. Stored colour and installed apps

**Decision**: no migration; the `primary` preference is untouched. Icons already installed on a device are the system's copies and cannot be changed by the app (the spec says so); the Settings note about that is removed because nothing follows the colour any more.

## R10. Testing approach

- Unit: `zeroed`, the masked `Amount` markup in both signs, three locales, tone colours, accessible name; ledger helpers.
- Browser (Chromium, axe): masked amounts in light and dark; blur scales with text; masked and revealed boxes match.
- E2E web: every main screen with the mode on has only zeros in readable text, signs and colours as with the mode off; Settings → Appearance has no icon text; the page's icon links are the originals for every colour.
- E2E desktop: choosing a colour does not call the shell for an icon; the bridge list has no `setPrimaryColor`.
- Repository checks: `pnpm check:bundle`, `pnpm check:licenses`, `pnpm check:docs`, brand-asset tests.
