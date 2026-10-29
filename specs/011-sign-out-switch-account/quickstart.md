# Quickstart: Validating Sign Out and Switch Account

Prerequisites: Node 26 (`.nvmrc`), `pnpm install` done. Build without a default relay (`NEXT_PUBLIC_DEFAULT_SERVER` empty). For the relay rows, run the relay as in [docs/self-hosting.md](../../docs/self-hosting.md), or use the one the e2e config starts on port 3200.

## 1. Automated

```sh
pnpm vitest run packages/core apps/web   # signOut use case, view models, catalogue-complete
pnpm test:e2e us11-sign-out              # the new Playwright spec
```

On this machine run Playwright with `--workers=3` and one invocation at a time. The real-browser worker scenario runs with the other browser tests: `pnpm --filter @cashfold/web test:browser`.

Expected: all pass; the e2e file covers every row below that is not marked "by hand".

## 2. By hand (web, then desktop)

| # | Do | Expect (spec) |
|---|---|---|
| 1 | Sign up with a relay, add an account and a transaction, open Settings → Profile and security | A "Sign out of this device" section that says it is not Lock and not Delete (FR-001) |
| 2 | Press Sign out | The confirmation says this device's copy is erased, that the account and other devices are not affected, and how to come back; focus is on Cancel (FR-005, US1.2) |
| 3 | Go offline, add a transaction, press Sign out | It says 1 change has not reached the service, and that the service cannot be reached; the button needs the extra tick (FR-006) |
| 4 | Go online, press Sync now, then confirm | You land on the signed-out screen with three ways in (FR-010) |
| 5 | Look for the old account: Settings, the address bar, storage in the browser's tools | No database file, credentials, quick-unlock record or Fold ids; language and theme are still yours (FR-002, FR-004, SC-003) |
| 6 | Sign in to the same account from a second browser | Every record is there, including the one made while offline and synced in step 4 (SC-005) |
| 7 | On the first device, "Sign in on this device" with the Secret Key and password | The account is back as a new device, with its data (US3.4) |
| 8 | Sign out again, then create a new account | It starts empty, with its own Getting started card and kit reminder, and shows no Fold of the old account (US3.2) |
| 9 | Sign up local-only (spec 010), add data, press Sign out | The first sentence says this is the only copy; the button stays disabled until the email is typed (FR-007, US2) |
| 10 | Press Make a backup first, make one, press Back to sign out | The confirmation shows when the backup was made; the typed email is still required (FR-008) |
| 11 | Confirm | Signed out; restoring the backup into a new account brings the data back (US2.5) |
| 12 | Sign in, lock, press Use a different account | Asks for the email, not the password; a wrong address erases nothing; the right one signs out (FR-014, US4) |
| 13 | Open the app in two tabs and sign out in one | The other moves to the signed-out screen without a "device was removed" notice (FR-012) |
| 14 | Start a sign-out, close the tab while it is working (use the browser tools to throttle), reopen | The sign-out finishes before anything is shown; no half-erased account (FR-013) |
| 15 | Stop the relay, sign out of a registered account | It signs out and says the device may still be listed (FR-009) |
| 16 | Repeat 1, 2, 9, 12 in Українська and Polski | No untranslated key anywhere (SC-007) |
| 17 | Repeat the core rows in the desktop app | The same words and the same result (FR-015) |

## 3. Leak and accessibility checks

- The plaintext-leak scan fixture runs after sign-out and expects to find none of the old account's data, keys or email.
- Axe runs on the confirmation, the lock-screen variant and the signed-out screen. Keyboard only: the link, the dialog, the email field and Cancel are reachable and announced.
