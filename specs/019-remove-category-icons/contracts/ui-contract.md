# UI Contract: Categories Without Icons

## Categories list (`ui/ledger/CategoriesScreen.tsx`)

| Part | Value |
|------|-------|
| Row | a color swatch (`aria-hidden`), the name, the archived badge when archived, the row actions |
| No | emoji, empty icon element, or a gap where it was |

## Category form

| Field | Value |
|-------|-------|
| Name | text, required |
| Type, Parent | as today |
| Color | the swatch picker as today |
| Icon | **removed**: no label, no select, no "No icon" choice |

Tab order: name, type, parent, color, the form buttons.

## Commands (`packages/core`)

```text
createCategory({ fold, id, direction, parentId, name, color? })   // no icon
updateCategory({ fold, id, name?, color?, parentId?, ... })       // no icon
```

A call that still passes `icon` is a type error. A record patch that carries field 4 from an older device is accepted and ignored.

## Strings removed (EN, UK, PL)

`ledger.icon.*` (16 keys), `ledger.categories.form.icon`, `ledger.categories.form.noIcon`.

## Guarantee

No source file under `apps/web/src` outside tests contains an emoji. Text a person types is shown as typed.
