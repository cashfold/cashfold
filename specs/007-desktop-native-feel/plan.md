# Implementation Plan: Desktop Native Feel

**Branch**: `007-desktop-native-feel` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-desktop-native-feel/spec.md`

## Summary

Remove the application menu bar from the Electron shell, keep every shortcut working without it, stop interface text from being selectable, give controls native cursors, and drop the remaining web-page habits. The work lives almost entirely in `apps/desktop`: a small stylesheet that the shell injects into its own window (so the web app, its bundle and its Content-Security-Policy are untouched and a browser is unchanged by construction), a shortcut table that replaces the menu as the home of accelerators, a minimal macOS app menu, and a localized right-click menu for text fields. The web app gains only inert `data-selectable` markers on the values people copy on purpose (Secret Key, Emergency Kit text, server address, pairing details, error details) and any menu-only action that is not yet in Settings.

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / Electron (as in `apps/desktop`)

**Primary Dependencies**: Electron `Menu`, `webContents.insertCSS`, `before-input-event`, `context-menu`; existing `@cashfold/platform` bridge. No new dependency.

**Storage**: N/A. Nothing stored, synced or sent (FR-021).

**Testing**: Vitest unit tests in `apps/desktop/src/main/*.test.ts`; Playwright-for-Electron e2e in `apps/desktop/e2e`; web Vitest tests for the markers.

**Target Platform**: Windows, macOS, Linux desktop shells; the web app is a non-target that must not change.

**Project Type**: desktop-app shell around the existing web app (monorepo: `apps/desktop`, `apps/web`, `packages/platform`).

**Performance Goals**: Styles applied before first visible frame; no measurable change to start time.

**Constraints**: Strict Content-Security-Policy stays as is (no inline `style` or script added to the page); no change to `core`, `crypto`, `protocol`; the lock rule of 006 FR-011 stays (no data action while locked).

**Scale/Scope**: ~5 source files in the shell, 1 stylesheet, ~6 marker sites in the web app, 3 label sets.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I Zero-Knowledge | Pass. No data touched; the shell adds no logging of values. |
| II, IV, V (DDD, CQRS, event sourcing), VI money, VII local-first | Not affected. No domain, event, money or network change. |
| III Hexagonal | Pass. Changes are in the shell adapter; no inward dependency changes. |
| VIII Security hygiene | Pass. CSS is injected by the main process, not by a page script or inline style, so CSP is unchanged. Dropped files still go through the existing navigation lock. Secrets stay copyable only through the explicit marker, never logged. |
| IX Simplicity | Pass. No new dependency, no new layer. Using `insertCSS` rather than a web-bundle component is the smaller change. |
| Technology constraints | Pass. "No shell MAY require changes to `core`, `crypto` or `protocol`": none made. |
| Quality gates | Tests first for the shortcut table and the menu; a11y check on selection (SC-007) in e2e. |

Post-design re-check: still passes; no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/007-desktop-native-feel/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── desktop-chrome.md
│   └── shortcuts-without-menu.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/desktop/src/main/
├── menu.ts                # shrinks: macOS app-name menu only; no menu elsewhere
├── menu-labels.ts         # drops file/edit/view/window/help; adds text-field menu labels
├── native-feel.ts         # NEW: the injected stylesheet text and its install on a window
├── shortcuts.ts           # NEW: accelerator table + before-input-event handler (replaces menu accelerators)
├── text-menu.ts           # NEW: right-click menu for editable fields (localized, spelling suggestions)
├── window.ts              # no menu bar, setVisualZoomLevelLimits, installs the above
└── index.ts               # menu install simplified; setLanguage feeds labels only
apps/desktop/e2e/          # native-feel.spec.ts NEW
apps/web/src/ui/           # data-selectable on copy-on-purpose values; About/Settings gets menu-only links
specs/006-native-desktop-experience/contracts/menu-and-shortcuts.md   # amended: menu structure superseded by 007
```

**Structure Decision**: keep the shell-owned approach. Everything that differs between desktop and browser is applied by the shell onto its own window; the web app is only marked up, never branched on the platform, so the browser path cannot change.

## Complexity Tracking

No violations.
