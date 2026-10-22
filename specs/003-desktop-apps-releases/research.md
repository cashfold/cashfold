# Research: Desktop Apps and Automated Releases

Decisions that settle the plan's unknowns. **R-D-n** ids are cited from [plan.md](plan.md) and [contracts/](contracts/). Spec 001 research is cited as **R-n**, spec 002 research as **R-UX-n**. Versions below were read from the npm registry on 2026-10-22 and MUST be re-read when the dependencies are added (exact pins, `pnpm view <pkg> version`).

## What the repository already gives us (and the plan reuses)

| Fact (verified in the repo) | Consequence |
|---|---|
| The web app is a client-only static export in `apps/web/out`, hardened after the build (`harden-html.mjs`: SRI on every script and stylesheet, a CSP `<meta>` per page with hashes of inline scripts, a generated `_headers` file). | The desktop app ships that folder unchanged and reuses its `_headers` as the single source of header values. No second CSP to maintain. |
| The database is encrypted SQLite on OPFS through the **SyncAccessHandle pool VFS, "no COOP/COEP headers needed"** (ADR-0002). | The prompt's concern about COOP/COEP and WASM threads does not apply. The desktop protocol needs no cross-origin isolation, only a secure origin. |
| An **encrypted, passphrase-protected backup already exists** (`BackupPanel.tsx`, `backup.create` / `backup.restore`, `packages/crypto/src/backup`, FR-091 of spec 001). It downloads a `.cashfold-backup` file through an `<a download>`. | Clarification 2 (always-encrypted backup) is met by the web feature. The desktop adds no export code, it only has to show a save dialog for the download. The "file export" method in the earlier adapter sketch is dropped (Constitution IX). |
| `.github/workflows/release.yml` already runs on a `v*` tag: external-review gate, the same checks as CI, **two-build reproducible verification**, tarball, SBOM (cdxgen), build-provenance attestation, `gh release create`. | The desktop release extends this workflow. It does not add a parallel one that could publish a second, conflicting release for the same tag. |
| `docs/security-review/status.md` is **"pending"**, and `check-review-gate.mjs` refuses to release until it is complete. | No release of any kind, desktop included, can publish until the external review is complete. The review scope must include the desktop shell (see R-D-14). Phases 1-5 are unaffected, they publish nothing. |
| `main` requires `verify`, two approvals, linear history, squash merge, admins included (`docs/repo-settings.md`). | The release proposal PR must run `verify` and get two approvals, which makes the approval gate (Clarification 1) strict. See R-D-07 for the token problem this causes. |
| ESLint `boundaries` has element types for `web`, `server`, `core`, `crypto`, `protocol`. | `desktop` and a new leaf package `platform` are added as element types. See R-D-03. |
| Service worker registered by `apps/web/src/sw/register.ts` only checks `'serviceWorker' in navigator`. | It needs a desktop switch, see R-D-06. |
| `UPDATE_READY_EVENT` is dispatched but **nothing in the UI consumes it**. | There is no existing update UI to reuse. A new About-and-updates section is built. |
| Quick unlock uses WebAuthn PRF (`quick-unlock-store.ts`). | Possible parity gap under Electron, see R-D-12. |
| The repository is AGPL-3.0. | Distributing binaries means offering the corresponding source. See R-D-15. |

## R-D-01 Shell: Electron

- **Decision**: Electron (current stable major at planning time: 45.0.0). One exact pin, upgraded by Renovate/Dependabot. `electron-builder` 26.15.3 for packaging, `electron-updater` 6.8.9 for updates.
- **Rationale**: Identical Chromium on all three operating systems means the encrypted-SQLite/OPFS/WASM/WebAuthn stack that CI already tests in Chromium behaves the same in the shell. No Rust toolchain, one language (TypeScript) across the repo, Playwright drives Electron natively.
- **Alternatives considered**: Tauri 2 (named in the constitution): smaller, but each OS webview differs, and WebKitGTK on Linux is the likeliest to differ on OPFS access handles and WebAuthn. Rejected for risk, not for merit. PWA only: keeps the browser's storage-eviction problem the spec exists to remove (User Story 2).
- **Constitution impact**: Technology Constraints and Phasing name Tauri 2. Amend (MINOR, v1.1.0) in the same PR as ADR-0009. See Complexity Tracking.

## R-D-02 Serving the web build: privileged custom scheme

