---

description: "Task list for One App Icon and Plain Zeros in Privacy Mode"
---

# Tasks: One App Icon and Plain Zeros in Privacy Mode

**Input**: Design documents from `/specs/018-single-icon-zero-mask/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`. The two stories are independent: US1 (Privacy mode zeros) touches the privacy, kit and ledger code; US2 (one icon) touches the theme, platform package, desktop shell, generator and assets. Either can ship alone.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `018-single-icon-zero-mask`, run `pnpm vitest run` once to record a green baseline, then `pnpm --filter @cashfold/web build` and `pnpm check:bundle` and write the "initial JS" size into the PR notes (374,121 of 374,784 bytes after spec 017); later tasks must not raise the budget

## Phase 2: Foundational

No shared prerequisite: the two stories do not depend on each other.

## Phase 3: User Story 1 - Hidden amounts are the same amounts with every digit as a zero (Priority: P1) 🎯 MVP

**Goal**: With Privacy mode on, each amount is its real formatted text with every digit `0`, blurred, with the sign, gain/loss colour, marks, decimals and currency code kept; plain-text places hold the same zeroed text; reveal and announcements are unchanged.

**Independent Test**: Turn the mode on with amounts of different sizes, signs and currencies, in English and Polish: each hidden amount has the shape of the real one with only zeros, the colours are as with the mode off, no digit 1 to 9 is readable anywhere, a press reveals the real figure with no layout shift.

### Tests for User Story 1

- [X] T002 [P] [US1] Rewrite `ui/privacy/mask.test.ts` for the new helpers: `zeroed("−1,234.56")` is `"−0,000.00"`, `zeroed("+7.50")` is `"+0.00"`, `zeroed("1 234,50")` keeps the space and comma, a text with no digits is unchanged, digits only are replaced; `maskedMoney(formatMoney(minor, currency, locale))` for `1234n`, `-450n`, `0n`, a 0-decimal currency (JPY) and a 3-decimal one in `en`, `uk` and `pl` has the same length and marks as the real text and no character from 1 to 9
- [X] T003 [P] [US1] Update `ui/kit/amount.test.tsx` (server-rendered markup with a `PrivacyContext` provider): a masked amount carries `data-zeros` equal to the zeroed real text (sign included), `data-privacy-mask`, `data-sign`, the `text-(--success)`/`text-(--danger)` class for `tone="auto"`, the currency code as text, the accessible name "Hidden amount, {currency}. Press to reveal.", no fixed minimum width class, and no digit 1 to 9 anywhere in the markup
- [X] T004 [P] [US1] Update `ui/privacy/Privacy.browser.test.tsx` and `ui/accounts/AccountOption.browser.test.tsx` (real Chromium, axe, light and dark): the zeros are blurred and the blur scales with the root font size; a masked and a revealed amount have the same box width within 1 px (no shift on reveal); a gain and a loss keep their colours masked; axe passes
- [X] T005 [P] [US1] Update `e2e/ux-privacy-mode.spec.ts`: the readable-text scan (`FIGURE`) counts a match only when it contains a digit from 1 to 9; add a check that on Accounts and Transactions each `[data-privacy-mask]` has `data-zeros` equal to the real figure's text (read with the mode off) with digits replaced by `0`, that signs and the success/danger colour classes equal those with the mode off, that revealing one amount keeps its box width, and that the clipboard text of a selected row holds no digit from 1 to 9; keep every existing assertion about reveal, hiding, forms and exports. Update `apps/desktop/e2e/privacy.spec.ts` the same way where it asserts the old mask

### Implementation for User Story 1

