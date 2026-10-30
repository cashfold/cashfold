# Implementation Plan: Account Balance in Account Dropdowns

**Branch**: `013-account-balance-in-dropdown` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-account-balance-in-dropdown/spec.md`

## Summary

Every account dropdown shows each account's current balance beside its name. The balance already exists on the account rows the web app loads (`balanceMinor`, the same value the Accounts page shows), so no `core`, `protocol` or server change is needed. The plan adds one shared account option in `apps/web` and switches the existing account dropdowns to it, with translations and tests.

## Technical Context

**Language/Version**: TypeScript (strict), React in Next.js static export

**Primary Dependencies**: existing kit `Select`/`Listbox` (Headless UI), kit `Amount` for money formatting

**Storage**: N/A (balances derived on device from the existing ledger view)

**Testing**: Vitest (unit and browser kit tests), Playwright desktop/web e2e already covering the dropdowns

**Target Platform**: Web app and the Electron desktop shell that embeds it

**Project Type**: web application (client-only)

**Performance Goals**: no extra load; opening a dropdown renders from data already in memory

**Constraints**: offline-capable, no financial data leaves the device, WCAG 2.2 AA, EN/UK/PL strings

**Scale/Scope**: 8 dropdowns in 6 files, one new component, a few strings

## Constitution Check

- **I Zero-Knowledge**: Pass. Balances computed locally, nothing sent.
- **II DDD / III Hexagonal / IV CQRS / V Event sourcing**: Pass. Read-only use of an existing query; no domain, command or event change. Balance logic stays in `core` (`accountBalance`), the UI only displays it.
- **VI Exact Money**: Pass. Uses `bigint` minor units and the kit `Amount`; no floats.
- **VII Local-First**: Pass. Works offline.
- **VIII Security Hygiene**: Pass. No new dependency or script.
- **IX Simplicity**: Pass. One small shared component, no new abstraction layers. Accessibility and i18n are part of done and are covered below.

No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/013-account-balance-in-dropdown/
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
├── kit/                     # (unchanged) Select, Listbox, Amount
├── accounts/
│   ├── AccountOption.tsx    # NEW: option showing name and balance
│   └── AccountOption.test.tsx
├── transactions/TransactionMode.tsx      # add/edit transaction account dropdown
├── transactions/TransferMode.tsx         # transfer from and to dropdowns
├── transactions/TransactionsScreen.tsx   # filter account dropdown
├── plan/SchedulesView.tsx                # account and transfer-target dropdowns
├── overview/OverviewScreen.tsx           # day-end chart account dropdown
├── plan/GoalsView.tsx                    # goal account dropdown
├── data/CsvImportPanel.tsx               # import account dropdown
└── i18n/messages/{en,uk,pl}.json         # balance wording
```

**Structure Decision**: web-only change under `apps/web/src/ui`. The shared option lives in `ui/accounts` and is imported by the other screens.

## Complexity Tracking

None.
