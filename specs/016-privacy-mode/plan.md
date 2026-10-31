# Implementation Plan: Privacy Mode

**Branch**: `016-privacy-mode` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-privacy-mode/spec.md`

## Summary

Privacy mode is display-only masking in the page. A small in-memory store (`ui/privacy/`) holds which amounts the person has revealed on purpose; the setting itself lives in the device-local `cashfold.ui` preferences. Money reaches the screen through four paths, and all four are brought under one rule:

1. The kit's `<Amount>` component (most screens). When the mode is on it draws a fixed-width mask with the currency code and a "Hidden amount" name, and becomes a reveal control; the figure is never put in the DOM while masked.
2. `ledger.money` / `ledger.signed` (strings from `LedgerProvider`). They return the masked text while the mode is on. The few places that put these in JSX are changed to `<Amount>` so they can be revealed one by one.
3. Two message templates that put money inside a sentence (`budgets.ratio`, `schedules.transferAmount`). They are rendered with `<Amount>` nodes in place of the placeholders.
4. Notification text, built in the page (`adapters/notifications/notify.ts`). It becomes generic by default; details (schedule name, day) and then amounts are opt-in.

A source-scan test fails when a new place formats money outside these paths. The shortcut goes through the same three channels as the palette's (desktop shell table + Help list, the page's key listener in a browser, the palette registry), and a small indicator in the shell shows the state.

The largest risk is not the logic but coverage and the initial-JavaScript budget (2.4 KB of headroom): see research R2, R9 and R11.

## Technical Context

**Language/Version**: TypeScript (strict), React in Next.js static export

**Primary Dependencies**: none new. Existing: kit `Amount`, `LedgerProvider`, the prefs store (`ui/prefs`), the shell's overlay and cover state (`useCore().covered`), the palette registry (`ui/palette`), platform `ACTION_IDS` and `HELP_SHORTCUTS`

**Storage**: device-local `cashfold.ui` prefs get two fields (`privacyMode`, `notificationDetails`); the older reminder-amounts flag stays in its own key (`cashfold.reminders.amounts`). Reveal state is memory only

**Testing**: Vitest (masking, prefs parsing, reveal timers and clearing, notification text, shortcut agreement, source-scan ratchet), kit browser tests with axe in light and dark, Playwright e2e (web) that scans the DOM for any figure with the mode on, desktop e2e for the shortcut

**Target Platform**: web app, installed web app (PWA), Electron desktop (macOS, Windows, Linux)

**Project Type**: web application plus desktop shell

**Performance Goals**: toggling re-renders affected amounts in one frame; no extra network or storage reads per amount (the store is a single subscription per amount)

**Constraints**: offline, strict CSP (no inline style attributes), WCAG 2.2 AA, EN/UK/PL, no third-party code, initial JavaScript stays under its budget (372,363 of 374,784 gzipped bytes before this feature), `cashfold.ui` stays under its 4 KB cap

**Scale/Scope**: one store, one provider, one component change (`Amount`), about 8 call sites moved to `<Amount>`, one settings section, one indicator, one shortcut, two palette commands, one notification text builder change

## Constitution Check

- **I Zero-Knowledge**: Pass. Nothing is sent; masking is local. Notifications are built on the device and carry less by default.
- **II DDD / III Hexagonal**: Pass. Presentation only (`apps/web`, `apps/desktop` shortcut table, `packages/platform` ids). Nothing in `core`, `crypto` or `protocol` changes.
- **IV CQRS / V Event Sourcing & CRDT**: Pass. No commands or events; the settings are device preferences, never replicated.
- **VI Exact Money**: Pass. Masking never touches a value; formatting stays on bigint minor units; the reveal timer holds no money. The source-scan test protects "one formatting path".
- **VII Local-First**: Pass. Works offline; no network.
- **VIII Security Hygiene**: Pass. No dependency, script or network call. While masked, the figure is absent from the DOM, labels and titles (R3). No secrets reach logs or storage: the stored fields are two booleans.
- **IX Simplicity**: Pass. One small store and one provider replace per-screen logic. The mask is a component state, not a new layer.
- **Workflow**: no protocol or crypto change, so no ADR. Docs (`privacy.md`, `desktop.md`) and Help are updated in the same change.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/016-privacy-mode/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/ui/privacy/                  # NEW
├── mask.ts                    # pure: the mask text, fixed width, masked label
├── reveal-store.ts            # in-memory reveals: reveal(id), clear(), timers, subscribe
├── reveal-store.test.ts
├── PrivacyProvider.tsx        # reads the pref, clears reveals on route change, cover, lock, blur
├── usePrivacy.ts              # { on, toggle, isRevealed(id), reveal(id) }
├── interleave.ts              # puts <Amount> nodes into a translated sentence
├── interleave.test.ts
├── PrivacyIndicator.tsx       # the shell indicator (words + icon); toggles
├── PrivacyKeys.tsx            # the browser's key listener (the desktop shell sends an action)
├── privacy-keys.test.ts
├── PrivacySection.tsx         # Settings → Appearance: Privacy mode + notification details
├── money-sources.test.ts      # source scan: no money formatted outside the allowed paths
└── Privacy.browser.test.tsx   # masked amounts, reveal by click and keyboard, axe, light/dark
apps/web/src/ui/kit/amount.tsx            # masks when on; removes data-sign/tone; reveal control
apps/web/src/ui/ledger/LedgerProvider.tsx # money()/signed() mask-aware; formatting stays in format.ts
apps/web/src/ui/{plan,transactions,overview,data,accounts}/…   # strings in JSX -> <Amount>
apps/web/src/ui/accounts/AccountOption.tsx # name only while masked
apps/web/src/ui/prefs/{schema.ts,schema.test.ts}  # privacyMode, notificationDetails
apps/web/src/adapters/notifications/notify.ts     # generic text by default; details; amounts
apps/web/src/ui/desktop/{ReminderService.tsx,menu-action.ts,DesktopActions.tsx}
apps/web/src/ui/plan/SchedulesView.tsx    # reminder checkboxes move to the new section
apps/web/src/ui/palette/{actions.ts,registry.ts,PaletteHost.tsx}  # privacy commands, state in context
apps/web/src/ui/shell/{AppShell.tsx,HelpDialog.tsx}               # indicator mount, Help row
apps/web/src/ui/settings/AppearanceSection.tsx                    # mounts PrivacySection
apps/web/src/ui/i18n/messages/{en,uk,pl}.json
packages/platform/src/{schemas.ts,help-shortcuts.ts}              # 'privacy' action and Help row
apps/desktop/src/main/shortcuts.ts                                 # Mod+Shift+M, data: true
e2e/ux-privacy-mode.spec.ts, apps/desktop/e2e/{privacy.spec.ts,help.spec.ts}
docs/privacy.md, docs/desktop.md
```

**Structure Decision**: one new folder, `ui/privacy/`, holds the store, the provider, the shortcut and the settings so the feature can be read in one place. The kit's `Amount` changes in place because it is where the rule has to live.

## Phasing

1. **Phase 1 (US1)**: store, provider, `Amount` masking and reveal, `ledger.money/signed` masking, moving string-in-JSX call sites to `<Amount>`, the source-scan test, the Settings switch. Ships on its own.
2. **Phase 2 (US2)**: shortcut (shell table, Help, browser listener), palette commands, indicator.
3. **Phase 3 (US3)**: generic notification text, details setting, migration of the old amounts choice.
4. **Phase 4 (US4, US5)**: persistence checks, forms/exports untouched checks, docs.

## Complexity Tracking

No constitution violations to justify.
