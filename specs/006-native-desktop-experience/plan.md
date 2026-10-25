# Implementation Plan: A Native Desktop Experience

**Branch**: `006-native-desktop-experience` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-native-desktop-experience/spec.md`

## Summary

Seven areas, delivered in the spec's priority order, each in its own pull request. Almost all of the work is in the desktop shell (`apps/desktop`), the shared bridge contract (`packages/platform`) and the web app's interface layer (`apps/web/src/ui`). `core`, `crypto`, `protocol` and the relay are untouched.

The design rests on four decisions:
1. **The shell tells the page, the page decides.** The shell reports operating-system facts (the computer locked, the theme changed, a menu item was chosen, a file or link arrived) through a few typed bridge events; the page, which owns the session and the data, acts on them. The shell holds no financial data and no keys.
2. **A locked app knows nothing.** Locking already ends the Core Worker and wipes the keys, so the badge, the recent-Fold entries and reminders exist only while unlocked and are cleared the moment the page reports a lock or the system reports one (spec clarification 1).
3. **"Keep running" means the window is hidden, not destroyed.** The page keeps running, so existing session timers and a new shell-level reminder service keep working until the person's idle or hidden-window time locks the app.
4. **Everything from outside is parsed in the shell with a strict grammar, size-limited, and handed to the page only as a request for review** (spec clarification 2: links never carry secrets).

Delivery order: a small foundation (desktop settings store, capability report, bridge scaffolding), then the seven stories P1 to P7. The frame (P7) is last and may slip without blocking anything.

## Technical Context

**Language/Version**: TypeScript (strict). Electron 45 (main and preload), React 19 / Next.js static export (renderer)

**Primary Dependencies**: none new at runtime. Electron APIs used: `powerMonitor`, `nativeTheme`, `Menu` with accelerators, `Tray`, `app.setBadgeCount` and `BrowserWindow.setOverlayIcon`, `Notification` (via the page), `app.setLoginItemSettings`, `app.setAsDefaultProtocolClient`, `app.requestSingleInstanceLock`, `titleBarStyle` / `titleBarOverlay`, `vibrancy` / `backgroundMaterial`, `Menu.popup`. Packaging (electron-builder) registers the protocol and the file types.

**Storage**: device-local only. Desktop preferences in the shell's existing state file (beside the window bounds); web preferences unchanged. Nothing is added to the ledger, the event log or the relay.

**Testing**: Vitest for the shell logic (link and file parsing, menu model, settings, badge, lock decisions, capability report), Vitest browser/component tests for the page side, the packaged-app Playwright suite (`apps/desktop/e2e`) for end-to-end behaviour per platform in CI, and the web Playwright suite for anything that must stay unchanged in a browser.

**Target Platform**: Windows 10/11 (x64), macOS (arm64, x64), Linux (AppImage, deb, rpm; GNOME, KDE, others best effort)

**Project Type**: desktop shell around the shared web app (monorepo)

**Performance Goals**: lock within 5 s of a system lock/sleep event; theme change followed within 1 s; CSV drop to preview under 2 s; reminder within 1 min of due; start at login to running-and-locked within 10 s; no launch frame in the wrong colour

**Constraints**: the web build must not grow beyond the bundle budget (about 20 KB gzipped of headroom today), so every desktop-only module is loaded only when the desktop bridge exists (dynamic import, as the update controls already do) and the bundle check runs in every story; the only change in web behaviour is that reminders run on every screen (see the spec's Assumptions); the strict Content-Security-Policy and sandbox stay; nothing sensitive in any OS surface while locked; every new string in en/uk/pl; all new interface keyboard and screen-reader accessible

**Scale/Scope**: about 12 new files in `apps/desktop/src/main`, a handful in `apps/desktop/src/preload` and `packages/platform/src`, a `ui/desktop` folder and edits to roughly 10 existing web files; 3 new docs

All unknowns are settled in [research.md](research.md); two items that need a real-machine check are listed there as verification tasks, not open questions.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1, still passed. Two items carry process obligations (below).*

| Principle | Result |
|-----------|--------|
| I Zero-knowledge | Pass. Nothing new is sent to the service. The shell never sees keys or ledger data. A locked app shows no badge, no recent Folds, no reminders; plaintext schedule times are explicitly not stored (clarification 1). |
| II–V DDD, hexagonal, CQRS, event sourcing | N/A. No domain, event or projection change. The count that feeds the badge is derived from an existing query. |
| VI Exact money | N/A. Amounts appear only in a notification when the existing opt-in is on, formatted by the existing formatter. |
| VII Local-first | Pass. Everything works offline. |
| VIII Security hygiene | Pass with a process obligation. No third-party code or script. The custom protocol and file handlers are new input paths and are handled by the strict intake contract. CSP, sandbox, context isolation, fuses and navigation locks are unchanged. The bridge stays a frozen set of fixed calls. |
| IX Simplicity | Pass. No new framework; each Electron capability sits in one small module; the context menu reuses the existing action definitions. Optional niceties (translucency) are last and removable. |
| Technology constraints | "No shell MAY require changes to `core`, `crypto` or `protocol`": met. |
| Quality gates | Tests per area, the existing a11y and bundle gates, and packaged-app tests on all three systems in CI. i18n and accessibility are part of done. |
| Security-sensitive changes need a threat-model note and two reviewers | **Applies** to P1 (lock policy replaces hide-on-blur on desktop, amending spec 001 FR-007) and P6 (links and files from outside). Tasks add the threat-model section and mark both pull requests for two reviewers. |
| ADR required for decisions costly to reverse | **Applies**: one ADR (ADR-0012) records the lock policy change and the intake rules. |

## Project Structure

### Documentation (this feature)

```text
specs/006-native-desktop-experience/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── desktop-bridge-additions.md   # new typed calls and events between shell and page
│   ├── link-and-file-intake.md       # cashfold:// grammar, file kinds, limits, refusal rules
│   └── menu-and-shortcuts.md         # menus, accelerators, tray, dock, jump list
└── tasks.md                          # created by /speckit-tasks
```

### Source Code (repository root)

```text
packages/platform/src/
├── channels.ts            # + the new channel names
├── schemas.ts             # + strict schemas for the new requests, answers and events
└── bridge.ts              # + the new bridge methods and `platform`

