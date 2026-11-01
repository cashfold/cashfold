# Implementation Plan: One App Icon and Plain Zeros in Privacy Mode

**Branch**: `018-single-icon-zero-mask` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-single-icon-zero-mask/spec.md`

## Summary

Two independent fixes, both mostly deletion or simplification.

1. **Privacy mode shows the real amount's shape in zeros.** A masked amount is today a fixed constant ("0,000.00") with no sign and no colour. It becomes the real amount's formatted text with every digit replaced by `0`, blurred, with the sign, the gain/loss colour and the currency code kept. The zeros are still drawn from an attribute (no digit in the page text) and the reveal, announcement and hide rules are untouched. The plain-text helpers in the ledger (`money`, `signed`) return the same zeroed text.
2. **One app icon.** Everything that made the icon follow the primary colour is removed: the per-colour icon and manifest files, the page code that swaps links, the desktop `setPrimaryColor` call (bridge, channel, schema, handler, main-process module), the generator branch, the Settings text and the tests and docs. The original icon files at the top of `public/` and `build/icon.png` already exist and stay. The primary colour picker and its `data-primary` tokens stay.

## Technical Context

**Language/Version**: TypeScript (strict), React in a Next.js static export; Electron main and preload for the desktop app

**Primary Dependencies**: none new. Existing: `@cashfold/platform` (bridge schemas), the kit's `Amount`, `formatMoney`/`formatSigned`

**Storage**: none new. The stored `primary` preference is unchanged (so no migration)

**Testing**: Vitest (mask, amount markup, ledger helpers, brand assets, bridge and IPC), kit browser tests with axe, Playwright e2e (web and desktop), `pnpm check:bundle`

**Target Platform**: web app, installed web app, Electron desktop

**Project Type**: web application plus desktop shell

**Performance Goals**: no extra work per amount beyond one string replacement on text already being formatted

**Constraints**: strict CSP (no inline styles), WCAG 2.2 AA, EN/UK/PL, no new dependency, initial JavaScript within its budget (374,121 of 374,784 bytes; this change removes code, so it should shrink), no digit other than zero readable for a hidden amount

**Scale/Scope**: about 80 files touched, of which about 70 are deleted icon and manifest files; about 12 source files edited

## Constitution Check

- **I Zero-Knowledge**: Pass. Presentation only; nothing is sent.
- **II DDD / III Hexagonal**: Pass. `core` is untouched; the changes are in the UI, the platform bridge package and the desktop adapter.
- **IV CQRS / V Event Sourcing & CRDT**: Pass. No commands or events; the stored preference is unchanged.
- **VI Exact Money**: Pass. The zeroed text is made from the already exact formatted string; no number is parsed or computed with floats.
- **VII Local-First**: Pass. Works offline.
- **VIII Security Hygiene**: Pass. No dependency, script or network call; no inline styles. Removing an IPC channel narrows the bridge surface.
- **IX Simplicity**: Pass. This feature removes a mechanism and replaces a constant with a one-line transformation.
- **Workflow**: no protocol change (the bridge is an internal contract between the page and the shell), so no ADR. `docs/privacy.md`, `docs/pwa.md`, `docs/desktop.md` and `assets/README.md` need edits.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/018-single-icon-zero-mask/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
# Privacy mode
apps/web/src/ui/privacy/mask.ts (+ mask.test.ts)          # zeroed(text); maskedMoney(minor-formatted text); drop the fixed-width class and the fixed pattern
apps/web/src/ui/kit/amount.tsx (+ amount.test.tsx)        # masked span keeps sign, data-sign and tone colour; zeros from the real shape
apps/web/src/ui/ledger/LedgerProvider.tsx                 # money()/signed() return zeroed(formatMoney/formatSigned)
apps/web/src/ui/privacy/Privacy.browser.test.tsx, accounts/AccountOption.browser.test.tsx
e2e/ux-privacy-mode.spec.ts, apps/desktop/e2e/privacy.spec.ts
docs/privacy.md, specs/016-privacy-mode/* (note)

# Icon
REMOVED apps/web/public/icons/**, apps/web/public/manifests/**, apps/desktop/build/icons/**
REMOVED apps/web/src/ui/theme/mirror-icon.ts (+ browser test), apps/desktop/src/main/app-icon.ts (+ test)
apps/web/src/ui/theme/ThemeProvider.tsx                   # no icon effect; the address-bar colour is kept (research R5)
apps/web/src/adapters/platform/index.ts, packages/platform/src/{bridge,channels,schemas,index}.ts
apps/desktop/src/main/{index,ipc}.ts, apps/desktop/src/preload/bridge.ts (+ tests), apps/desktop/e2e/{appearance,hardening}.spec.ts
apps/desktop/electron-builder.config.mjs                  # drop 'build/icons/**'
scripts/gen-brand-assets.mjs, scripts/brand-assets.test.ts
apps/web/src/ui/i18n/messages/{en,uk,pl}.json             # drop settings.appearance.primary.installedNote, reword .description
apps/web/src/ui/settings/* (the note)                     # stop rendering the installed-icon note
e2e/ux-primary-color.spec.ts                              # no icon assertions
docs/pwa.md, docs/desktop.md, assets/README.md, specs/014-custom-accent-color/* (note)
```

**Structure Decision**: no new files in the app. The mask change stays inside `privacy/mask.ts` and its two callers; the icon removal is deletions plus the edits above.

## Phasing

1. **Phase 1 (US1, privacy)**: new mask helper and tests, `Amount`, ledger helpers, browser and e2e updates, docs. Ships on its own.
2. **Phase 2 (US2, icon)**: remove the page and shell code and the bridge member, then the files, generator, strings, tests and docs. Ships on its own.
3. **Phase 3**: build, bundle and licence checks, full verification.

## Complexity Tracking

No constitution violations to justify.
