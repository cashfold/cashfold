# Implementation Plan: Help Shows the Keyboard Shortcuts

**Branch**: `008-help-keyboard-shortcuts` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-help-keyboard-shortcuts/spec.md`

## Summary

Replace the Help sidebar item's only behaviour (re-show the Getting started card) with a help dialog. The dialog has two parts: the desktop-only keyboard-shortcut list and a getting-started part (a button while steps remain, an "all done" line after). The list is **data in `packages/platform`**, one declarative table of what the person sees (name, group, keys per system, whether it works while locked). The web app renders it in the system's own notation; the desktop package imports the same table in a **drift test** that checks it both ways against the shell's real shortcut table (`apps/desktop/src/main/shortcuts.ts`), and an e2e test presses every listed key. The shell's table and every existing shortcut stay unchanged. The dialog is owned by the Help item itself, so it works the same from the sidebar and the narrow-window drawer and focus returns to Help by construction.

## Technical Context

**Language/Version**: TypeScript (strict), React / Next.js static export (`apps/web`), Electron shell (`apps/desktop`)

**Primary Dependencies**: Existing kit `Dialog` (Headless UI), `useDesktop()` (platform), `@cashfold/platform`. No new dependency.

**Storage**: N/A. The only state is the existing "getting-started dismissed" preference, reused unchanged.

**Testing**: The drift test runs on every system through the shell's pure matcher; the Electron e2e runs on the host system, so each system's pass is recorded by hand in the quickstart (SC-002). Vitest (list data, formatter, dialog component, drift test in `apps/desktop/src/main`, catalogue completeness); Playwright web (`e2e/`, axe light/dark, drawer, browser hides shortcuts); Playwright-for-Electron (`apps/desktop/e2e`, press every listed shortcut, axe, shortcut-while-open).

**Target Platform**: Web (all browsers) and the Windows/macOS/Linux desktop shells.

**Project Type**: web app + desktop shell (monorepo `apps/web`, `apps/desktop`, `packages/platform`).

**Performance Goals**: Dialog opens within one frame of the press; the list is static data with no loading step.

**Constraints**: No change to `core`, `crypto`, `protocol`; strict CSP untouched (no inline style or script); no existing shortcut changes (FR-016); locked app exposes nothing (the dialog is part of the unlocked shell and closes on lock).

**Scale/Scope**: 24 list entries (11 app, 13 standard), 1 new dialog component, 1 data module, ~30 new message keys x 3 languages, 1 drift test, 3 e2e additions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I Zero-Knowledge | Pass. No data read, stored or sent; the dialog only reads whether checklist steps remain, already known on the device. |
| II, IV, V, VI | Not affected. No domain, command, event or money change. |
| III Hexagonal | Pass. Presentation in the web UI; the list is plain data in `packages/platform` with no I/O; no inward dependency changes. `core`/`crypto`/`protocol` untouched. |
| VII Local-first | Pass. Everything works offline. |
| VIII Security hygiene | Pass. No third-party script, no inline style, CSP unchanged. Nothing logged. |
| IX Simplicity | Pass. No new dependency or layer. One data module instead of a second hand-copied table. |
| Technology constraints | Pass. Next.js client-only, Tailwind, kit components. |
| Quality gates | Tests first for the list, formatter and drift test; Playwright e2e for the P1/P2 stories; axe (WCAG 2.2 AA) light and dark; i18n completeness check for en/uk/pl. |
| Dev workflow | Accessibility and i18n are part of done: covered above. |

Post-design re-check: still passes; no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/008-help-keyboard-shortcuts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── help-dialog.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/platform/src/
├── help-shortcuts.ts        # NEW: the list (data only) + types
├── help-shortcuts.test.ts   # NEW: shape, ids unique, every ActionId-based entry valid
└── index.ts                 # export the list

apps/web/src/ui/
├── shell/
│   ├── AppShell.tsx         # Help item opens the dialog instead of resetting the card
│   └── HelpDialog.tsx       # NEW: the dialog (+ test)
├── firstrun/checklist-status.ts   # NEW: "steps left?" shared by the card and the dialog
├── desktop/
│   ├── format-shortcut.ts   # NEW: keys -> text per system (+ test)
│   └── DesktopActions.tsx   # close the dialog before running a shortcut action
└── i18n/messages/{en,uk,pl}.json  # NEW keys

apps/desktop/
├── src/main/help-shortcuts.test.ts  # NEW: drift test, list vs SHORTCUTS, both ways, per system
└── e2e/help.spec.ts                 # NEW: press every listed shortcut; axe; open/close/focus

e2e/ux-help.spec.ts          # NEW: web: opens, no shortcuts section, drawer, focus, axe
docs/desktop.md              # shortcut table points at the list as its source
```

**Structure Decision**: The list lives in `packages/platform` because both the web UI and the desktop test must read it and neither app may import the other. It is data, not behaviour: the shell's table remains the only thing that handles key presses.

## Complexity Tracking

No violations.
