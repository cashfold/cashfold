# Data Model: Ukrainian and Polish Languages

No ledger, event or protocol data changes. Everything below is device-local interface state.

## Language (code constant)

| Field | Type | Notes |
|-------|------|-------|
| code | `'en' \| 'uk' \| 'pl'` (user-selectable) | Base language only. `ar` (placeholder) and `en-XA` (tests) exist but are not selectable. |
| autonym | string | "English", "Українська", "Polski"; never translated. |
| direction | `'ltr' \| 'rtl'` | All three are `ltr`. |

## Language preference (interface preferences, `cashfold.ui`)

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `language` | `'auto' \| 'en' \| 'uk' \| 'pl'` | `'auto'` | Any other value falls back to `'auto'` without touching other fields (the existing field-by-field parse). No schema version bump: an older stored object simply lacks the field. |

Rules: never synced, never exported, never placed in the encrypted ledger. Resetting interface settings resets it to `'auto'`.

State: `auto` → resolved from the browser order; `en|uk|pl` → fixed. Changing it takes effect immediately and persists.

## Translation set (one per language)

| Aspect | Rule |
|--------|------|
| Key | Identical to the English key. |
| Value | ICU message string. |
| Parity with English | Same key set; same argument names; same rich-text tags; plural messages cover the categories the language needs (`one`, `few`, `many`, `other`) and always `other`. |
| Fallback | A missing key shows English at runtime; the completeness check makes this a CI failure instead. |

## Glossary entry (documentation, not runtime)

| Field | Notes |
|-------|-------|
| term | English product term (Fold, Account, Transaction, Transfer, Budget/Envelope, Schedule, Goal, Member). |
| uk / pl | The agreed translation, used on every screen. |

## Starter names (supplied by the app at account or Fold creation)

| Item | Rule |
|------|------|
| Personal Fold name | Message `starter.fold.personal`, in the language chosen at creation (FR-015). |
| Category names | Messages `starter.category.<key>`, where `<key>` is the stable English-derived key (`<root.key>` or `<root.key>.<slug(child)>`) from `default-categories.ts`. |
| Passed to `core` as | An optional map key → name. A key missing from the map falls back to the English name. Record ids are derived from the keys and the Fold id, so they never depend on the language. |
| After creation | Ordinary user data: never retranslated, never changed by a language switch. If two devices create the set in different languages, the same records are written and per-field merge keeps one name. |
