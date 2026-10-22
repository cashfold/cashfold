# Quickstart results (spec 002)

Recorded 2026-10-22 on the integration branch. Automated results only; the manual and moderated parts of `quickstart.md` have **not** been done.

## Automated

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| Unit tests of the web app, lint rules and scripts | 639 pass; `no-raw-controls.test.ts` fails if any screen uses a bare button, select, textarea or input (other than file and hidden) |
| `pnpm lint` | no errors, no warnings; the three kit rules are errors |
| Kit in a real browser, light and dark, axe WCAG 2.2 AA + keyboard (`kit.browser.test.tsx`) | 10 pass |
| End-to-end, Chromium | 102 pass, 2 skipped (re-run after the controls were moved to the kit) |
| End-to-end, `rtl` project (Arabic locale) | 101 pass |
| End-to-end, `pseudo` project (texts 40 % longer) | responsive spec passes |
| End-to-end, Firefox | 82 pass; `multitab` backup reminder and `us7` sharing also fail on the interface before this work (checked on commit b7764ee on the same machine), so they are environmental |
| End-to-end, WebKit | `shell.spec` skip-link focus fails: macOS Safari does not Tab to links by default |
| `pnpm check:bundle` | initial 342.2 KiB, lazy 241.8 KiB gzipped; 63.5 KiB over the first release (limit 70 KiB) |
| `pnpm check:licenses`, `check:no-float`, third-party notices | pass |

## Baseline comparison (SC-002, SC-003, SC-005)

Measured by `e2e/bench/ui-after.spec.ts` (`AFTER=1`, whole page, a fresh account with one account, as `ui-baseline.spec.ts` did) and written to `after.json`.

| Measure | Before | After | Needed | Result |
|---|---|---|---|---|
| Primary navigation entries | 12 | 5 | exactly 5 | met |
| Default add-form fields | 15 | 4 | 5 or fewer | met |
| Add form, visible controls | 49 | 11 | 29 or fewer | met (78 % fewer) |
| Overview, 390×844 / 1280×800 | 25 / 30 | 20 / 27 | 15 / 18 | **not met** |
| Transactions, 390×844 / 1280×800 | 25 / 25 | 13 / 20 | 15 / 15 | met on phone, **not met** wide |
| Settings, 390×844 / 1280×800 | 22 / 22 | 9 / 17 | 13 / 13 | met on phone, **not met** wide |

On a wide screen the sidebar alone is 11 controls (skip link, brand, Add, five entries, sync status, Help, Lock), and a new account also shows the Emergency Kit reminder (4) and, on the Overview, the first-run checklist (2) and the period and chart controls. SC-005 is therefore not met on the first load of a new account at 1280×800 for Overview, Transactions and Settings. The numbers are recorded as measured; T115 stays open until the person owning the spec decides between trimming that chrome (for example one-action reminder, sidebar Help and Lock into one menu) and restating SC-005 as a count of the screen's own content.

## 10,000-row list (SC-010, T077)

`e2e/bench/list-10k.spec.ts` (`BENCH=1`; Chromium, page CPU slowed 4×; the worker runs at this machine's speed). Before windowing, loading the next 100 rows at 2,100 rows loaded took 12.3 s. With day groups rendered only while near the viewport (`useWindowedRows.ts`, with a browser test) and the per-group currency lookup done once:

| Step at 10,000 rows | p95, 4× slowdown | Target |
|---|---|---|
| Show more (next 100 rows on screen) | 295 ms | 200 ms |
| Search (keystroke to narrowed list, less the 200 ms pause by design) | 274 ms | 200 ms |

Further changes after windowing: "Show more" now reads only the next page and appends it; the day group is a module-level component (it was redefined on every render, which remounted every group); the transactions are no longer sorted again when no transfer is merged in. Each cut the figures (586 → 295 ms and about 660 → 274 ms), and they now level off. SC-010 is **not met** at the reference slowdown: the measurement includes a full re-read of the list's other data (needs-attention, transfers, recently deleted) on every search, and the worker's query, which the slowdown does not touch. T077 stays open.

## Not done

- T116 screen-reader and keyboard-only passes (NVDA, VoiceOver, TalkBack).
- T117 moderated sessions (SC-001, SC-003, SC-004, SC-009, SC-012).
- T118 walk of every function of spec 001 against the new screens.
- T115 acceptance of the control-count comparison (see above), and the 50,000-row dashboard bench on the new route.

## Deferred to a later change

Decided with the owner on 2026-10-22: these are left for a follow-up, not done in this change.

- **T115 / SC-005** first-load control counts on wide screens (Overview, Transactions, Settings). Options: a one-action Emergency Kit reminder and Help and Lock in one menu, or restating SC-005 as a count of each screen's own content. Measurements are in `after.json`.
- **T077 / SC-010** the 10,000-row list answers in about 290 ms at the 4× slowdown against 200 ms. Next step: do not re-read needs-attention, transfers and recently deleted on every search or "Show more".
