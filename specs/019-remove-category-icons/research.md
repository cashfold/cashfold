# Research: Categories Without Icons

What was found in the repository, the decision, and what else was considered.

## R1. Where category icons are drawn and written

**Finding**:
- Drawn: `ui/ledger/CategoriesScreen.tsx` (the row, `iconFor(c.icon)`; the form's `Select` with `ICON_KEYS`, labelled by `ledger.categories.form.icon`, with a `ledger.categories.form.noIcon` choice, each option `{emoji} {ledger.icon.<key>}`).
- Table of emoji: `ui/ledger/palette.ts` (`ICONS`, `ICON_KEYS`, `iconFor`; the colors in the same file stay).
- Written: `createCategory` / `updateCategory` (`packages/core/.../category-commands.ts`) accept `icon` and put it in the record patch (`CATEGORY_FIELD.icon = 4`); the defaults in `default-categories.ts` give each of the 13 roots an icon key, and the seeded children inherit the root's.
- Read: `decodeCategory` (`records.ts`) puts `f.nullableText(CATEGORY_FIELD.icon)` on the `Category` read model.

The emoji appear only in `palette.ts`; nothing else in the app draws one (checked by search of the UI, catalogues and scripts).

## R2. What to do with the stored field

**Finding**: the field is part of the replicated record format (field number 4). A device that has not updated can still write it, and a backup or sync from an older version still contains it. A record that has the field decodes today; a record that lacks it decodes to `null`.

**Decision**: keep `CATEGORY_FIELD.icon = 4` as a reserved number (a comment says never reuse it), stop writing it, and make the decoder ignore it. The read model `Category` drops `icon`, so no screen can show it by accident. No migration, no upcaster, no schema change; the SQL column `category.icon` stays and is left empty.

**Alternatives considered**: erasing the value on every category (rejected: every device would write a patch for every category, and an older device would write the icon back); removing the field number from the table (rejected: a record that carries it would then fail or be misread by the decoder).

## R3. Default categories

**Finding**: `DEFAULT_CATEGORIES` has an `icon` per root, and `seedCategories` copies it onto each seeded category. The names come from the catalogue as `starter.category.*`.

**Decision**: remove `icon` from the table and from the seeded records. Existing accounts keep the icon they were seeded with (ignored). The deterministic ids and names are unchanged, so a seed on two devices still converges.

## R4. Strings

**Finding**: `ledger.icon.*` (16 keys), `ledger.categories.form.icon` and `ledger.categories.form.noIcon` exist in the three catalogues. `catalogue-complete.test.ts` and `ledger/messages.test.ts` list some of the `ledger.icon.*` keys.

**Decision**: delete all 18 keys from the three catalogues and the lists in the two tests.

## R5. Other emoji

**Finding**: no other place in the app draws an emoji. Tests use emoji only as sample text.

**Decision**: add a guard test that fails if a source file under `apps/web/src` (other than tests) contains an emoji, so FR-007 stays true. User-typed text is data and is not scanned.

## R6. Account groups, accounts, goals

**Finding**: they have an `icon` field too, with no screen that sets or shows it.

**Decision**: out of scope (spec). Left as they are.

## R7. Testing approach

- Unit: category commands do not write field 4; an old record with field 4 decodes and the model has no `icon`; the defaults have no icon; a patch that sets field 4 merges without error.
- UI: `CategoriesScreen` markup has no emoji and no Icon control; catalogue completeness still passes.
- E2E: Settings → Categories shows swatch and name only, the add form has no Icon field, creating and editing a category works, in English and Polish.
- Compatibility: a backup/record fixture that carries an icon restores and shows the category without it.
