# Implementation Plan: Privacy Mode Switch in the Sidebar

**Branch**: `017-privacy-switch-sidebar` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-privacy-switch-sidebar/spec.md`

## Summary

Spec 016 added Privacy mode and a sidebar button that appears only while the mode is on. This feature replaces that button with an always-present control that shows both states and toggles the mode, and adds a compact icon-only copy of it to the narrow-window top bar so it is one tap away without opening the drawer.

It is presentation only. The state is the existing `privacyMode` preference, read and flipped through the existing `usePrivacy()` hook, so the Settings switch, the keyboard shortcut and the command palette already stay in step with whatever the new control does. Two small components share one lazy chunk: a labelled sidebar item (used in the sidebar and in the drawer, which render the same sidebar) and a compact top-bar button. The top bar already exists only below the `lg` breakpoint, so "narrow windows only" needs no extra logic.

## Technical Context

**Language/Version**: TypeScript (strict), React in Next.js static export

**Primary Dependencies**: none new. Existing: `usePrivacy()`, the kit's `SidebarItem`, `NavbarItem` and the Heroicons re-exports (`EyeSlashIcon`, plus `EyeIcon` to add)

**Storage**: none new. The existing device-local `privacyMode` preference

**Testing**: Vitest (the item's markup and states), kit browser tests with axe (light and dark, narrow and wide, long translations), Playwright e2e (web, wide and narrow), desktop e2e (updated testids)

**Target Platform**: web app, installed web app, Electron desktop

**Project Type**: web application plus desktop shell

**Performance Goals**: toggling re-renders only what already re-renders when the mode changes; no extra work per amount

**Constraints**: strict CSP, WCAG 2.2 AA, EN/UK/PL strings, no new dependency, initial JavaScript stays inside its budget (374,069 of 374,784 bytes at the end of spec 016, so under 700 bytes of headroom): the new controls load in the existing lazy chunk, not in the initial one

**Scale/Scope**: two small components, about six strings, one icon re-export, a handful of test updates

## Constitution Check

- **I Zero-Knowledge**: Pass. Nothing is sent or stored beyond the existing device preference.
- **II DDD / III Hexagonal**: Pass. Presentation only; `core`, `crypto` and `protocol` are untouched.
- **IV CQRS / V Event Sourcing & CRDT**: Pass. No commands or events.
- **VI Exact Money**: Not touched.
- **VII Local-First**: Pass. Works offline.
- **VIII Security Hygiene**: Pass. No dependency, script or network call; no inline styles.
- **IX Simplicity**: Pass. The old indicator becomes the new control (a rewrite, not a new layer), and the top-bar button reuses it.
- **Workflow**: no protocol change, so no ADR. `docs/privacy.md` needs one sentence.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/017-privacy-switch-sidebar/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/ui/privacy/PrivacySwitch.tsx        # NEW (replaces PrivacyIndicator.tsx): the sidebar item and the top-bar button
apps/web/src/ui/privacy/PrivacySwitch.test.tsx   # NEW: markup in both states, both forms
apps/web/src/ui/privacy/PrivacySwitch.browser.test.tsx   # NEW: axe, keyboard, narrow and wide, long translations
apps/web/src/ui/privacy/PrivacyIndicator.tsx     # REMOVED
apps/web/src/ui/privacy/PrivacyProvider.tsx      # announce the mode change politely
apps/web/src/ui/shell/AppShell.tsx               # lazy-mount the sidebar item (both states)
apps/web/src/ui/shell/Topbar.tsx                 # the compact switch beside Add
apps/web/src/ui/kit/icons.ts                     # + EyeIcon
apps/web/src/ui/i18n/messages/{en,uk,pl}.json    # privacy.switch.*, privacy.announce.*; drop the unused privacy.indicator.* and privacy.mode.label
e2e/ux-privacy-mode.spec.ts, e2e/ux-privacy-switch.spec.ts   # testids, both states, narrow window
apps/desktop/e2e/{privacy.spec.ts,help.spec.ts}             # testid
docs/privacy.md                                   # one sentence
```

**Structure Decision**: one component file with two exports, loaded as one lazy chunk next to the existing privacy key listener. The top bar stays a thin shell component that receives the compact button from the lazy chunk.

## Phasing

1. **Phase 1 (US1, US2)**: the control in both states, the compact top-bar button, strings, the polite announcement, accessibility and layout checks. Ships on its own.
2. **Phase 2 (US3)**: confirm Settings, the shortcut and the palette stay in step; update the old testids; docs.

## Complexity Tracking

No constitution violations to justify.