apps/desktop/src/main/
├── desktop-settings.ts    # new: hide-on-blur, start-at-login, close behaviour, theme mirror (extends desktop-state)
├── system-events.ts       # new: powerMonitor lock/sleep/screen-saver -> "lock now" event; capability report
├── appearance.ts          # new: nativeTheme + window colours from the first frame
├── app-menu.ts            # new: full menu with accelerators and actions (replaces most of menu.ts)
├── context-menu.ts        # new: validated native pop-up menu for rows
├── badge.ts               # new: dock count / Windows overlay icon
├── tray.ts                # new: tray / menu-bar item, dock menu, jump list
├── background.ts          # new: close = hide (inactive until step 5), show/quit rules
├── test-hooks.ts          # new: compiled in only when the build defines __CASHFOLD_TEST_HOOKS__ (never in a release)
├── intake.ts              # new: parse and size-check files and cashfold:// links, hand to the page
├── frame.ts               # new: title bar options per platform, translucency, reduced-transparency fallback
├── menu-labels.ts         # extended: en/uk/pl text for menus, tray, dialogs
├── window.ts              # edited: uses appearance, frame, background
├── ipc.ts                 # edited: the new channels
└── index.ts               # edited: wiring, single-instance hand-over, protocol and file events
apps/desktop/src/preload/bridge.ts   # edited: new methods and events, still one frozen object
apps/desktop/electron-builder.config.mjs   # edited: protocol and file associations, icon assets

