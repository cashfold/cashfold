# Quickstart: validating desktop apps and releases

Runnable checks that prove the feature end to end. Shapes are in [contracts/](contracts/), decisions in [research.md](research.md). Commands use the final package name `@cashfold/desktop`; scripts are created during implementation.

## Prerequisites

- Node from `.nvmrc`, pnpm from `packageManager`, `pnpm install --frozen-lockfile`.
- For packaging checks: the build host's own OS (cross-building is not supported for signing). Linux packaging needs `rpm` and `fakeroot` on the PATH.
- For release checks: a **fork or a scratch repository** with the workflows copied, a GitHub App installed on it, and the two environments `release-proposal` (no reviewers) and `release` (reviewers) (never test against the real repository's `main`).

## 1. Run the desktop app from source (Phase 1)

```bash
pnpm --filter @cashfold/web build            # produces apps/web/out
pnpm --filter @cashfold/desktop dev          # opens the app on app://cashfold from the fresh export
CASHFOLD_DEV_URL=http://localhost:3000 pnpm --filter @cashfold/desktop dev   # against `next dev`; ignored when packaged
```

Expect: a window with the Cashfold sign-in screen. DevTools shows origin `app://cashfold`, the CSP from `out/_headers` on the document response, no console CSP violations.

## 2. Go/no-go checks for the shell (Phase 1, all three OSes)

Run on a Windows, a macOS and a Linux machine (or CI runners):

```bash
pnpm --filter @cashfold/desktop test:packaged     # builds an unpacked app and drives it with Playwright's Electron support
```

Must pass on each OS. Also record the runtime's published OS floor and update the spec assumption if it differs from Windows 10+ / macOS 12+:

1. Encrypted database opens on OPFS in the packaged app; a transaction created, then the app restarted: still there (User Story 1, 2).
2. `navigator.storage.persisted()` is `true` after first unlock (R-D-05).
3. Argon2id and SRP WebAssembly modules load; sign-up and sign-in against a local relay (`docker compose -f deploy/compose.dev.yml up`) succeed.
4. Offline start (network blocked) reaches the unlocked app and adds a transaction (FR-003).
5. Quick unlock: record whether the option is offered and works; the result goes in `docs/desktop.md` (R-D-12).
6. The Chromium sandbox is on (`process.sandboxed === true` in the renderer) on the latest Ubuntu image (R-D-13).
7. Fuse state matches R-D-09; navigation to `https://example.com` and `window.open` are denied.
8. Plaintext-leak scan over the `userData` directory finds no plaintext (Constitution Quality Gates).
9. Cross-device: an account created on the web app signs in on the desktop app and its data appears after sync; a transaction added on the desktop appears on the web, and the reverse (FR-002, US1 scenario 3).
10. Starting a second instance focuses the first window and exits (FR-012).

If 1-4 fail on any OS, stop: this is the go/no-go for Electron (phasing, Phase 1).

## 3. Version and About (Phase 2)

```bash
node scripts/desktop-build.mjs --version 9.9.9-test     # local build with a fake version
```

Open Settings → About: version `9.9.9-test`, build id, data path, "Show in folder" opens the folder, the source link points at the tag. The same Settings section in the plain web build shows only the web version (contract B-1).

## 4. Backup round trip (Phase 2, User Story 2)

1. Create data in Fold A. Settings → Data → create backup with a passphrase: the native save dialog appears; save `A.cashfold-backup`.
2. Confirm the file contains no readable names or amounts (`strings A.cashfold-backup | head`).
3. Uninstall the app choosing "also delete my data" (Windows installer) or delete the data folder shown in About. Reinstall, sign in, restore the backup with the passphrase into a new Fold: records match.
4. Uninstall **without** the delete option, reinstall: data present (FR-007, FR-008).

## 5. Release proposal rules (Phase 4, scratch repository)

Merge, in order, squash commits with these titles, and after each look at the proposal PR:

| Merge | Expected proposal |
|---|---|
| `fix(web): correct rounding hint` | `0.0.1` |
| `feat(web): add a thing` | `0.1.0` (supersedes) |
| `docs: improve guide` | unchanged |
| `fix(server): relay log wording` | unchanged (excluded path) |
| `chore(deps): bump x` | unchanged |
| `feat(web)!: change export format` | `1.0.0` |
| `test: add a case` | unchanged |
| `ci: tweak a workflow` | unchanged |
| `docs(specs): note` | unchanged |

The non-releasing rows (at least five: docs, server fix, chore, test, ci) satisfy SC-004. Also try to push a tag `v0.0.0-test` by hand as a maintainer: the tag ruleset must reject it (P-11).

Then merge the proposal. Expect: tag `v1.0.0`, a **draft** release, `release.yml` running. Re-run the workflow: no second release.

## 6. All-or-nothing (Phase 4)

In the scratch repository add a failing test to the Windows job only, merge a proposal. Expect: gates and Linux/macOS jobs finish, `publish` is skipped, the release stays a draft with no public assets, an issue `Release vX.Y.Z failed` names the Windows job.

## 7. Unsigned build pipeline (Phase 3)

```bash
gh workflow run desktop-build.yml --ref <branch>     # dispatch, sign=false
```

Expect: three artifact bundles; installers named `Cashfold-<version>-…`, no release created. On a clean machine of each OS, install and reach a signed-in app in under 5 minutes (SC-001). The OS shows its untrusted-developer warning; the release notes (or the artifact README) explain the first launch.

## 8. Updates (Phase 5)

Local feed, no release needed (the test builds are signed with a throwaway update key that only test builds trust):

```bash
pnpm --filter @cashfold/desktop test:update       # builds versions N and N+1 with the test feed enabled, serves latest*.yml on localhost
```

Install the oldest of **four** builds (N-3) and update step by step through N-2, N-1 to N, checking after each step that the data created in N-3 is still present (SC-002). Expect, per OS in `in-app` mode: N shows "Version N+1 is available", nothing downloads until *Download* is clicked, *Restart and update* relaunches on N+1, and the data created in N is present (SC-002, SC-006). On deb/rpm (and unsigned macOS) the prompt shows *Open release page* and no download starts (contract B-2). Pull the network: *Check* ends in `error(offline)` without freezing the UI (B-4). Corrupt the downloaded file's checksum in the feed, then separately remove or alter the `.sig`, then sign with an unknown key: each time the update is refused, the download is deleted and N keeps running (FR-016, B-9). Interrupt a download (kill the feed server mid-transfer) and, separately, make the data folder read-only or fill the disk: the app reports the problem, keeps running, and the data is unchanged. Switch *Automatically check for updates* off and confirm no request reaches the feed at launch (B-8). Record the time from accepting the update to the relaunched app (under 5 minutes, SC-006).

A real-release update test runs once the first two signed releases exist: install release N-1 from GitHub, publish N, update in place.

## 9. Signing (Phase 6)

On the signed build of each platform, on a clean machine: macOS `spctl --assess --type execute -vv Cashfold.app` says *accepted, source=Notarized Developer ID* and `codesign --verify --deep --strict` passes; Windows `Get-AuthenticodeSignature` is `Valid` with the expected publisher, and SmartScreen shows no *unknown publisher* warning (SC-008). Remove one credential in the scratch repository: the job fails visibly and does not publish an unsigned asset as signed (P-8). Search the run logs for the secrets' names and values: none (P-9).

## 10. Final checks before the first public release

- `docs/security-review/status.md` is *complete* and its scope names the desktop shell.
- `pnpm check:licenses`, `node scripts/gen-third-party-notices.mjs --check`, `pnpm audit --audit-level=high`.
- The release's web tree digest equals the digest embedded in the desktop package (`about().buildId` and the digest file in the app resources).
- Elapsed time from tag to published release is recorded and under 45 minutes (P-10).
