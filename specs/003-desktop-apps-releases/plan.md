# Implementation Plan: Desktop Apps and Automated Releases

**Branch**: `003-desktop-apps-releases` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-desktop-apps-releases/spec.md`, with the five clarifications of 2026-10-22 (approval-gated release proposal, always-encrypted backup, consent-based updates, keep-data-by-default uninstall, fixed OS data location). Governing rules: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) (**Constitution I-IX**). Prior art: [spec 001 plan](../001-secure-finance-core/plan.md) (**R-n**), [spec 002 plan](../002-ux-redesign-catalyst/plan.md) (**R-UX-n**). This feature's research is [research.md](research.md) (**R-D-n**).

## Summary

Ship Cashfold as installable desktop apps for Windows (x64), macOS (arm64, x64) and Linux (x64) by wrapping the **unchanged** static export of `apps/web` in an **Electron** shell (`apps/desktop`), and publish them with a gated, fully automated, semver release pipeline on GitHub.

- **Shell**: a hardened Electron main process serves the packaged `apps/web/out` on a privileged `app://cashfold` origin, applies the CSP headers the web build already generates (`out/_headers`), and exposes one small, validated bridge: version and build info, the data location, and the update state machine (R-D-02, R-D-11).
- **No domain change**: `packages/core`, `packages/crypto`, `packages/protocol`, `apps/server`, the Core Worker, the event log, the database and the backup feature are untouched (FR-002, FR-005). The existing encrypted `.cashfold-backup` already satisfies the backup requirement, so the shell only adds a native save dialog (R-D-04).
- **Contract package**: one new leaf package, `packages/platform`, holds the bridge types and zod schemas so `apps/web` and `apps/desktop` never import each other (R-D-03).
- **Updates**: `electron-updater` against the GitHub release, consent-based (check, then *Download*, then *Restart and update*), with a `manual` mode for deb, rpm and unsigned macOS. Every in-app update must also carry a detached Ed25519 signature that the app checks against public keys built into it, so authenticity does not depend on the operating system (R-D-10). An *automatically check for updates* setting (default on) lets users switch the periodic check off.
- **Releases**: release-please keeps an automatic **release proposal** PR; merging it is the approval, creates the tag and a draft release; the existing `release.yml` is extended with a desktop matrix and a single `publish` job that makes the draft public only if every platform succeeded (R-D-07, [contracts/release-pipeline.md](contracts/release-pipeline.md)).
- **Trust**: unsigned interim builds clearly labelled; signing and notarization last, behind a protected `release` environment (R-D-14).

## Technical Context

