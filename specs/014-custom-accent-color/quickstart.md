# Quickstart: Validating Custom Primary Color

## Prerequisites
- `pnpm install`, `pnpm exec playwright install chromium` (for `gen:assets`).

## Run
1. `pnpm gen:assets` — produces per-color icon sets; commit the result.
2. `pnpm --filter @cashfold/web test` and `pnpm --filter @cashfold/web test:browser` — palette contrast, prefs parsing, bootstrap equivalence, picker.
3. `pnpm dev` (web) and open Settings → Appearance.

## Scenarios
1. **US1**: pick a color; buttons, selection, links and focus ring change instantly; reload and confirm it persists with no flash; switch light/dark; pick Default to restore. Negative amounts stay red.
2. **US2 web**: the tab icon changes to the color within 2 s. Install the app after choosing a color and check the installed icon.
3. **US2 desktop**: run the desktop app; the dock/window icon changes without restart.
4. **Offline**: disable the network; choose a color; it applies.
5. **Invalid data**: put a bad `primary` value in `cashfold.ui`; the app falls back to the default.
6. **US3 (Phase 3)**: choose a color on one device, sign in on another, confirm it matches; change on both while offline and confirm both converge.
7. Accessibility: axe passes on Appearance for every color; contrast test is green.
