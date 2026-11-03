# Languages and messages

**Scope:** `apps/web/src/ui/i18n/**`, `apps/web/src/ui/errors/**`, `**/*.json` message files,
`apps/desktop/src/main/menu-labels.ts`, and any changed file that shows text to a person.

Follow `_contract.md`. The guide is `docs/i18n.md`; the rules are in `.claude/rules/i18n.md`.

- **No literal text** in a component, a title, an `aria-label`, a placeholder or an error. Everything
  comes from the catalogue; `e2e/pseudo-walk.spec.ts` fails on English that did not.
- **Three catalogues together.** A new, renamed or removed key appears in `en.json`, `uk.json` and
  `pl.json`. A missing key, an extra key, changed placeholders or a value left identical to English
  (other than names and codes) fails `catalogue-complete.test.ts`.
- **Plurals.** A count has all four forms in Ukrainian and Polish (`one`, `few`, `many`, `other`), plus
  `=0` or `=1` where the wording only fits those. Check that the text reads correctly for 1, 2, 5, 21 and 0.
- **Glossary.** A term follows `specs/004-ukrainian-polish-languages/contracts/glossary.md`; a new term
  is added there. One term has one translation everywhere.
- **Never concatenate** translated fragments; give the message whole, with placeholders.
- **Formatting.** Dates, numbers and amounts use the locale formatters; names sort with
  `sortedByName`.
- **Errors** are `error.*` keys and never include user content or secrets.
- **A new language** touches `LANGUAGE_NAMES`, `SHELL_LANGUAGES`, `menu-labels.ts`, the docs and the
  language specs together.