**Language/Version**: TypeScript strict as in `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ES modules, Node from `.nvmrc`. Electron main/preload bundled with the repo's existing `esbuild`.

**Primary Dependencies** (new, all exact-pinned; versions read 2026-10-22 and re-read when added):
- `electron` 45.0.0 (MIT), devDependency of `apps/desktop`.
- `electron-builder` 26.15.3 (MIT), devDependency. `@electron/fuses` (MIT), devDependency.
- `electron-updater` 6.8.9 (MIT), production dependency of `apps/desktop`.
- `release-please` via `googleapis/release-please-action` (workflow only, pinned by SHA); `actions/create-github-app-token` (workflow only).
- Ed25519 update-signature signing and verification use **WebCrypto** (`globalThis.crypto.subtle`, built into Node and Electron) in the main process and in the signing script: no new dependency, no new primitive, and nothing imported from `packages/crypto` (see Complexity Tracking and ADR-0010).
- Existing, reused: `zod` (already pinned in `apps/web`), `esbuild`, `@playwright/test` (has Electron support), `@cyclonedx/cdxgen`, `vitest`.
- **Not adopted**: `electron-store` and similar (the desktop-state file is ten lines), `safeStorage`/keychain, any analytics or crash-reporting service (Constitution VIII).

**Storage**: No new domain storage. The encrypted SQLite on OPFS, IndexedDB key store and `localStorage` live in Electron's `userData` directory (R-D-05). One small device-local `desktop-state.json` ([data-model.md](data-model.md)).

**Testing**: Vitest (unit, test-first for the header parser, path mapping, IPC validators, update-mode decision, desktop-state sanitising, version/`appId` freezes). Playwright with its Electron driver on the packaged app, on all three OSes. Release-pipeline behaviour is proven in a scratch repository ([quickstart.md](quickstart.md) 5-6). Existing suites, the leak scan, bundle and licence gates continue to run unchanged.

**Target Platform**: Windows 10+ x64, macOS 12+ (arm64, x64), a current mainstream Linux x64 (Ubuntu LTS as the reference, AppImage + deb + rpm). Whatever Electron 45 itself supports is the floor; confirm and record in `docs/desktop.md`.

**Project Type**: Desktop application shell around the existing web application, plus CI/CD.

**Performance Goals**: Cold start to the sign-in screen within 3 s on reference hardware; the 50,000-transaction benchmark of spec 001 stays within its budgets inside the shell (same engine, so no regression expected; measured in the Phase 1 spike). Tag-to-published-release under 45 minutes (SC-003).

**Constraints**: Fully offline for every function that works offline on the web (FR-003). No network request other than the user's relay and the GitHub release feed; the feed check is the only new outbound call and is non-blocking. Strict CSP identical to the web build. Chromium sandbox on. No change to web bundle budgets.

**Scale/Scope**: One new app, one new tiny package, one About/updates section in the web UI (about 3 components and i18n keys in every locale), five workflow files, one ADR, one constitution amendment, one threat-model section, docs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Pre-research | Post-design |
|---|---|---|---|
| I | Zero-knowledge | PASS: no data path changes. | PASS: the shell never reads database or backup contents; no keys leave the renderer; the leak scan is extended to `userData`; update traffic carries no user data. |
| II | DDD in `core` | PASS: `core` untouched. | PASS: no domain logic in the shell or bridge. |
| III | Clean/Hexagonal | PASS. | PASS: the bridge is a port-like contract in a leaf package; `desktop` and `web` depend on it, never on each other. Boundary lint rules added (see Project Structure). |
| IV | CQRS | N/A | N/A: no commands or projections added. |
| V | Event sourcing / CRDT | N/A | N/A. The desktop is one more device on the existing sync; no schema change, so no upcaster. |
| VI | Exact money | N/A | N/A: no money values touched. |
| VII | Local-first | PASS: required by FR-003. | PASS: update check is non-blocking and tolerates offline; no local function waits on the network; service worker not needed because files are local (R-D-06). |
| VIII | Security hygiene | PASS with work: CSP/SRI, supply chain. | PASS: same CSP and SRI as the web (served from the same `_headers`); sandbox, isolation, fuses, navigation and permission lockdown (R-D-09, R-D-11); exact pins, frozen lockfile, SBOM, provenance, audit, action SHAs; secrets only in a protected environment (R-D-14). **New attack surface** (main, preload, protocol handler, updater, installer scripts) gets a threat-model section and is added to the external review scope. The update-signature code is cryptography outside `packages/crypto` by design (Complexity Tracking): WebCrypto only, known-answer tests, two reviewers, ADR-0010, threat-model note. |
| IX | Simplicity / YAGNI | PASS if justified. | PASS: the bridge is cut to what the spec needs (no keychain, no file export, R-D-04). Two additions are justified in Complexity Tracking. |

**Technology Constraints**: `core`, `crypto`, `protocol` are not changed (satisfies "desktop shells MUST NOT require changes to core, crypto or protocol"). **Conflict**: the constitution names *Tauri 2* as the planned desktop shell. See Complexity Tracking; the amendment ships first.

**Quality Gates**: Test-first for the new logic. Playwright for each P1 and P2 story on the desktop (quickstart 2-8). Plaintext-leak scan extended to `userData`. Coverage floor 85 % for the bridge/validation layer. CI blocks on type-check, lint (with boundaries), tests, build, audit, licences, bundle budget and accessibility, all unchanged and applied to the new packages.

**Development Workflow**: Conventional Commits and squash merge (the pipeline depends on them). No AI-attribution lines in commits or PRs. ADR-0009 records the shell choice and ADR-0010 (with a section in `docs/ARCHITECTURE.md`, same PR) records the update-signature scheme, as the Constitution requires for any cryptography change. Security-sensitive: the new IPC surface needs two reviewers and a threat-model note, so `apps/desktop/src/main/` and `apps/desktop/src/preload/` and `packages/platform/` are added to CODEOWNERS. External security review must include the desktop shell before the first release (the gate in `release.yml` already blocks until then).

**Gate result**: PASS, with one justified deviation (Technology Constraints text) to be amended before Phase 1 merges.

## Project Structure

### Documentation (this feature)

```text
specs/003-desktop-apps-releases/
├── plan.md                         # This file
├── research.md                     # Phase 0
├── data-model.md                   # Phase 1
├── quickstart.md                   # Phase 1
├── contracts/
│   ├── desktop-bridge.md           # renderer ⇄ main interface, channels, validation, behavioural tests
│   └── release-pipeline.md         # workflows, release-please config, guarantees P-1..P-10, secrets
├── checklists/requirements.md      # from /speckit-specify
└── tasks.md                        # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/platform/                         # NEW leaf package: @cashfold/platform
├── package.json  tsconfig.json  vitest.config.ts
└── src/{index.ts, bridge.ts, channels.ts, schemas.ts, schemas.test.ts}

