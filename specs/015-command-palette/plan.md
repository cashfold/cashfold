# Implementation Plan: Command Palette

**Branch**: `015-command-palette` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-command-palette/spec.md`

## Summary

One keyboard-opened modal search box, shared by the web app and the desktop app, that jumps to accounts, envelopes, goals and screens and runs a small set of existing actions. It is built from four small, separately tested parts: a pure fuzzy matcher, a command registry that features contribute to, a device-local usage history, and one dialog component that follows the ARIA combobox/listbox pattern.

The shortcut reaches the page in two ways that never overlap. In the desktop app the shell already owns every shortcut (`apps/desktop/src/main/shortcuts.ts`), so Cmd/Ctrl+K becomes one more entry that sends the page a new `palette` action id. In a browser the page listens for the key itself. The palette is mounted only inside the unlocked shell, which unmounts on lock, so it cannot open while locked and closes on every kind of lock without extra code.

Accounts come from the ledger state already in memory (`useLedger().basics`). Envelopes and goals are not in that state, so the palette reads them with the two local read-model queries the Plan screen already uses (`budgets.list`, `goals.progress`) when it opens. No new query, no network call, no new dependency.

## Technical Context

**Language/Version**: TypeScript (strict), React in Next.js static export

**Primary Dependencies**: none new. Existing: Headless UI (`Dialog`, `Combobox` already wrapped by the kit), Tailwind tokens, `foldLetters` from `i18n/collation.ts`, the platform package's action ids and Help shortcut list

**Storage**: a new device-local key `cashfold.palette` in `localStorage`: identifiers, counts and times only, capped. Not the synced vault, not `cashfold.ui` (its 4 KB cap is for layout preferences, and its account-scoped part is reset in one place that this feature hooks into)

**Testing**: Vitest (matcher, registry, ranking, history, locked guard, shell table and Help list), kit browser tests with axe (dialog, keyboard, announcements), Playwright e2e (web and desktop) for the open/jump/lock path

**Target Platform**: web app, installed web app (PWA), Electron desktop (macOS, Windows, Linux)

**Project Type**: web application plus desktop shell

**Performance Goals**: results update within one frame of a keystroke for 500+ entries (a single pass of a cheap scorer, no debounce); palette opens in under 100 ms after the shortcut, with entity data read once per open

**Constraints**: offline, strict CSP (no inline style attributes), WCAG 2.2 AA, EN/UK/PL strings, no third-party code, no names persisted outside the encrypted store, no new bundle dependency (bundle-size gate stays green)

**Scale/Scope**: one dialog, one matcher, one registry (about 12 built-in commands), one history store, one Settings control, one new action id, one shell table entry, one Help list entry

## Constitution Check

- **I Zero-Knowledge**: Pass. Nothing leaves the device. The history stores identifiers and counts only (FR-011); names are read from the encrypted store on each open. The server is not involved.
- **II DDD / III Hexagonal**: Pass. This is presentation in `apps/web/src/ui/palette/`. It reads through the existing ledger hook and adds nothing to `core`, `crypto` or `protocol`. The only shared-package change is one string added to the platform package's closed action list and Help list.
- **IV CQRS / V Event Sourcing & CRDT**: Pass. The palette only runs existing commands through their existing entry points and reads through existing queries. It appends no events and keeps no read model.
- **VI Exact Money**: Not touched. No amounts are shown, so no money formatting is added.
- **VII Local-First**: Pass. Everything works offline; the reads are local.
- **VIII Security Hygiene**: Pass. No dependency, script or network call added. Account, envelope and goal names are never logged or persisted (the history key holds opaque ids; the key itself carries no account id, see research R5). The history is wiped on sign-out with the other account-scoped state.
- **IX Simplicity**: Pass. The registry is a plain list with a `register` function and no framework; the matcher is about 80 lines; no new layer. No Complexity Tracking entries.
- **Workflow**: no protocol or crypto change, so no ADR is required. `docs/desktop.md` and the Help list are updated in the same change.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/015-command-palette/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/ui/palette/                 # NEW
├── fuzzy.ts                  # pure matcher: score + highlight ranges, accent/case-insensitive
├── fuzzy.test.ts
├── registry.ts               # Command type, register(), list(), availability filter
├── registry.test.ts
├── builtin-commands.ts       # screens + actions, registered once at module load
├── entities.ts               # accounts / envelopes / goals -> entries, for the open palette
├── history.ts                # recent + frequent store, caps, clear
├── history.test.ts
├── ranking.ts                # empty-query sections and query ordering using history
├── ranking.test.ts
├── CommandPalette.tsx        # the dialog (combobox + listbox), highlight, live count
├── CommandPalette.browser.test.tsx   # keyboard, roles, announcements, axe, themes, reduced motion
├── PaletteHost.tsx           # mounts in the unlocked shell (lazy chunk): shortcut, open state, lock guard
├── palette-bus.ts            # open/toggle signal used by the host, the desktop action and Help
└── palette-guard.test.ts     # not while locked, not over another dialog, closes on lock/cover
apps/web/src/ui/shell/AppShell.tsx        # mount <PaletteHost/> inside the unlocked shell
apps/web/src/ui/desktop/menu-action.ts    # handle the `palette` action (+ test)
apps/web/src/ui/desktop/DesktopActions.tsx# run `palette` without closing other overlays first
apps/web/src/ui/shell/HelpDialog.tsx      # list the palette shortcut in browser and desktop
apps/web/src/ui/prefs/reset-account.ts    # (via core) wipe palette history when the account leaves the device
apps/web/src/ui/core/CoreProvider.tsx     # forgetAccountScopedState also clears the palette key
apps/web/src/ui/settings/DataAndStorage.tsx   # "Clear palette history" control
apps/web/src/ui/plan/{GoalsView,BudgetsView}.tsx  # honour ?item=<id>: scroll to and focus the row
apps/web/src/ui/i18n/messages/{en,uk,pl}.json
packages/platform/src/schemas.ts          # ACTION_IDS += 'palette'
packages/platform/src/help-shortcuts.ts   # one more app shortcut: palette, Primary+K
apps/desktop/src/main/shortcuts.ts        # SHORTCUTS += { k, primary, action: 'palette', data: true }
apps/desktop/src/main/shortcuts.test.ts, help-shortcuts.test.ts   # keep the two lists in step
docs/desktop.md, docs/privacy.md         # shortcut and the device-local history
```

**Structure Decision**: all new UI lives in one folder, `apps/web/src/ui/palette/`, with pure logic (matcher, registry, history, ranking) split from the React parts so it can be unit tested without a DOM. The shell and platform packages change only by one action id, one table entry and one Help entry.

## Phasing

1. **Phase 1 (US1 + US4, the P1 stories)**: matcher, registry with screens and entity entries, dialog, shortcut on web and desktop, lock/cover/overlay guards, accessibility, i18n, Help entry. Ships on its own.
2. **Phase 2 (US2)**: action commands (add transaction, lock now, switch theme, sign out / use a different account, help), each calling the existing entry point and its confirmation.
3. **Phase 3 (US3)**: history store, empty-query sections, ranking, Settings clear control, sign-out wipe.
4. **Phase 4 (US5)**: Help dialog on web, docs, parity e2e across web and desktop.

## Complexity Tracking

No constitution violations to justify.
