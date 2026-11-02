# Implementation Plan: A Currency for Each Account Group

**Branch**: `021-group-currency` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-group-currency/spec.md`

## Summary

A group gets a currency, stored with the group. In the group view of the Accounts page, a group's subtotal becomes one amount in that currency, and an account in another currency also shows its balance converted to it.

Most of the machinery exists. The ledger read model already carries the Fold's exchange rates, the Overview already converts balances to the Fold's currency with the rule "the latest rate dated on or before the end of the day, one division, one half-even rounding", and the Overview already has the "rate missing, account left out" behavior. The work is:

1. **Data**: one optional field on the group record (`currency`, field number 5). A group without it reads as "follows the Fold's currency". No migration; older devices ignore a field they do not know.
2. **Core**: `createAccountGroup` and `updateAccountGroup` accept a currency; the group read model carries it; a new pure function `groupBalances` converts a group's accounts with the same rule as the Overview and reports the converted amounts, the subtotal, the rates used and the currencies that lack a rate.
3. **Web**: the add-and-rename form gets a currency choice (the same currency picker the account form uses); `accountSections` takes the converted subtotal for groups; `GroupSection` shows one subtotal and, for a group that left something out, a note with a link to the rates; each account row shows its converted amount when its currency differs from its group's.

## Technical Context

**Language/Version**: TypeScript (strict), React in a Next.js static export

**Primary Dependencies**: none new. Existing: `nearestPrior`, `convert`, `PIVOT_RATE` (`core/ledger/domain/exchange-rate`, `shared-kernel/fx`), the currency picker of the account form

**Storage**: one new optional record field, `GROUP_FIELD.currency = 5` (text). The SQL read-model tables are not written by the app (the ledger is built in memory from records), so there is no SQL change

**Testing**: Vitest (the new function with property tests, the commands, the record decoding, the sections), Playwright e2e with axe (light, dark and the RTL project) (create and change a group's currency, mixed-currency group, missing rate, two devices)

**Target Platform**: web app, installed web app, Electron desktop

**Project Type**: web application plus desktop shell

**Performance Goals**: converting a group is a few multiplications per account; the page stays instant with hundreds of accounts

**Constraints**: constitution VI (bigint minor units, the rate division once, half-even rounding once per account), V (additive record field, no event schema change), strict CSP, WCAG 2.2 AA, EN/UK/PL strings, no new dependency, initial JavaScript within its 375,808-byte budget (374,644 bytes on the last build: about 1.1 KB of headroom on a laptop and about 0.5 KB on CI, so the new UI must be small)

**Scale/Scope**: one new core function, two commands changed, one record field, one form field, one section component changed, about 6 strings per language

## Constitution Check

- **I Zero-Knowledge**: Pass. The currency is part of the group record, which is sealed and synced like the rest.
- **II DDD / III Hexagonal**: Pass. The conversion is a pure function in `core/ledger/application`, no I/O, no UI import.
- **IV CQRS**: Pass. The two existing commands write one more field; the Accounts page reads from the existing `ledgerBasics` query.
- **V Event Sourcing & CRDT**: Pass. The field is additive and per-field last-writer-wins like every other; an older device that does not know field 5 keeps working and does not erase it (it patches only the fields it knows). Converting is a read; no stored amount changes.
- **VI Exact Money**: Pass. `convert` is bigint with one half-even division; each account is rounded once; the subtotal is the sum of the rounded figures.
- **VII Local-First**: Pass. Rates are local data; nothing waits for the network.
- **VIII Security Hygiene**: Pass. No dependency, no inline style.
- **IX Simplicity**: Pass. It reuses the Overview's conversion rule and missing-rate notice instead of adding a second one.
- **Workflow**: a new field number in a record is a data-format addition, recorded in `docs/ARCHITECTURE.md` (section 3, the group record) and `docs/ledger.md`.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/021-group-currency/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/ledger/domain/tables.ts                   # GROUP_FIELD.currency = 5
packages/core/src/ledger/domain/records.ts                  # AccountGroup.currency (string | null), decodeGroup reads field 5
packages/core/src/ledger/application/account-commands.ts    # createAccountGroup / updateAccountGroup take a currency
packages/core/src/ledger/application/group-totals.ts        # NEW: groupBalances(...)
packages/core/src/ledger/application/group-totals.test.ts, group-totals.property.test.ts   # NEW
packages/core/src/index.ts                                  # export group-totals
apps/web/src/ui/accounts/GroupDialogs.tsx                   # the form: a currency choice
apps/web/src/ui/accounts/account-sections.ts (+ test)       # converted subtotal and missing currencies for groups
apps/web/src/ui/accounts/GroupSection.tsx                   # one subtotal, the missing-rate note
apps/web/src/ui/accounts/AccountsScreen.tsx                 # the converted amount on an account row
apps/web/src/ui/i18n/messages/{en,uk,pl}.json               # group currency, approximate, missing rate, rates used
e2e/ux-group-currency.spec.ts                               # NEW
docs/ARCHITECTURE.md, docs/ledger.md                        # the group record's new field
```

**Structure Decision**: the conversion lives in `core/ledger/application/group-totals.ts` next to the Overview's code, because it must follow the same rule as `netWorth`; the page only draws what it returns.

## Phasing

1. **Phase 1 (US1)**: the record field, the commands, the form. Ships on its own: a group has a currency that is kept and synced, though nothing uses it yet.
2. **Phase 2 (US2, US3)**: `groupBalances`, the sections, the account rows, the missing-rate note.
3. **Phase 3**: docs, build, bundle and full verification.

## Complexity Tracking

No constitution violations to justify.