- [X] T006 [US1] In `ui/privacy/mask.ts` replace `maskedFigure` and the constant pattern with `zeroed(text: string): string` (`text.replace(/\d/g, '0')`) and `maskedMoney(formatted: string): string` (= `zeroed(formatted)`); keep `MASK_FIGURE_CLASS` (blur `0.4em`, generated content from `data-zeros`) and delete `MASK_WIDTH_CLASS`; update the header comment to describe the new shape (depends on T002)
- [X] T007 [US1] In `ui/kit/amount.tsx` make the masked `AmountSpan` compute `formatMoney`/`formatSigned` exactly as the shown branch does (same `showSign`/`tone` rule), put `zeroed(text without the trailing currency code)` in `data-zeros`, render the currency code as text after it, keep `data-sign` and the tone colour classes in both states, keep the hidden label, role, `tabIndex` and key handling, and drop `MASK_WIDTH_CLASS` from `RevealableAmount`; update the doc comments that say "no sign, no direction and no colour" (depends on T006, T003)
- [X] T008 [US1] In `ui/ledger/LedgerProvider.tsx` change `money` and `signed` to `maskedMoney(formatMoney(minor, currency, locale))` and `maskedMoney(formatSigned(minor, currency, locale))` while privacy is on, and fix the comment above them (depends on T006)
- [X] T009 [US1] Update `docs/privacy.md` (one sentence in "What privacy mode hides": a hidden amount is the same figure with every digit as a zero, blurred, with its sign, colour and currency code, not a fixed pattern) and add a note under Clarifications in `specs/016-privacy-mode/spec.md`: "Note (2026-11-01): spec 018 replaces the fixed pattern with the real figure's shape in zeros (FR-002, FR-003); the sign and colour now stay."; run `pnpm check:docs`

**Checkpoint**: US1 works on its own: the mode shows zeros in the shape of the real amounts everywhere.

## Phase 4: User Story 2 - The app has one icon, the original (Priority: P1)

**Goal**: Nothing makes the icon follow the primary colour: no per-colour files, no run-time link swapping, no shell call, no Settings text. The colour picker, the stored preference and the address-bar colour stay.

**Independent Test**: Pick each colour; the icon links in the page, the manifest and the desktop icon never change; Appearance has no icon text; no per-colour icon file is shipped.

### Tests for User Story 2

- [X] T010 [P] [US2] Update `e2e/ux-primary-color.spec.ts`: remove the assertions that the icon, touch icon and manifest links change; assert instead that for every colour tried the links stay `/icon.svg`, `/favicon.ico`, `/apple-touch-icon.png` and `/manifest.webmanifest`, that the `theme-color` meta still follows the colour, that Appearance shows no text about the icon or reinstalling, and that Default and an offline colour change still work; update the file header comment
- [X] T011 [P] [US2] Update `apps/desktop/e2e/appearance.spec.ts` (drop the `appIcon` test hook helper and the "icon follows it" test; keep the test that the colour reaches the page) and `apps/desktop/e2e/hardening.spec.ts` (remove `'setPrimaryColor'` from the list of bridge members)
- [X] T012 [P] [US2] Update the bridge tests: remove the primary-colour cases from `apps/desktop/src/main/ipc.test.ts`, `apps/desktop/src/preload/bridge.test.ts` and `apps/web/src/adapters/platform/index.test.ts`; delete `apps/desktop/src/main/app-icon.test.ts` and `ui/theme/mirror-icon.browser.test.ts`; update `scripts/brand-assets.test.ts` by deleting the "icons for each primary colour" block and keeping the checks of the one icon set and `manifest.webmanifest`; update `apps/web/src/sw/core.test.ts` if it lists per-colour files

### Implementation for User Story 2