apps/desktop/                              # NEW: @cashfold/desktop (private, version stays 0.0.0)
├── package.json  tsconfig.json  vitest.config.ts
├── electron-builder.config.mjs            # targets, artifact names, fuses hook, NSIS include, mac entitlements
├── build/                                 # icons, entitlements.mac.plist, installer.nsh (delete-data checkbox)
├── scripts/
│   ├── build.mjs                          # esbuild main+preload; copies apps/web/out; checks tree digest; sets extraMetadata.version from root
│   ├── dev.mjs  test-packaged.mjs  test-update.mjs
├── src/
│   ├── main/
│   │   ├── index.ts                       # lifecycle, single-instance lock, app name/appId (frozen)
│   │   ├── protocol.ts  headers.ts        # app://cashfold handler; _headers parser/applier
│   │   ├── security.ts                    # navigation, window.open, permissions, will-attach-webview, will-download
│   │   ├── ipc.ts                         # handlers, sender check, schema validation
│   │   ├── about.ts  data-location.ts     # AboutInfo, reveal folder
│   │   ├── updater.ts                     # state machine, mode decision, test-feed (compiled out of releases)
│   │   ├── window.ts  desktop-state.ts  menu.ts
│   │   └── *.test.ts
│   └── preload/index.ts  index.test.ts    # exposes `cashfoldDesktop` only
└── e2e/{playwright.config.ts, fixtures.ts, launch.spec.ts, persistence.spec.ts, offline.spec.ts, single-instance.spec.ts, sync-parity.spec.ts, leak-scan.spec.ts, backup.spec.ts, data-location.spec.ts, a11y-about.spec.ts, update.spec.ts, hardening.spec.ts}

apps/web/src/
├── adapters/platform/{index.ts, desktop-bridge.ts, index.test.ts}   # reads window.cashfoldDesktop; web returns undefined
├── ui/settings/AboutSection.tsx  UpdateControls.tsx                  # About + updates
├── ui/shell/UpdateNotice.tsx                                          # dismissible, non-modal
└── sw/register.ts                                                     # skip when the bridge is present

.github/workflows/{release-please.yml, release.yml (changed), desktop-build.yml, desktop-smoke.yml, ci.yml (action pins)}
release-please-config.json  .release-please-manifest.json
scripts/{gen-third-party-notices.mjs (Electron/Chromium rows), check-desktop-config.mjs (appId/name frozen, no test feed in release), check-signing-env.mjs, sign-update-assets.mjs, release-assets.mjs}
eslint.config.js                           # + element types `platform`, `desktop`; rules below
docs/{desktop.md, adr/0009-electron-desktop-shell.md, adr/0010-update-signatures.md, ARCHITECTURE.md (+ Update signatures section), threat-model.md (+ section), privacy.md (+ update check), repo-settings.md (+ tag ruleset)}
README.md  CONTRIBUTING.md  .github/CODEOWNERS
.specify/memory/constitution.md            # amendment 1.1.0 (Tauri 2 → Electron)
```

**Boundary rules added**: `platform` imports nothing in the workspace. `web` may import `platform`, not `desktop`. `desktop` may import `platform`, not `web`, `core`, `crypto` or `server` (the shell must stay unaware of the domain). `core`, `crypto`, `protocol`, `server` may not import `platform` or `desktop`.

**Structure Decision**: Two new workspace members, `apps/desktop` (the shell) and `packages/platform` (the contract), plus workflows and docs. The shell consumes the **built output** of `apps/web` through turbo (`apps/desktop` build `dependsOn` `@cashfold/web#build`), so there is exactly one copy of the app code.

