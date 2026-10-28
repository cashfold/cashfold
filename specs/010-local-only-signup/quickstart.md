# Quickstart: Validating Local-Only Sign-Up

Prerequisites: Node 26 (`.nvmrc`), `pnpm install` done. Build without a default relay, so `NEXT_PUBLIC_DEFAULT_SERVER` is empty (the value in `apps/web/.env.example`).

## 1. Automated

```sh
pnpm vitest run packages/core apps/web   # createAccount, registerExisting, checklist, sign-up form, sync indicator, catalogue-complete
pnpm test:e2e us10-local-only            # the new Playwright spec
```

Expected: all pass; the e2e file covers every scenario below.

## 2. By hand (web, then desktop)

| # | Do | Expect (spec) |
|---|---|---|
| 1 | Open `/sign-up/` with no default relay | The "Keep everything on this device for now" box is checked; no address field; no "find me by email" (FR-001, FR-002, FR-005, FR-013) |
| 2 | Complete sign-up and the Secret Key step | You reach Overview with your first Fold; the key screen suggests a backup; the downloaded kit has no Service line or add-device link (FR-003, FR-007a, SC-001) |
| 3 | In the browser's network panel, use the app for a few minutes | No request to any service at any point (FR-004, SC-002) |
| 4 | Look at the header | "Local only", neutral colour, never offline or attention (FR-006) |
| 5 | Go offline and online again | Nothing changes (User Story 2, scenario 3) |
| 6 | Open Folds and sharing | Share and invite are disabled with "Sharing needs a service" and a link to Sync settings (FR-007b) |
| 7 | Open the Overview card and Help | A "Make a backup" step; it ticks after you make a backup in Settings → Data (FR-007a) |
| 8 | Add an account and three transactions, lock, unlock, reload | Still local-only; still no requests (FR-011) |
| 9 | Settings → Sync: enter an address that does not exist, then your password | A specific "cannot be reached" message; still local-only; data intact (FR-010) |
| 10 | Run the relay (`docs/self-hosting.md`), connect with its address | "Local only" becomes the normal sync states; all records present; "find me by email" now offered (FR-008, FR-009, User Story 3) |
| 11 | Sign in on a second browser profile | Every record from step 8 is there (SC-003) |
| 12 | Switch to Українська, then Polski, and repeat 1, 4, 6, 9 | No untranslated key anywhere (SC-005) |
| 13 | Build with `NEXT_PUBLIC_DEFAULT_SERVER` set | Address pre-filled, box unchecked, sign-up as before (FR-012, SC-006); tick the box and get a local-only account |

## 3. Leak and accessibility checks

- The plaintext-leak scan and the axe checks in `e2e/` run over the new screens (constitution quality gates).
- Keyboard only: the new checkbox, the connect form and the disabled sharing notice are reachable and announced.
