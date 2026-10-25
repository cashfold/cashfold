# Quickstart: validating Ukrainian and Polish

Prerequisites: dependencies installed, web app buildable (see the repo README).

## 1. Automated checks

```sh
pnpm --filter @cashfold/web test            # includes the catalogue completeness check and separator/plural tests
pnpm --filter @cashfold/web exec playwright test e2e/language.spec.ts   # run from the repo e2e config
pnpm --filter @cashfold/web exec playwright test e2e/pseudo-walk.spec.ts --project=pseudo   # no hard-coded English on any route
pnpm check:bundle                            # the lazy catalogues must keep the budget
```

The CSV export header test (`csv-export.test.ts`) and the desktop menu and dialog tests run in the same unit job. Expected: all pass. Deleting one key from `uk.json`, or renaming a `{count}` placeholder in `pl.json`, makes the completeness test fail and name the entry.

## 2. Manual walk-through

1. Start the app, set the browser's preferred language to Ukrainian, open `/`. The sign-up screen is Ukrainian. Repeat with Polish.
2. With an English browser, open the language picker on the sign-up screen, choose "Polski": text changes at once, typed input stays.
3. Sign up, open Settings → Appearance → Language, choose "Українська". Reload: still Ukrainian. Set the browser to Polish and reload: still Ukrainian (saved choice wins). Choose "Automatic": it follows the browser again.
4. Add a transaction with the amount `1 234,56` (ordinary space) and with `1234.56`: both are saved as 1 234,56. Enter `90071992547409.93`: stored exactly.
5. Check counts with 1, 2, 5, 12, 22 entries (for example the schedule inbox banner): each uses the right plural form.
6. Resize to 320 px and visit overview, transactions, accounts, plan, settings, devices: nothing clipped, no sideways scroll.
7. Go offline, switch language: it still works.
8. Download the emergency kit: the page is in the chosen language with the matching `lang`.
9. Desktop: change the language in-app; the menu labels follow.

## 3. Release gate

The languages are listed from the first release. The completeness check must be green. Native-speaker review (spec SC-007) follows within one release cycle, starting with the agreed glossary, and its corrections ship as ordinary updates.

See [contracts/](contracts/) for the catalogue, preference and glossary contracts and [data-model.md](data-model.md) for the preference field.