## Phasing

Each phase ends mergeable and, apart from release automation in 4, testable without publishing anything. Phase 0 can run in parallel with Phase 1.

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 0 Prerequisites | ADR-0009; constitution amendment 1.1.0; GitHub App for release-please; two environments (`release-proposal`, `release`); the update-signing key; the `v*` tag ruleset; start the Apple and Windows signing enrolment (long lead time); extend the external-review scope | PRs merged; accounts requested; owners named |
| 1 Spike and scaffold (**go/no-go**) | `apps/desktop` runs the web export on `app://cashfold`; hardening; quickstart section 2 on Windows, macOS, Linux | Checks 1-4 pass on all three OSes. Results (including quick unlock, R-D-12, and the Linux sandbox, R-D-13) written to `docs/desktop.md`. If 1-4 fail, stop and revisit the shell choice |
| 2 Bridge and data | `packages/platform`, bridge, About section, data location, backup save dialog, service-worker switch, window state, menu, single instance, NSIS delete-data option | quickstart 3-4 pass; web build and its e2e unchanged (B-1) |
| 3 Unsigned builds | `desktop-build.yml` matrix, artifact naming, fuses, `desktop-smoke.yml`, notices and licence additions | Unsigned installers install and run on clean machines (SC-001 timing recorded) |
| 4 Releases | `release-please.yml`, config, `release.yml` extension (draft → publish), failure issue, SBOM and provenance for installers, Ed25519 `.sig` files for in-app installers, tag ruleset verified, action SHA pins | quickstart 5-6 pass in a scratch repository: P-1..P-6 |
| 5 Updates | `updater.ts`, update UI, `manual` mode, test feed, update e2e | quickstart 8 passes on Windows and Linux (AppImage); macOS verified after Phase 6 |
| 6 Signing | macOS Developer ID and notarization, Windows signing (route chosen in R-D-14), secrets in `release` | quickstart 9; macOS in-app update proven; unsigned labelling removed |
| Release | External review complete (gate); first two real releases; real-release update test | Constitution external-review gate green |

## Risks and open items

| Risk | Handling |
|---|---|
| WebAuthn PRF quick unlock unavailable on some OS under Electron (parity, FR-002) | Spike in Phase 1; feature-detected so it hides; document as a known difference or open a follow-up feature (R-D-12). |
| Linux sandbox on Ubuntu 23.10+ with restricted user namespaces | Test on the latest Ubuntu runner; keep sandbox on; document the setting (R-D-13). A failing default is a Phase 1 finding. |
| macOS cannot self-update unsigned builds | `manual` mode until Phase 6 (R-D-10). |
| Windows signing route unavailable for the owner | Evaluate SignPath OSS, Azure Trusted Signing, cloud-HSM OV/EV in Phase 0; unsigned interim labelling is the fallback. |
| Release PR needs `verify` and two approvals, and `GITHUB_TOKEN` events do not trigger workflows | GitHub App token (R-D-07). Two-approval friction accepted and revisitable in `docs/repo-settings.md`. |
| The external-review gate is *pending*, so nothing can publish | Expected. Phases 1-5 publish nothing. Review scope extended in Phase 0. |
| A hand-pushed `v*` tag would run `release.yml` and publish without the approval (FR-020) | Repository tag ruleset limiting creation of `v*` tags to the release App (owner task); rejection verified in the scratch repository. |
| Updates on AppImage and unsigned builds have no OS signature, so the feed's SHA-512 alone proves only integrity | Detached Ed25519 signature per in-app installer, verified in the main process against keys built into the app; two keys accepted for rotation; the private key lives only in the `release` environment and offline (R-D-10). Losing it strands existing installs, so it is backed up offline. |
| macOS notarization waits can push tag-to-release past the 45-minute target (SC-003) | Measured in the scratch run and in the first real release (the final end-to-end run). If it overruns, split the mac matrix per architecture so both notarizations run concurrently; if it still overruns, record the measured time and revisit SC-003 through `/speckit-clarify`. |
| The OS floor is assumed (Windows 10+, macOS 12+) until the runtime's published floor is checked | Confirmed in the Phase 1 spike; the spec assumption is updated if it differs. |
| Environment approvals could stall the pipeline (reviewers on every job, or on every push to `main`) | Two environments: `release-proposal` without reviewers for the App secrets, `release` with reviewers limited to `v*` tags for signing and publish; pending deployments are approved together. |
| `appId` or app name change moves user data | Frozen by `check-desktop-config.mjs` (R-D-05). |
| Updater test-feed override reaching a release build | Compiled out; release test asserts it (B-7). |
| Installers not byte-reproducible | Provenance attestation and checksums; the embedded web payload is verified reproducible (R-D-09). |

