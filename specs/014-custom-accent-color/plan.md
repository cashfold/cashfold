# Implementation Plan: Custom Primary Color

**Branch**: `014-custom-accent-color` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-custom-accent-color/spec.md`

## Summary

The person picks one of a curated set of primary colors in Settings → Appearance. The app re-themes at once by overriding the `--primary` family of design tokens, and the Cashfold mark is shown in the same color in the browser tab, the desktop dock/taskbar/window and the install manifest. Because the palette is curated, every color, its contrast pairs and its icon files are known ahead of time: tokens are tested for WCAG AA and icons are pre-rendered by the existing `gen:assets` script, so the app never draws icons at runtime.

Syncing the choice across devices (User Story 3) is the one part that touches the architecture: preferences are device-local today (`cashfold.ui`, "never synced") and no per-person synced store exists, because Folds are shared between members. It is therefore planned as a separate, last phase that needs an ADR and a protocol change. Phases 1 and 2 ship without it.

## Technical Context

**Language/Version**: TypeScript (strict), React in Next.js static export

**Primary Dependencies**: none new. Existing: Tailwind tokens in `tokens.css`, kit `Radio`, Electron `nativeImage`, Playwright (icon rendering in `gen:assets`)

**Storage**: device-local `cashfold.ui` prefs (new `primary` field, schema stays `v: 1` with a default); synced copy per Phase 3

**Testing**: Vitest (palette contrast, prefs parsing, bootstrap equivalence), browser kit tests, Playwright web and desktop e2e, protocol contract tests for Phase 3

**Target Platform**: web app, installed web app (PWA), Electron desktop (macOS, Windows, Linux)

**Project Type**: web application plus desktop shell

**Performance Goals**: color applied before first paint (inline bootstrap, as the theme is); icon updated within 2 s of the change

**Constraints**: offline, strict CSP (no inline style attributes; the bootstrap sets only CSSOM properties), WCAG 2.2 AA, EN/UK/PL strings, no third-party code

**Scale/Scope**: about 10 colors × 2 themes of tokens, about 10 icon sets, one settings control, one bridge call, one synced setting

## Constitution Check

- **I Zero-Knowledge**: Pass, conditional on Phase 3. The synced color is an opaque ciphertext to the server (FR-011); the server learns only that a profile blob exists and its size.
- **II DDD / III Hexagonal**: Pass. Phases 1–2 are `apps/web`/`apps/desktop` presentation. Phase 3 adds a small personal-settings concept behind a port in `core`; the palette itself is UI data and stays out of `core`.
- **IV CQRS / V Event Sourcing & CRDT**: Pass for 1–2 (no events). Phase 3 uses one last-writer-wins field with a hybrid logical clock so devices converge regardless of order or duplicates, with a versioned schema.
- **VI Exact Money**: Not touched. Semantic gain/loss/warning/danger tokens are explicitly not overridden (FR-005).
- **VII Local-First**: Pass. Choosing and applying work offline; sync is queued.
- **VIII Security Hygiene**: Pass. No dependency or script added beyond the existing inline bootstrap, whose hash CSP generation already handles. The manifest swap is checked against CSP (see research R4).
- **IX Simplicity**: Pass with one justified item. Phase 3 is the only new layer (see Complexity Tracking). Pre-rendered icons avoid a runtime renderer.
- **Workflow**: Phase 3 changes the protocol, so it needs an ADR and an `ARCHITECTURE.md` update in the same PR, and two reviewers with a threat-model note.

## Project Structure

### Documentation (this feature)

```text
specs/014-custom-accent-color/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/ui/
├── theme/
│   ├── palette.ts               # NEW: the curated colors, their token values per theme, icon file names
│   ├── palette.test.ts          # NEW: contrast of every pair, every color has an icon
│   ├── ThemeProvider.tsx        # apply the primary color (data-primary) next to data-theme
│   └── bootstrap.ts             # also set data-primary before first paint; keep equal to parser (test)
├── prefs/schema.ts              # new field `primary` (PrimaryChoice), default 'emerald'
├── settings/AppearanceSection.tsx  # color picker (swatch radio group) + installed-icon note
├── theme/mirror-icon.ts         # NEW: tab icon + manifest link swap; desktop bridge call
└── i18n/messages/{en,uk,pl}.json
apps/web/src/app/tokens.css      # [data-primary="…"] overrides of --primary, --on-primary, --accent-text, --focus
apps/web/public/icons/<color>/   # GENERATED: icon.svg, favicon.ico, icon-192/512, maskable, apple-touch
apps/desktop/build/icons/<color>.png  # GENERATED
apps/desktop/src/main/           # setIcon handler (dock / window / Linux) ; tray stays template
packages/platform/               # bridge: setPrimaryColor(color)
scripts/gen-brand-assets.mjs     # render the mark once per palette color
# Phase 3 only
packages/protocol/ , packages/core/src/sync , apps/server   # personal profile record
docs/adr/0013-synced-personal-settings.md
```

**Structure Decision**: Phases 1–2 are web and desktop only. The palette is one data file shared by tokens, bootstrap and icon generation so they cannot drift.

## Phasing

1. **Phase 1 (US1)**: palette, tokens, prefs field, bootstrap, picker, tests. Ships on its own.
2. **Phase 2 (US2)**: icon generation per color, tab icon, desktop icon, install manifest, the installed-icon note.
3. **Phase 3 (US3)**: synced profile setting with ADR. Can ship later without blocking 1 and 2.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New per-person synced profile record (Phase 3) | Spec clarification chose syncing across devices | Storing it in a Fold's settings would show it to every member and tie it to one Fold; the `cashfold.ui` prefs are explicitly never synced |
