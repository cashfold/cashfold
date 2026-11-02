---

description: "Task list for Categories Without Icons"
---

# Tasks: Categories Without Icons

**Input**: Design documents from `/specs/019-remove-category-icons/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel, different files, no unfinished dependency)

Paths under `apps/web/src/ui/` are written `ui/...`. Account groups, accounts and goals have their own `icon` fields and are not touched.

## Phase 1: Setup

- [X] T001 Confirm you are on branch `019-remove-category-icons`, run `pnpm vitest run` once to record a green baseline, then `pnpm --filter @cashfold/web build` and `pnpm check:bundle` and write the "initial JS" size into the PR notes (measured on the previous feature as 373,867 of 374,784 bytes; use the figure you measure now); later tasks must not raise it

## Phase 2: Foundational

No shared prerequisite: the two stories touch different layers (US1 the category aggregate and screen, US2 the guard that keeps emoji out).

## Phase 3: User Story 1 - A category is a name and a color (Priority: P1) 🎯 MVP

**Goal**: A category is a name and a color. The list row is a swatch and a name, the form has no Icon field, the default categories are created without an icon, and stored icon values from older data are read and ignored, never written.

**Independent Test**: With the default categories and a category that carried an icon before this change, open Settings → Categories: no emoji and no gap in any row. The add and edit forms have no Icon field. Create and edit a category with a name and a color. Restore a record that carries field 4: the category shows with no icon.

### Tests for User Story 1

- [X] T002 [P] [US1] Update `packages/core/src/ledger/domain/default-categories.test.ts`: the default roots and the seeded categories have no `icon` property, ids and names are unchanged, and seeding twice for the same Fold gives the same ids
- [X] T003 [P] [US1] Update `packages/core/src/ledger/domain/category.test.ts` and `packages/core/src/ledger/application/category-commands.test.ts`: `createCategory` and `updateCategory` write no `CATEGORY_FIELD.icon` (field 4) in the record patch; a record that carries field 4 (`'utensils'`) decodes to a `Category` that has no `icon` key; each patch that `seedDefaultCategories` submits for the defaults has no field 4; a patch from an older device that sets field 4 is accepted and merges without error and without changing name, color or parent
- [X] T004 [P] [US1] Update `ui/ledger/messages.test.ts` and `ui/i18n/catalogue-complete.test.ts`: in `messages.test.ts` drop `ICON_KEYS` and the `ledger.icon.*` keys from the expected key list; in `catalogue-complete.test.ts` remove `'ledger.icon.bus'` and `'ledger.icon.landmark'` from the "words that happen to be the same in Polish" allow-list (the keys no longer exist); keep every other check
- [X] T005 [P] [US1] Add cases to `e2e/ux-categories.spec.ts`: each list row holds a color swatch and the name and its text has no character matching `\p{Extended_Pictographic}`; the add and edit forms have no "Icon" label, no control with id `cat-icon` and no "No icon" option; a category is created with a name and a color, edited, archived and listed; with Polish and Ukrainian selected no icon text is left; `expectNoA11yViolations()` passes on the list and on the open add form, and Tab goes from the name through the type, parent and color controls to the form buttons with no stop in between. The sub-check that a stored record carrying field 4 shows no icon is covered by T003, not here

- [X] T006 [P] [US1] Add compatibility checks for FR-006: in `packages/core/src/sync/application/backup.test.ts` back up a Fold that holds a category record with field 4 set (`CATEGORY_FIELD.icon`, `'utensils'`) and restore it into another Fold; the restored category has the same name, color and parent, the decoded `Category` has no `icon`, and restoring a backup made without field 4 works too; in the test of the CSV export (find it with `git grep -l "CsvExportPanel\|exportCsv" -- apps packages`) assert the exported text has no category icon value and no column named icon

### Implementation for User Story 1

- [X] T007 [US1] In `packages/core/src/ledger/domain/category.ts` remove `icon` from `NewCategory`, `CategoryChanges` and `categoryFieldPatch` (delete the `if (changes.icon !== undefined) f.set(CATEGORY_FIELD.icon, changes.icon)` line); in `packages/core/src/ledger/domain/tables.ts` keep `CATEGORY_FIELD.icon: 4` and add a comment that field 4 is reserved for the former icon, is never written and must never be reused (depends on T002, T003)
- [X] T008 [US1] In `packages/core/src/ledger/domain/records.ts` remove `icon` from the `Category` read model and from `decodeCategory` (field 4 is not read); in `packages/core/src/ledger/domain/default-categories.ts` remove `icon` from the `DefaultRoot` type, from each of the 13 roots, and from the seeded `DefaultCategory` and the `out.push(...)` calls for roots and children (depends on T007)
- [X] T009 [US1] In `packages/core/src/ledger/application/category-commands.ts` remove `icon` from the `createCategory` and `updateCategory` argument types and from the patches they build, and from the patch that `seedDefaultCategories` builds for each default (the `icon: d.icon` entry); fix every caller that passes `icon` for a category (`apps/web/src/worker/app-handlers.ts` and any type error `pnpm typecheck` reports) (depends on T007, T008)
- [X] T010 [US1] In `ui/ledger/CategoriesScreen.tsx` remove the `iconFor(c.icon)` span from the row, the `icon` state, the `icon` entry in `changes`, and the whole Icon field (the `label htmlFor="cat-icon"`, the `Select id="cat-icon"`, the "No icon" option and the `ICON_KEYS` options); remove `ICON_KEYS` and `iconFor` from the import; in `ui/ledger/palette.ts` delete `ICONS`, `ICON_KEYS` and `iconFor` and update the header comment to "Category colours" (depends on T004, T009)
- [X] T011 [US1] Delete these keys from `ui/i18n/messages/en.json`, `uk.json` and `pl.json`: the 16 `ledger.icon.<key>` entries (`utensils, home, bus, heart, user, ticket, users, landmark, tag, briefcase, trending-up, coins, cart, gift, book, paw`), `ledger.categories.form.icon` and `ledger.categories.form.noIcon`; keep `ui/i18n/catalogue-complete.test.ts` green (depends on T010)
- [X] T012 [P] [US1] Update `docs/ARCHITECTURE.md` line "Categories form a two-level taxonomy (root and child) with type, icon, colour and order" to drop "icon", and add one sentence where the category record is described that field 4 (icon) is reserved and ignored (depends on T007)

**Checkpoint**: US1 works on its own: categories are a name and a color everywhere, and older data still loads.

## Phase 4: User Story 2 - No emoji drawn by the app (Priority: P2)

**Goal**: Nothing the app draws is an emoji, and a test keeps it that way. Text people type is untouched.

**Independent Test**: Walk every main screen with the default data in English, Ukrainian and Polish: no emoji. A source scan of `apps/web/src` finds none outside tests.

### Tests for User Story 2

- [X] T013 [P] [US2] Create `apps/web/src/ui/no-emoji.test.ts` (pattern of `ui/no-raw-controls.test.ts`): read every non-test `.ts`, `.tsx` and message `.json` file under `apps/web/src` and fail with the file and line when one contains a character matching `\p{Extended_Pictographic}` (allow-list: symbols that are text, not emoji, which the pattern also matches, such as `©`, `™`, `®`, `↩`, `✔`, `✓`; list each allowed character with a comment and the file that uses it); the check passes after T010 and T011
- [X] T014 [P] [US2] Extend `e2e/ux-categories.spec.ts` (or `e2e/a11y.spec.ts`) with a walk over Overview, Accounts, Transactions, Plan and Settings → Categories in English that asserts no text node in `main` and the sidebar matches `\p{Extended_Pictographic}`, while a name typed with an emoji (create an account named "💰 Savings") is shown as typed

### Implementation for User Story 2

- [X] T015 [US2] Run T013 and fix anything it finds beyond `palette.ts` (the plan expects nothing); if a symbol in the allow-list is needed, list it in the test with the file it is used in (depends on T010, T011, T013)

**Checkpoint**: US2 done with US1: the guard keeps the app emoji-free.

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T016 Run `pnpm --filter @cashfold/web build`, `pnpm check:bundle`, `pnpm check:licenses`, `pnpm check:docs`; confirm the initial JavaScript did not grow beyond the figure recorded in T001, and `git grep -n "iconFor\|ICON_KEYS\|ledger.icon\.\|cat-icon\|form.noIcon" -- apps packages e2e` finds nothing
- [X] T017 Run the full verification (`pnpm typecheck`, `pnpm exec eslint apps packages e2e scripts`, `pnpm vitest run`, `pnpm --filter @cashfold/web test:browser`, the web e2e specs `ux-categories`, `us2-ledger`, `a11y` and `ux-responsive` on Chromium, Firefox and the RTL project) and walk through every scenario in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **US1 (Phase 3)**: after Setup. This is the MVP.
- **US2 (Phase 4)**: after US1 (its guard passes only once the emoji table is gone).
- **Polish (Phase 5)**: after both.

### Within US1

- Tests first (T002 to T006), then core (T007 → T008 → T009), then UI (T010), strings (T011), docs (T012).
- `category.ts` before `records.ts` and `default-categories.ts`, those before the commands, the commands before the screen.

### Parallel Opportunities

- T002, T003, T004, T005, T006 together.
- T012 alongside T010 and T011.
- T013 and T014 together.

## Parallel Example: User Story 1

```text
Task: "Update packages/core/src/ledger/domain/default-categories.test.ts"
Task: "Update category.test.ts and category-commands.test.ts"
Task: "Update ui/ledger/messages.test.ts and catalogue-complete.test.ts"
Task: "Add the e2e cases to e2e/ux-categories.spec.ts"
Task: "Add the backup and export compatibility checks"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1.
2. Phase 3: the category aggregate, the screen and the strings, with their tests.
3. **Stop and validate** with quickstart section 2; ship if ready.

### Incremental Delivery

1. US1 (categories without icons).
2. US2 (the guard and the walk that keep the app emoji-free).
3. Polish and the full verification.

## Notes

- `[P]` tasks are in different files with no unfinished dependency.
- Field 4 of a category record is reserved: never written, never reused, ignored on read. Do not erase stored values and do not change the SQL schema.
- Avoid: touching the `icon` of account groups, accounts or goals; removing the category colors; adding a migration or a new dependency; raising the bundle budget.