## Complexity Tracking

| Violation / addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Constitution Technology Constraints and Phasing name *Tauri 2*; this plan uses Electron | OPFS-based encrypted SQLite, WebAuthn and WASM are only tested on Chromium; Electron removes the per-OS webview variable and keeps the toolchain TypeScript-only (R-D-01). Amendment 1.1.0 and ADR-0009 land in Phase 0, before any shell code. | Tauri 2: smaller, but the likeliest to behave differently on Linux for the exact features the app depends on; Phase 1 is a risk we would carry through the whole feature. A PWA alone does not meet the data-safety story. |
| New package `packages/platform` (Constitution IX: extra layer) | Gives `apps/web` and `apps/desktop` one shared, validated contract without importing each other. | Types duplicated in each app drift and the IPC schemas could not be shared; importing `apps/desktop` from `apps/web` (or the reverse) is forbidden by the boundary rules this plan adds. Putting it in `packages/protocol` mixes a local IPC contract into the wire format. |
| Cryptography outside `packages/crypto` (Technology Constraints: `crypto` holds "all cryptography behind narrow interfaces"; shells MUST NOT require changes to `crypto`): the update-signature check and signing script use WebCrypto Ed25519 in `apps/desktop` and `scripts/` | Updates must be verifiable on formats with no OS signature (FR-016). Adding an export to `packages/crypto` would be a change to `crypto` forced by the shell, which the constitution forbids; importing `crypto` into the shell would also break the boundary rule. The code is a few dozen lines of platform WebCrypto (no new primitive, no custom crypto), guarded by RFC 8032 known-answer tests, ADR-0010, an `ARCHITECTURE.md` section, a threat-model note and two reviewers (CODEOWNERS). | Reusing the app's operation-signing primitive from `packages/crypto` (needs a new export, see left); hand-rolled or third-party signing tools (more surface, more dependencies). |
| `apps/desktop` (new app) and Electron dependencies | The feature itself. | N/A |
| Constitution Quality Gates: "Playwright end-to-end tests for each P1 and P2 user story" cannot be met literally for US4 (a maintainer story about CI/CD) | The release behaviour is covered by static workflow tests (`scripts/release-config.test.ts`, `release-workflow.test.ts`, `release-notes.test.ts`, `sign-update-assets.test.ts`) and a recorded scratch-repository run of [quickstart.md](quickstart.md) 5-6 (the recorded scratch-repository validation). US1-US3 and US5's user-visible parts have Playwright coverage. | Playwright cannot drive GitHub Actions; a mocked pipeline would test the mock, not the workflow. |
| Release-please + GitHub App | The approval-gated, automatic, semver proposal (Clarification 1) cannot run with the default token: its PR would never run required checks and its tag would never trigger `release.yml` (R-D-07). | PAT tied to a person (less safe, breaks when they leave); semantic-release (fully automatic, contradicts the clarification). |
