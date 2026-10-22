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

Before (`baseline.json`, 1280×800): 12 primary navigation entries; 15 fields in the add form; 49 visible controls with the add form open. After: 5 navigation entries (asserted in `ux-shell.spec.ts`); the add sheet shows amount, account, category and date plus the type switch and the collapsed "More details" group (asserted in `ux-add.spec.ts`). The re-run of `e2e/bench/ui-baseline.spec.ts` against the new interface (T115) has not been written, so the 40 % control-count claim is not measured.

## Not done

- T116 screen-reader and keyboard-only passes (NVDA, VoiceOver, TalkBack).
- T117 moderated sessions (SC-001, SC-003, SC-004, SC-009, SC-012).
- T118 walk of every function of spec 001 against the new screens.
- T115 control-count comparison, `e2e/bench/list-10k.spec.ts`, and the 50,000-row dashboard bench on the new route.
