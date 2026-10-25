# Contract: translation catalogues

Applies to `apps/web/src/ui/i18n/messages/{en,uk,pl}.json`.

1. Flat object, string keys, string values, UTF-8, NFC-normalised. No nesting, no comments.
2. `en.json` (merged with the English error messages) defines the key set. `uk.json` and `pl.json` MUST have exactly that set.
3. Each value is a valid ICU MessageFormat string. A value that does not parse fails the check.
4. For every key, the set of argument names and of rich-text tags equals the English one.
5. Where the English message uses `plural`, the translation MUST use `plural` on the same argument, MUST include `other`, and MUST include every category `Intl.PluralRules(<lang>)` reports as reachable (`one`, `few`, `many` for both `uk` and `pl`).
6. A value equal to its English text fails unless the key is on the allowlist in the test (brand, currency codes, symbols).
7. Product terms follow [glossary.md](glossary.md).
8. User-entered data is never an input to key lookup; keys are static strings.
9. Starter keys: one `starter.fold.personal` and one `starter.category.<key>` for every default category key; the check fails if a default category has no matching `starter.category` key in any language.

Check output on failure: language, key, and the rule number broken.