apps/web/src/ui/desktop/             # new: everything that exists only in the desktop app
├── DesktopSettingsProvider.tsx   # settings, capabilities, platform (above CoreProvider)
├── useDesktop.ts
├── lazy.tsx               # DesktopOnly: loads desktop-only modules by dynamic import when the bridge exists
├── DesktopActions.tsx     # menu actions, incoming items (in the unlocked shell)
├── DropGuard.tsx          # in both shells: cancels the default drop, ignores drops while locked with a message
├── ContextMenu.ts         # asks the shell to pop up a native menu for a row
├── DropTarget.tsx         # window and sheet drop handling, validation, messages
├── ReminderService.tsx    # shell-level reminders and badge count while unlocked
├── FrameInsets.tsx        # sets the platform/frame attributes used by CSS
└── DesktopSettings.tsx    # Settings -> Desktop section
apps/web/src/ui/core/CoreProvider.tsx      # edited: no blur cover on desktop unless the option is on; lock on system event
apps/web/src/ui/shell/Topbar.tsx, AppShell.tsx, sidebar-layout.tsx   # edited: drag region, insets, translucency hooks
apps/web/src/ui/transactions/*, accounts/*   # edited: row context menu uses the existing action definitions
apps/web/src/ui/plan/SchedulesView.tsx       # edited: reminders move out to ReminderService
apps/web/src/ui/i18n/messages/{en,uk,pl}.json   # + new text

docs/desktop.md, docs/threat-model.md, docs/adr/0012-desktop-lock-policy-and-intake.md
apps/desktop/e2e/                    # new packaged-app specs per area
```

**Structure Decision**: keep desktop-only code in `ui/desktop` and `apps/desktop/src/main`, one module per capability. The page never imports the shell; it talks to the bridge through the existing validating adapter in `apps/web/src/adapters/platform`.

## Delivery Plan

| Step | Story | Ships alone? | Needs |
|------|-------|--------------|-------|
| 0 | Foundation: settings store, capability report, bridge scaffolding, `ui/desktop` provider, close-to-background mechanism (present but **inactive**), lazy loader, test hooks | yes (no visible change on any system) | none |
| 1 | P1 Lock policy | yes | 0 |
| 2 | P2 First frame colours | yes | 0 |
| 3 | P3 Shortcuts and menus | yes | 0 |
| 4 | P4 Context menus and drops | yes | 0, 3 (shared action model) |
| 5 | P5 Badge, notifications, tray, dock menu, jump list; **activates** close-to-background and its Settings switch | yes | 0 |
| 6 | P6 Start at login, files, links (login first, then intake) | yes | 0, 5 (tray) |
| 7 | P7 Frame and translucency | yes, and may slip | 0, 2 |

The close-to-background mechanism is built in step 0 but stays inactive (closing the window behaves exactly as today on every system) until step 5 switches it on together with the tray item that makes it safe and its Settings switch. This keeps the macOS behaviour, where closing today destroys the window and the existing page-hide handling locks the app, unchanged until the lock policy and the threat-model note (step 1) are in. Start at login and the intake of files and links follow in step 6. The tray labels are written in step 5, not in step 3.

## Complexity Tracking

| Addition | Why it is needed | Simpler alternative rejected because |
|----------|------------------|--------------------------------------|
| A bridge surface roughly three times its current size | The page must learn about system events and the shell must act on page decisions | One generic message channel would be shorter but is exactly what the bridge contract forbids (no generic channel, fixed calls, strict schemas) |
| Native pop-up context menu through the shell | Native feel (shortcuts, fonts, accessibility, positioning) | A web-drawn menu is simpler but is visibly not native and duplicates the Headless menu logic |
| A shell-level reminder service in the page | Reminders today run only while the Schedules view is mounted; the badge and background notifications need them everywhere | Doing it in the shell would need the shell to read the ledger, which breaks the zero-knowledge boundary |
