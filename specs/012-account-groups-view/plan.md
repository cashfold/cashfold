# Implementation Plan: Account Groups on the Accounts Page

**Branch**: `012-account-groups-view` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/012-account-groups-view/spec.md`

## Summary

Make the groups a person has made show up. The Accounts page gains a second arrangement, by group, with a subtotal per group (one amount per currency, never converted) and an "Ungrouped" section; a switch moves between it and the existing by-type arrangement, and the page opens by group for anyone who has grouped an account and not yet chosen. Each account shows its group, and its menu moves it to another group in one step. Group management leaves its collapsed section and gets a confirmation on delete that says what is kept and which budgets use the group. Almost all of it is page logic over data the ledger already returns, so the rules live in small pure modules with unit tests. The only change to `core` is one new command that moves an account in a single write and a duplicate-name check on two existing commands. No cryptography, protocol, server or storage-schema change. See [research.md](research.md) for decisions and [contracts/account-groups-ui.md](contracts/account-groups-ui.md) for the calls, screens and copy.

## Technical Context

**Language/Version**: TypeScript (strict, `exactOptionalPropertyTypes`), Node 26 for tooling

**Primary Dependencies**: None new. Existing: Next.js static export + Tailwind (`apps/web`), the Catalyst-derived `ui/kit` (`Radio`, `Dialog`, `Sheet`, `ConfirmDialog`, `Badge`, `Amount`), `@cashfold/core`

**Storage**: No new stored data. One new field in the device-local interface preferences (`lists.accountsView`). Groups and accounts keep their existing records

**Testing**: Vitest (core and web), a real-browser scenario for the new command against the encrypted database, Playwright (`e2e/ux-account-groups.spec.ts`), axe, the catalogue-complete test

**Target Platform**: Web (static export) and the Electron shell, which loads the same export. No shell change

**Project Type**: Web application with a desktop shell and an optional relay (`apps/web`, `apps/desktop`, `apps/server`, `packages/*`)

**Performance Goals**: The group view is derived from the accounts already in memory; for 200 accounts and 30 groups, building the sections takes under 50 ms (checked by a unit test with a generous margin).

**Constraints**: Works offline; exact money (`bigint` minor units, no floating point, no rates); the worker bundle budget (278 KiB, currently 259,920 bytes) must not be exceeded, so new code stays in the Accounts route chunk; strict CSP unchanged

**Scale/Scope**: About 9 source files touched, 6 new small modules, 24 new message keys in 3 languages, 1 e2e spec, 1 real-browser scenario

## Constitution Check

_GATE: passed before research, re-checked after design._

| #    | Principle                      | Result                                                                                                                                                                                                    |
| ---- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Zero-Knowledge by Construction | Pass. Nothing new leaves the device or reaches the service in readable form; the move is an ordinary encrypted operation.                                                                                 |
| II   | Domain-Driven Design in `core` | Pass. The two rules that belong to the domain, "a move is one atomic change" and "a group name is unique", are in the ledger commands. The display rules are page logic.                                  |
| III  | Clean / Hexagonal              | Pass. Page logic is pure functions in `ui/accounts`; the command is in the ledger application layer; no new port or adapter.                                                                              |
| IV   | CQRS                           | Pass. The move is a command that writes one operation; subtotals and sections are derived from the existing `ledger.basics` read model and never stored.                                                  |
| V    | Event Sourcing adapted to CRDT | Pass. `groupIds` is already a set merged by add and remove; the new command writes one delta that sets it, so concurrent moves on two devices converge by the existing rule. A convergence test is added. |
| VI   | Exact Money                    | Pass, and central. Subtotals add `bigint` minor units per currency; there is no float and no conversion. The no-float gate covers the new module.                                                         |
| VII  | Local-First                    | Pass. Everything works offline; the only data is already on the device.                                                                                                                                   |
| VIII | Security Hygiene               | Pass. No new network, storage of secrets, or third-party script. Names are shown as text, never as markup.                                                                                                |
| IX   | Simplicity and YAGNI           | Pass. No new store, query, port or dependency. One command and one preference field. Complexity Tracking is empty.                                                                                        |

Workflow gates: no cryptography, protocol or wire-format change, so no ADR. This is not an authentication or sharing change, so the two-reviewer rule does not apply. Accessibility and the three catalogues are part of done.

## Project Structure

### Documentation (this feature)

```text
specs/012-account-groups-view/
├── plan.md                         # This file
├── research.md                     # Phase 0
├── data-model.md                   # Phase 1
├── quickstart.md                   # Phase 1
├── contracts/
│   └── account-groups-ui.md        # Phase 1: calls, preference, screens, message keys
├── checklists/requirements.md
└── tasks.md                        # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/core/src/ledger/application/
├── account-commands.ts             # + moveAccountToGroup; group_name_taken in create and update group
└── account-commands.test.ts        # + tests for both (and a convergence case)

apps/web/src/
├── worker/ledger-handlers.ts                       # + 'ledger.moveAccountToGroup'
├── ui/prefs/schema.ts                              # lists.accountsView, parsed defensively
├── ui/accounts/account-sections.ts                 # new: groupOf, accountSections, subtotals
├── ui/accounts/accounts-view.ts                    # new: effectiveView, budgetsUsingGroup
├── ui/accounts/account-order.ts                    # new: moveWithin, the one shared order for both views
├── ui/accounts/AccountsViewSwitch.tsx              # new: the By group / By type radio group
├── ui/accounts/account-actions.ts                  # + "Move to {group}" actions
├── ui/accounts/AccountsScreen.tsx                  # view switch, group sections, group label, Add group
├── ui/accounts/GroupSection.tsx                    # new: a group's heading, subtotal and actions
├── ui/accounts/GroupDialogs.tsx                    # new: create or rename sheet, delete confirmation
├── ui/accounts/GroupManager.tsx                    # becomes the always-visible list for the type view
└── ui/i18n/messages/{en,uk,pl}.json                # 24 keys

e2e/ux-account-groups.spec.ts                       # new
apps/web/src/adapters/sqlite-opfs/test-scenarios.ts # + a scenario for the move command (with us1.browser.test.ts)
```

**Structure Decision**: Existing layout; every change sits in a file that already owns the behaviour. The new modules are small and pure, and the bundle stays inside the Accounts route.

## Phase 1 design notes

- **Order of work** (test-first): the core command and its tests, then the preference, then the pure section and view modules and their tests, then the menu actions, then the screen and dialogs, then messages in three languages, then the real-browser and end-to-end tests.
- **Risk 1, a subtotal that lies**: the spec's strongest promise is that a subtotal adds exactly what is listed and never mixes currencies. The pure module is tested with mixed currencies, negative balances, archived accounts, unknown balances, an empty group and an account in two groups, and the end-to-end spec checks a rendered figure.
- **Risk 2, two devices**: a move on one device and a rename or delete of the group on another must settle without losing the account. The command writes one set delta and the projection already drops ids of deleted groups, so the account reads as ungrouped. A convergence test and the two-device quickstart row cover it.
- **Risk 2a, the shared order**: the up and down controls must agree across both views (clarification 2). `moveWithin` works on the whole ordered list and is tested on the cases that break a per-section renumbering (ties, interleaved kinds, first and last).
- **Risk 2b, budgets after a delete**: a budget limited only to the deleted group counts nothing and is flagged. The confirmation says so; the budget behaviour itself is unchanged (research D-11).
- **Risk 3, the menu length**: one item per group is long with many groups. The existing menu scrolls; the end-to-end spec opens it with 20 groups and reaches the last item by keyboard.
- **Risk 4, the bundle**: nothing should add a dependency. Run `pnpm check:bundle` from a clean build after the MVP (the end of US2), not only at the end, since the limit has little headroom.
- **Existing behaviour to keep**: the by-type view, the up and down controls inside each section, the archived switch, the account form's "Group" field, and budgets scoped to groups.

## Complexity Tracking

No constitution violations. Nothing to justify.
