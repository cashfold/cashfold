# Implementation Plan: Categories Without Icons

**Branch**: `019-remove-category-icons` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-remove-category-icons/spec.md`

## Summary

A category becomes a name and a color. The Categories list stops drawing the emoji, the add and edit form loses its Icon dropdown, and the default categories made at sign-up are created without an icon. Nothing is migrated: the stored record keeps its (now unused) icon field number, old values are read and ignored, and no new value is ever written. The 16 emoji, their names in three languages, and the two form strings are deleted.

This is a removal. The only design choice is how much of the stored shape to remove, and the answer is "none of the wire format": field number 4 of a category record stays reserved, so older devices, backups and imports keep working.

## Technical Context

**Language/Version**: TypeScript (strict), React in a Next.js static export

**Primary Dependencies**: none new

**Storage**: unchanged. The category record keeps its field numbers; the read-model column `category.icon` stays in the schema and is left empty

**Testing**: Vitest (core category commands and defaults, UI messages and catalogue checks), kit browser tests with axe, Playwright e2e

**Target Platform**: web app, installed web app, Electron desktop

**Project Type**: web application plus desktop shell

**Performance Goals**: none; a list row loses one element

**Constraints**: strict CSP, WCAG 2.2 AA, EN/UK/PL strings, no new dependency, initial JavaScript no larger than the figure recorded in T001 (373,867 bytes when this spec was written; budget 374,784), no change to the sync or backup formats

**Scale/Scope**: about 10 source files edited, 3 message catalogues, a handful of tests

## Constitution Check

- **I Zero-Knowledge**: Pass. Nothing is sent or stored beyond what is today.
- **II DDD / III Hexagonal**: Pass. The category aggregate loses an optional attribute; no I/O in the domain.
- **IV CQRS / V Event Sourcing & CRDT**: Pass. Existing commands write fewer fields; record field numbers are unchanged, and a patch from an older device that sets the icon still merges (it is read and ignored). No schema change, so no upcaster.
- **VI Exact Money**: Not touched.
- **VII Local-First**: Pass.
- **VIII Security Hygiene**: Pass. Removing code and strings only.
- **IX Simplicity**: Pass. This removes a feature.
- **Workflow**: no protocol change (field 4 stays reserved), so no `docs/protocol.md` regeneration; `docs/ARCHITECTURE.md` is touched only to say a category's icon is unused.

Re-checked after Phase 1 design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/019-remove-category-icons/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/ledger/domain/category.ts            # drop icon from NewCategory / CategoryChanges and the patch
packages/core/src/ledger/domain/records.ts             # Category read model: drop icon; decode ignores field 4
packages/core/src/ledger/domain/tables.ts              # CATEGORY_FIELD.icon stays, commented as reserved
packages/core/src/ledger/domain/default-categories.ts  # drop icon from the defaults and the seeded categories
packages/core/src/ledger/application/category-commands.ts   # drop icon from createCategory / updateCategory
(+ their tests)
apps/web/src/ui/ledger/CategoriesScreen.tsx            # no emoji in the row, no Icon field in the form
apps/web/src/ui/ledger/palette.ts                      # drop ICONS, ICON_KEYS, iconFor; keep the colors
apps/web/src/ui/ledger/messages.test.ts, ui/i18n/catalogue-complete.test.ts   # drop the icon keys
apps/web/src/ui/i18n/messages/{en,uk,pl}.json          # drop ledger.icon.* (16), ledger.categories.form.icon, .noIcon
docs/ARCHITECTURE.md                                   # categories: "type, colour and order" (icon reserved)
e2e/                                                   # a check that no Icon field and no emoji appear
```

**Structure Decision**: removal across the core category aggregate, the Categories screen and the catalogues. Account groups, accounts and goals have their own `icon` field and are not touched (spec scope).

## Phasing

1. **Phase 1 (US1)**: core category aggregate and defaults, the Categories screen, palette and strings, with tests.
2. **Phase 2 (US2)**: check nothing else draws an emoji; add the e2e and guard test that keep it true.
3. **Phase 3**: build, bundle, docs and full verification.

## Complexity Tracking

No constitution violations to justify.