- **Decision**: Register `app://cashfold` as a privileged scheme (`standard`, `secure`, `supportFetchAPI`) and answer it with `protocol.handle`, reading files from the packaged copy of `apps/web/out`. Map `/path/` to `/path/index.html` (the export uses `trailingSlash`). Unknown paths return the export's `404.html`.
- **Rationale**: `file://` has an opaque origin, which breaks OPFS, WebAuthn and the CSP's `'self'`. A secure standard scheme gives a stable origin, so the data directory and storage keys are stable across updates.
- **Headers**: parse the `/*` block of `out/_headers` at startup and apply it in `session.webRequest.onHeadersReceived`. Remove `Strict-Transport-Security` (not meaningful here). A test fails if the parsed set is empty, so a changed `_headers` format cannot silently drop the CSP.
- **`connect-src`**: stays `'self' https: wss:` (the person chooses their service address at sign-up, `harden-html.mjs`). Unchanged.
- **Alternatives considered**: a loopback HTTP server (opens a local port, other local processes can reach it, rejected); `file://` (above).

## R-D-03 One new leaf package, `packages/platform`

- **Decision**: A tiny `@cashfold/platform` package holds the **types and zod schemas of the bridge** (channel names, request/response shapes). `apps/web` and `apps/desktop` both depend on it. `apps/desktop` never imports `apps/web`, `apps/web` never imports `apps/desktop`. Boundaries: `platform` is a leaf (imports nothing in the workspace), `web` and `desktop` may import it.
- **Rationale**: Without it the contract is duplicated and drifts, or one app imports the other (forbidden by the plan's own rule). It is also where IPC validation lives, so main and preload validate with the same schemas the renderer was typed against.
- **Alternative rejected**: put the types in `packages/protocol`. Protocol is the wire format between client and relay and "imports nothing"; mixing in a local IPC contract would blur its meaning and trigger the ADR rule for protocol changes.
- **Constitution IX**: justified in Complexity Tracking.

## R-D-04 The bridge is deliberately small (YAGNI)

- **Decision**: The bridge exposes only what the spec requires: about info (version, build id, packaging format, data location, source link), reveal-data-folder, and the update state machine. **Not** included, although the earlier sketch had them: keychain/`safeStorage`, file export. Reason: no spec requirement needs them (backup already works, key handling stays as in the web app, Constitution I and VIII). If quick unlock needs them (R-D-12) that is a later, separate feature.
- **Detection**: The renderer reads `window.cashfoldDesktop`. Absent means the web build, and every desktop-only UI is simply not rendered. The web build's behaviour does not change (FR-002, FR-005).

## R-D-05 Data location and persistence

- **Decision**: Fix the app name (`app.setName('Cashfold')`) and use Electron's default `userData` directory, the OS's standard per-user application-data folder: `%APPDATA%\Cashfold`, `~/Library/Application Support/Cashfold`, `~/.config/Cashfold` (honours `XDG_CONFIG_HOME`). Chromium keeps OPFS, IndexedDB and `localStorage` there. Not user-configurable (Clarification 5).
- **Display and open**: the About section shows the path and a button that calls `shell.openPath`. The path is read in main, never taken from the renderer.
- **Persistence**: grant the `persistent-storage` permission and call the existing persistence request on first unlock. Verify in the Phase 1 spike that `navigator.storage.persisted()` is true and quota is not the browser default.
- **Survives**: browser-data clearing (separate profile), restarts, reinstall (Phase 3 test).
- **Changing the app name or `appId` after release moves the directory.** Both are frozen by a unit test.

## R-D-06 Service worker and offline

- **Decision**: Do not register the service worker in the desktop build. `registerServiceWorker()` returns early when the bridge is present.
- **Rationale**: The files are local, so there is nothing to cache. A second update mechanism (the worker) next to the updater would fight it and could pin stale files.
- **Test**: the existing offline-reload e2e has a desktop equivalent that starts with the network off.

## R-D-07 Release proposal: release-please with an App token

- **Decision**: `googleapis/release-please-action` in manifest mode, one package at the repository root (`release-type: node`), tag format `vX.Y.Z` (`include-component-in-tag: false`), `draft: true` and `force-tag-creation: true`.
- **Why these options**: the proposal PR *is* the approval gate (Clarification 1). `draft` keeps the release invisible until every platform has built (FR-022). `force-tag-creation` is needed because GitHub does not create the tag of a draft release until it is published, and the existing `release.yml` triggers on the tag.
- **Token**: commits, PRs and tags created with the default `GITHUB_TOKEN` do not trigger other workflows. The proposal PR would never run the required `verify` check and could never merge, and the tag would never start `release.yml`. Use a **GitHub App installation token** (preferred over a PAT: scoped, not tied to a person, short-lived). Secrets `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` live in a separate `release-proposal` environment with no required reviewers (a reviewer-gated environment would stall every push to `main` just to update the proposal).
- **What counts as a release (FR-021)**: `exclude-paths` lists `apps/server`, `docs`, `specs`, `e2e`, `tests`, `deploy`, `.github`, `scripts` (except scripts the build reads, handled by a unit test that lists them), `.specify`, `.githooks`. Commit types `docs`, `chore`, `test`, `ci`, `build`, `style` do not bump. A `fix(server)` therefore does not release; a `fix(web)` does.
- **Versioning**: manifest seeded at `0.0.0`; `bump-minor-pre-major: false` and `bump-patch-for-minor-pre-major: false` give literal semver (`feat` minor, `fix` patch, breaking major) from the first release, as SC-005 requires. The first `feat` produces 0.1.0.
- **Idempotence (FR-023)**: release-please never re-creates an existing tag; `release.yml` uses `concurrency: release-${{ github.ref }}` with `cancel-in-progress: false` and exits successfully if the release is already published.
- **Friction to accept**: the repo-wide two-approval rule applies to the proposal PR. `docs/repo-settings.md` already notes it can be relaxed for non-sensitive paths. Not changed by this feature.
- **Alternative considered**: semantic-release (fully automatic, no PR). Rejected by Clarification 1.
- **Closing the manual-tag bypass (FR-020)**: `release.yml` triggers on any `v*` tag, so a maintainer pushing a tag by hand would publish without approving a proposal. A repository tag ruleset allows creation of `v*` tags only to the release App (and forbids deleting or moving them). Verified by trying to push a tag as a maintainer in the scratch repository.

## R-D-08 Version: one source of truth

- **Decision**: The root `package.json` `version` (updated by release-please) is the only version. `apps/desktop/package.json` stays `0.0.0` and is never edited. The build script reads the root version and passes it to electron-builder as `extraMetadata.version`, so installer names, `app.getVersion()`, the update feed and the About screen all derive from it. A test asserts that the packaged app's version equals the tag (FR-026, SC-011).
- **Alternative rejected**: `extra-files` to bump a second `package.json` (two writers, one more thing to forget).

## R-D-09 Build and packaging

- **Decision**: electron-builder with all targets built **without publishing** (`--publish never`), artifacts named `Cashfold-<version>-<os>-<arch>.<ext>` (no spaces: GitHub rewrites spaces in asset names, which would break the feed).
- **Targets**: Windows x64 NSIS; macOS arm64 and x64 as `dmg` plus `zip` (the zip is what the updater consumes); Linux x64 AppImage, deb and rpm.
- **Runners**: `windows-latest`, `macos-latest` (arm64; the x64 build is cross-built on it and smoke-tested under Rosetta), `ubuntu-latest`. Re-check runner images when the workflow is written.
- **Fuses** (`@electron/fuses`): `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on, `EnableEmbeddedAsarIntegrityValidation` on, `GrantFileProtocolExtraPrivileges` off. A packaged-app test reads the fuse state.
- **Web payload**: the build script copies `apps/web/out` verbatim into the package and checks that its tree digest equals the digest `build-verify.mjs` prints, so the desktop ships the exact reproducible export.
- **Uninstall (FR-008)**: NSIS `deleteAppDataOnUninstall: false` (default kept) plus a custom `installer.nsh` page/checkbox "Also delete my data", unchecked by default, with a warning. macOS has no uninstaller: dragging the app to the bin leaves the data, and About documents the folder to delete. deb/rpm/AppImage never touch `~/.config`; About documents the folder.

## R-D-10 Updates: consent-based, two modes

- **Decision**: `electron-updater` with the GitHub provider, `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowDowngrade = false`, `allowPrerelease = false`. The renderer shows "Version X is available" (check runs at launch and every 6 hours, never blocking, errors swallowed to a state). Download starts only on the user's click, install only on a second click ("Restart and update"). (Clarification 3, FR-014.)
- **Mode, decided at runtime**:
  - `in-app`: NSIS, AppImage, and macOS **only when the app is signed**.
  - `manual`: deb, rpm, and unsigned macOS. The prompt shows the version and a button that opens the release page, with the per-format instructions (FR-015).
- **Why macOS is conditional**: Squirrel.Mac refuses to update an unsigned app, so unsigned interim builds cannot self-update on macOS. The plan therefore ships the update *code* in Phase 5 but proves macOS in-app updating only after Phase 6 signing.
- **Verification (FR-016), per layer**: (1) integrity: electron-updater checks the SHA-512 listed in `latest*.yml`. That proves the download matches the feed, **not** that the project published it, because whoever controls the release controls both. (2) Operating-system signature: Windows (Authenticode publisher check) and signed macOS builds; none for AppImage or unsigned builds. (3) **Project update signature, on every in-app format**: the publish job signs, with an Ed25519 key kept only in the protected `release` environment and offline, the message `cashfold-update-v1\n<asset name>\n<sha512 base64>`; the signature is uploaded as `<asset name>.sig`. After download and before reporting `ready`, the main process fetches the `.sig` from the same release, checks it with WebCrypto (`crypto.subtle.verify`, Ed25519; raw public keys imported with `importKey('raw', …)`) against `UPDATE_PUBLIC_KEYS` (one or two keys built into the app, so a key can rotate), and on any mismatch deletes the download and reports `error(verify-failed)`. (4) Downloads are accepted only from the pinned repository's release URL over HTTPS. Layer 3 is what makes "genuinely published by the project" true on Linux and unsigned builds.
- **Safe moment (FR-017)**: install is only started by the user's click, after the renderer finishes in-flight commands. SQLite commits are atomic (`journal_mode=DELETE`, ADR-0002), so an interrupted write is rolled back on next open. Task: confirm a core-worker "quiesce" call exists, add it if not.
- **Automatic checks and privacy**: the periodic check sends the app version and the user's IP address to GitHub (no account data). A setting *Automatically check for updates* (default on) stored in the device-local desktop state switches the launch and 6-hourly checks off; a manual *Check for updates* always works. `docs/privacy.md` describes this.
- **Test feed override**: tests need a local feed. The override (`CASHFOLD_TEST_FEED`) is compiled in **only** by the manual unsigned-test build and is absent from release builds, which a release test asserts (otherwise it would be an update-hijack switch).
- **Failure (User Story 3, scenario 5)**: electron-updater downloads to a temp file and swaps on restart, so the installed version keeps running.

## R-D-11 Main-process security

Context isolation on, node integration off, sandbox on, `webSecurity` on, no `remote`, no `<webview>` (`will-attach-webview` denied). `will-navigate` and `setWindowOpenHandler` deny everything except `https://` links on an allowlist (project docs, the release page, the source repository), opened with `shell.openExternal` after URL parsing. Permission handler: allow only `persistent-storage` and `publickey-credentials-get` (when R-D-12 needs it) for the app origin, deny the rest. A `will-download` handler allows only downloads that the app's own page made (`blob:` URLs of the app origin: the Emergency Kit, backups, CSV exports, attachments) and always shows the native save dialog, so nothing is written unless the user chooses where; the suggested name is reduced to a plain file name. (An earlier draft allowed only `.cashfold-backup` and `.csv`; that would have broken the Emergency Kit and attachment downloads, which the web app offers.) IPC: `ipcMain.handle` only, `senderFrame.url` must be the app origin, input and output validated with the schemas from `@cashfold/platform`. No logs may contain data paths beyond the About display or any secret (Constitution VIII); structured logging with redaction as in the web app.

## R-D-12 Parity risk: quick unlock (WebAuthn PRF)

- **Risk**: Electron's WebAuthn platform-authenticator support differs by OS (Windows Hello, Touch ID need extra setup or may be absent), so the PRF-based quick unlock may be unavailable in the shell. FR-002 asks for the same features.
- **Decision**: Test it in the Phase 1 spike on all three OSes. The web code already feature-detects, so an unavailable authenticator hides the option instead of failing. If it is unavailable on an OS, record it in the release notes and `docs/desktop.md` as a known difference, and open a separate feature. Replacing it with OS-keychain-wrapped keys is **not** done here (it changes the key-handling story and needs its own ADR and review).

## R-D-13 Linux specifics

AppImage is the portable, self-updating format; deb and rpm are the distro packages. Ubuntu 23.10+ restricts unprivileged user namespaces, which can stop Chromium's sandbox from starting in an AppImage. The smoke test therefore runs on the latest Ubuntu runner, the sandbox stays **on**, and `docs/desktop.md` documents the system setting (an AppArmor profile or `kernel.apparmor_restrict_unprivileged_userns`) instead of shipping `--no-sandbox`. The deb installs the SUID `chrome-sandbox` helper through electron-builder's defaults. If the default fails the smoke test, that is a Phase 1 go/no-go finding.

## R-D-14 Signing and trust (Phase 6)

- **macOS**: Developer ID Application certificate, hardened runtime, notarization with `notarytool` using an App Store Connect API key, entitlements limited to what Chromium needs (`allow-jit`, `allow-unsigned-executable-memory` for V8, and nothing for network client beyond the default). Needs an Apple Developer Program membership ($99 a year, **owned by the project owner**).
- **Windows**: three routes, in order of preference to evaluate: (a) SignPath Foundation's free signing for open-source projects, (b) Azure Trusted Signing, (c) an OV/EV certificate in a cloud HSM (hardware-token requirement makes a plain file certificate unavailable for new purchases). Availability and eligibility **must be verified** before Phase 6 starts, they depend on the owner's country and entity. Until then, unsigned builds are labelled `-unsigned` in the release name and notes (User Story 5, scenario 2).
- **Notarization time**: notarization is the least predictable step against the 45-minute target (SC-003). It is measured, and the mitigation is to build the two mac architectures as concurrent jobs.
- **Where the secrets live**: signing and update-signing secrets in the protected `release` environment (required reviewers, deployments limited to `v*` tags). Only the signing jobs (selected by `inputs.sign`) and the `publish` job reference it; dispatch and pull-request runs never do. Signing steps run with `set +x`-safe wrappers, no secret is passed on a command line, and the log-masking check from FR-029 is tested by a canary secret in the manual workflow.
- **Update-signing key** (Ed25519, separate from OS code-signing): generated offline by the owner, the private key stored as `UPDATE_SIGNING_KEY` in the `release` environment and in an offline backup; the public key(s) are committed in `identity.ts`. Rotation: ship a release that trusts both the old and the new key, then retire the old one one release later. Test builds use a throwaway key pair accepted only when the test-feed flag is compiled in.
- **External review gate**: the scope in `docs/security-review/README.md` is extended with the desktop shell (main, preload, protocol handler, updater, installer scripts) before the first release, per the Constitution's Workflow section.

## R-D-15 Licensing and source offer

Electron (MIT) and Chromium (BSD-style and many others) are redistributable with the AGPL project. electron-builder writes `LICENSE.electron.txt` and `LICENSES.chromium.html` into every package. `gen-third-party-notices.mjs` gets a "Components bundled as binaries" row for Electron and Chromium (electron is a dev dependency, so the production-tree scan misses it). `electron-updater` is a production dependency and is picked up automatically. The About section links to the license and to the exact source tag of the running version, which satisfies the corresponding-source obligation for distributed binaries.

## R-D-16 Quality gates for the new code

| Gate | How the desktop is covered |
|---|---|
| typecheck, lint, boundaries | `apps/desktop` and `packages/platform` are workspace packages: the existing `pnpm typecheck` and `pnpm lint` run on them. Boundaries rules added. |
| Unit tests, coverage | Vitest for the header parser, path mapping (traversal), IPC validators, update-mode decision, desktop-state sanitising. Bridge/validation code is held to the 85 % application-layer floor. |
| `check:bundle` | Unchanged web budgets. The bridge adapter in the web is a few hundred bytes, measured by the existing gate. |
| `check:licenses`, notices | Extended as in R-D-15. |
| Plaintext-leak scan | The Playwright leak scan is run against the Electron `userData` directory after a session (the same scan the web e2e runs on OPFS). |
| Playwright e2e | Desktop smoke covers P1 and P2 stories: launch, create and persist, offline start, backup round trip, update check, update apply. |
| axe | Reuses the web app's checks; the About section is added to the a11y spec. |
| Reproducibility | The embedded web payload digest equals the verified export digest. Installers are not byte-reproducible (signing, timestamps), so they get provenance attestations and checksums instead (FR-027). |
| Supply chain | Exact pins, frozen lockfile, `pnpm audit`, SBOM, attestation, pinned action SHAs. |