- [X] T013 [US2] In `packages/platform/src`: remove `PRIMARY_COLORS`, `PrimaryColorRequestSchema` and `PrimaryColorRequest` from `schemas.ts` and `index.ts`, `primaryColor` from `channels.ts`, and `setPrimaryColor` from `bridge.ts` (depends on T012)
- [X] T014 [US2] In the desktop shell remove `setPrimaryColor` and its `PrimaryColorRequestSchema` serve line from `apps/desktop/src/main/ipc.ts`, the `createAppIcon` import, the `appIcon` instance, `setDockIcon`/`setWindowIcons` wiring, the `setPrimaryColor` handler and the `appIcon` test hook from `apps/desktop/src/main/index.ts`, the `setPrimaryColor` member from `apps/desktop/src/preload/bridge.ts`, and delete `apps/desktop/src/main/app-icon.ts`; remove `'build/icons/**'` from `files` in `apps/desktop/electron-builder.config.mjs` (depends on T013)
- [X] T015 [US2] In the web app remove `setPrimaryColor` from `apps/web/src/adapters/platform/index.ts`; delete `ui/theme/mirror-icon.ts`; in `ui/theme/ThemeProvider.tsx` replace the `mirrorPrimaryIcon` effect with an effect that sets `content` of each `meta[name="theme-color"]` to the chosen colour (`colorOf(primary)`, dark value for a `media` containing `dark`, light otherwise), wrapped in try/catch, and fix the comment (depends on T013)
- [X] T016 [US2] Remove the files nothing uses any more with `git rm -r apps/web/public/icons apps/web/public/manifests apps/desktop/build/icons`; in `scripts/gen-brand-assets.mjs` delete the `PALETTE` read, the per-colour loop that writes `icons/<id>/` and `manifests/<id>.webmanifest`, and the matching lines of the header comment, keeping every other asset it makes (depends on T012)
- [X] T017 [US2] In `ui/settings/AppearanceSection.tsx` stop rendering the `settings.appearance.primary.installedNote` text; in `ui/i18n/messages/en.json`, `uk.json` and `pl.json` delete `settings.appearance.primary.installedNote` and change `settings.appearance.primary.description` to say only "The color of buttons and selected items." (and the Ukrainian and Polish equivalents without the icon); keep `ui/i18n/catalogue-complete.test.ts` green
- [X] T018 [P] [US2] Update the docs: `docs/pwa.md` (the "Primary colour and the icon" paragraph becomes the colour and the address-bar colour only), `docs/desktop.md` (remove the sentence about the shell setting the icon from the colour), `assets/README.md` (no per-colour sets, `build/icons` only listed if electron-builder still makes it), and add a note to `specs/014-custom-accent-color/spec.md` under Clarifications: "Note (2026-11-01): spec 018 removes the icon that followed the colour (user story 2); the colour itself stays."; run `pnpm check:docs`

**Checkpoint**: US2 works on its own: one icon, picker intact.

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T019 Run `pnpm --filter @cashfold/web build`, `pnpm check:bundle`, `pnpm check:licenses`; confirm the initial JavaScript did not grow beyond 374,121 bytes, `git ls-files | grep -c "public/icons/\|public/manifests/\|build/icons/"` prints `0`, and `git grep -n "setPrimaryColor\|mirrorPrimaryIcon\|createAppIcon\|PRIMARY_COLORS\|maskedFigure\|MASK_WIDTH_CLASS"` finds nothing outside `specs/` and `CHANGELOG.md`
- [X] T020 Run the full verification (`pnpm typecheck`, `pnpm exec eslint apps packages e2e scripts`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, the web e2e specs `ux-privacy-mode`, `ux-privacy-switch`, `ux-primary-color`, `a11y`, `ux-responsive`, `ux-command-palette` and `ux-help` on Chromium, Firefox and the RTL project, `pnpm --filter @cashfold/desktop build` and the desktop specs `privacy`, `appearance`, `hardening` and `help`) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **US1 (Phase 3)** and **US2 (Phase 4)**: both after Setup, independent of each other; can be done in either order or in parallel.
- **Polish (Phase 5)**: after the stories you ship.

### Within Each Story

- Tests first (they fail), then the implementation.
- US1: T006 (`mask.ts`) before T007 and T008.
- US2: T013 (platform package) before T014 and T015; T012 (tests) before T013 and T016.

### Parallel Opportunities

- Phase 3 tests: T002, T003, T004, T005 together; then T007 and T008 together after T006.
- Phase 4 tests: T010, T011, T012 together; then T014, T015 and T016 together after T013 (T016 only needs T012).
- T009 and T018 (docs) alongside anything else in their story.

## Parallel Example: User Story 1

```text
Task: "Rewrite ui/privacy/mask.test.ts"
Task: "Update ui/kit/amount.test.tsx"
Task: "Update ui/privacy/Privacy.browser.test.tsx and ui/accounts/AccountOption.browser.test.tsx"
Task: "Update e2e/ux-privacy-mode.spec.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1.
2. Phase 3: the zeroed mask end to end, with its tests and docs.
3. **Stop and validate** with quickstart section 2; ship if ready.

### Incremental Delivery

1. US1 (Privacy mode zeros).
2. US2 (one icon): remove the code and the bridge member first, then the files, so the build never points at a missing file.
3. Polish and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- A hidden amount's digits are never real: they come from a string replace on text already formatted, never from a parse of the number.
- Avoid: a digit from 1 to 9 in any text, label or clipboard for a hidden amount; a fixed width that hides a layout shift; leaving a per-colour icon, manifest or bridge member behind; raising the bundle budget.
