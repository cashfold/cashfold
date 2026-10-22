# Quickstart: Validating the UX Redesign

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [routes](contracts/routes.md), [form fields](contracts/form-fields.md), [UI kit](contracts/ui-kit.md), [preferences](contracts/preferences.schema.json) | **Data model**: [data-model.md](data-model.md)

This guide proves the feature end to end. It does not contain implementation code. Commands run from the repository root; prerequisites are those of [spec 001's quickstart](../001-secure-finance-core/quickstart.md) (Node ≥ 22, pnpm, Docker for the stack tests).

## 0. Capture the baseline first (before any UI change)

```sh
pnpm install --frozen-lockfile
pnpm --filter @cashfold/web build
pnpm exec playwright test -c e2e/playwright.config.ts e2e/bench/ui-baseline.spec.ts --project=chromium
```

Expected: `specs/002-ux-redesign-catalyst/baseline.json` is written with, per screen (Overview/Dashboard, Transactions, Add form, Accounts, Settings, Budgets, Goals, Schedules), the number of visible interactive controls on first load at 390×844 and 1280×800, the number of fields in the add form, and the number of primary navigation entries. Commit it. SC-002, SC-003 and SC-005 compare against this file.

## 1. Automated gates (every PR)

```sh
pnpm typecheck && pnpm lint && pnpm test          # includes: logical-layout over ui/kit, tokens contrast, visibleFields, prefs, routes table, no-raw-controls
pnpm --filter @cashfold/web build                  # runs harden-html (SRI + CSP hashes); fails on any style= attribute in prerendered HTML
pnpm check:bundle && pnpm check:licenses           # new budgets, UFL asset exception
pnpm test:e2e                                      # all projects incl. rtl; fails on any CSP/Trusted Types violation
```

Pass criteria: all green; `check:bundle` prints the kit's share and the combined growth over spec 001's final measurement is ≤ 70 KiB gz (R-UX-02).

## 2. Scenario checks (map to user stories)

Each runs as a Playwright journey; the manual rows are in §3.

| # | Story | Steps | Expected |
|---|---|---|---|
| S1 | US1 | Sign up, create an account, open Add from any page, type `12.50`, pick a category, Save. | ≤ 4 interactions after the sheet opens; list shows the entry; sheet shows ≤ 5 fields; "More details" collapsed; amount field focused. |
| S2 | US1 | Expand "More details", add payee and tag, Save, add another. | The second sheet opens with "More details" expanded (remembered); account is the last used. |
| S3 | US1 | Edit an old entry that has a note while the note field is off by default. | The note is visible. |
| S4 | US1 | Foreign-currency amount without a rate. | Rate prompt appears in the same sheet; after entering, save completes with the other values intact. |
| S5 | US2 | Load at 1280 px and at 390 px. | 5 nav entries; current marked; Fold switcher, sync, lock in the shell; skip link first. |
| S6 | US2 | Visit each old address (`/dashboard/`, `/transfers/`, `/budgets/`, `/goals/`, `/schedules/`, `/categories/`, `/data/`, `/devices/`, `/folds/`). | Each lands on its new place with query kept. |
| S7 | US3 | Open Overview with sample data. | Four headline figures in the first screenful; collapse "By tag"; reload; it stays collapsed; change period; reload; it persists. |
| S8 | US3 | Turn on "include transfers" in Options. | Note under the tiles says so; figures change. |
| S9 | US4 | Open Transactions with ≥ 200 entries. | Day headings with net totals; last group marked partial until all loaded; search narrows as typing; Filters panel applies account + date; chips show; remove one chip; reload keeps filters. |
| S10 | US4 | Row menu → Delete → confirm; open Recently deleted → Restore. | Deleted entry gone, then restored. |
| S11 | US5 | Toggle Light/Dark/System; reload with the OS in dark. | No flash of light content (first-paint check); choice persists; forced-colours and reduced-motion emulations show all cues. |
| S12 | US6 | Plan: create a budget, a goal and a weekly schedule. | Each ≤ 3 steps beyond values; cards show progress with text status; last tab remembered. |
| S13 | US7 | Settings. | 7 groups, no form controls on the list; theme change in ≤ 2 steps; Secret Key / Emergency Kit view shows copy/download, "shown once", acknowledgement. |
| S14 | US8 | New account, new Fold. | Checklist shown; dismiss; reload; not shown; reopen from Help. |
| S15 | US9 | Accounts: add, archive (hidden), show archived, delete with consequences text. | As described. |
| S16 | Edge | Lock while the add sheet is open with typed values; unlock. | All overlays closed on lock; during a mere privacy cover the sheet is `inert` and hidden and its values survive. |
| S17 | Edge | Block `localStorage` (private mode emulation). | App works with defaults; no error UI. |
| S18 | Edge | 320 px width, 200 % zoom, RTL (`rtl` project). | No horizontal page scroll; primary actions reachable; layout mirrors. |

## 3. Manual and moderated checks (release gate)

| Check | Method | Pass |
|---|---|---|
| SC-001 timing | 8 users, stopwatch, add a basic expense | median < 10 s; ≤ 4 interactions |
| SC-003 findability | 8 users, five named tasks | ≥ 90 % in ≤ 2 steps |
| SC-004 glanceability | 8 users, "what did you spend this month, did income exceed it?" after 5 s | ≥ 90 % correct |
| SC-009 first run | 8 new users, sign-up to first transaction | ≥ 90 % under 5 min unaided |
| SC-012 satisfaction | 5-point survey | mean ≥ 4; < 10 % "too much on screen" |
| Screen reader pass | NVDA + Firefox, VoiceOver + Safari, TalkBack: the add flow, Overview and Settings | every control named; dialogs announce and trap focus; live regions fire |
| Visual review | Designer review of every route × 2 themes × 3 widths against the component inventory | zero one-off controls |

## 4. Performance check (SC-010)

```sh
pnpm exec playwright test -c e2e/playwright.config.ts e2e/bench --project=chromium
```

Expected: dashboard ready ≤ 2 s and add-transaction update ≤ 200 ms with 50,000 transactions (spec 001 budgets still hold); list scroll and filter at 10,000 loaded rows with p95 input-to-render < 200 ms. If the second misses, enable list windowing (R-UX-14).

## 5. Privacy check

```sh
pnpm exec playwright test -c e2e/playwright.config.ts e2e/leak-scan.self-test.spec.ts e2e/ux-csp.spec.ts
```

Expected: the plaintext-leak scan finds no financial content in `localStorage`; the only key present is `cashfold.ui` and it validates against [preferences.schema.json](contracts/preferences.schema.json); no network request leaves the allowed origins; no font, icon or script is fetched from a third party.
