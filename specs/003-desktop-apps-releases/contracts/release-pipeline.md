# Contract: Release pipeline

What the automation guarantees and the shape of each workflow. Rationale for every choice is in [research.md](../research.md) R-D-07 to R-D-10 and R-D-14. YAML is deliberately not included here (it belongs to the implementation).

## Flow

```text
 merge to main (squash, Conventional Commit title)
        │
        ▼
 release-please.yml ── opens/updates the RELEASE PROPOSAL (PR: version bump + CHANGELOG)   [App token]
        │                nothing public; CI `verify` runs on the PR; two approvals
        ▼  maintainer merges the proposal = the approval (Clarification 1)
 release-please.yml ── creates tag vX.Y.Z + DRAFT GitHub Release (force-tag-creation)     [App token]
        │                tag push triggers release.yml
        ▼
 release.yml
   job gates     external-review gate, typecheck, lint, vitest, licences, no-float, notices, audit
   job web       two-build reproducible export, tarball, tree digest            (existing)
   job desktop   matrix: win-x64 · mac (arm64+x64) · linux-x64   ── build, sign, test, upload as workflow artifacts
   job publish   needs: all above. checksums, SBOM, provenance attestation,
                 upload to the draft, publish the draft.   ◀── the only job with contents: write
```

Any failure before `publish` leaves the release a draft and nothing is public (FR-022). `publish` runs only when every needed job succeeded (`needs` + `if: success()`).

## Workflows

| File | Trigger | Purpose | Permissions |
|---|---|---|---|
| `.github/workflows/release-please.yml` (new) | `push` to `main` | Maintain the proposal PR; on its merge create tag and draft release. | `contents: write`, `pull-requests: write`, via the App token. Environment `release-proposal` (no reviewers). |
| `.github/workflows/release.yml` (changed) | `push` tag `v*` and `workflow_dispatch` on a tag ref (re-run for an existing tag, no inputs) | Everything between the tag and the published release. | Default `contents: read`. `publish` job adds `contents: write`, `id-token: write`, `attestations: write`. |
| `.github/workflows/desktop-build.yml` (new) | `workflow_call` (from `release.yml`) and `workflow_dispatch` | Build the matrix. Input `sign` (bool, default false on dispatch). Dispatch output: unsigned test builds as artifacts, **never a release**. | `contents: read` |
| `.github/workflows/desktop-smoke.yml` (new) | `pull_request` with path filter `apps/desktop/**`, `apps/web/**`, `packages/**`, `.github/workflows/desktop-*.yml` | Packaged-app smoke test on the three OSes. Not a required check at first (path-filtered required checks stall). | `contents: read` |

All third-party actions in new and changed workflows are pinned to full commit SHAs with the tag in a comment. The existing `@v4` references in `ci.yml` and `release.yml` are converted in the same change (supply chain, Constitution VIII).

## release-please configuration (shape)

```jsonc
// release-please-config.json
{
  "packages": {
    ".": {
      "release-type": "node",
      "include-component-in-tag": false,
      "draft": true,
      "force-tag-creation": true,
      "bump-minor-pre-major": false,
      "bump-patch-for-minor-pre-major": false,
      "changelog-sections": [ /* feat, fix, perf, revert visible; docs/chore/test/ci/build/style hidden */ ],
      "exclude-paths": ["apps/server", "docs", "specs", "e2e", "tests", "deploy", ".github", ".specify", ".githooks"]
    }
  }
}
// .release-please-manifest.json  →  { ".": "0.0.0" }
```

`scripts/` is not excluded wholesale because the build and desktop scripts live there or are read by it; a unit test lists the exclusion set and asserts that no excluded path is read by the desktop build.

## Guarantees (each is tested; see quickstart)

| # | Guarantee | Spec |
|---|---|---|
| P-1 | `fix` → patch, `feat` → minor, breaking → major, from the first release. | FR-018, SC-005 |
| P-2 | Docs-only, chore-only, test-only, CI-only and server-only merges change the proposal not at all, and no release is ever created for them. | FR-021, SC-004 |
| P-3 | Nothing is public until all platforms built: a deliberately failing platform leaves a draft and no public asset. | FR-022, SC-009 |
| P-4 | Re-running `release.yml` on the same tag publishes once; no second release, no second version. | FR-023 |
| P-5 | The gates run before any build: a red gate means no matrix job starts. | FR-024 |
| P-6 | The published release has, per platform, the installers; the update feeds `latest.yml`, `latest-mac.yml`, `latest-linux.yml`; `SHA256SUMS`; `sbom.cdx.json`; a provenance attestation covering them. | FR-025, FR-027 |
| P-7 | The version in every artifact name, in the feed, and in the packaged app equals the tag. | FR-026, SC-011 |
| P-8 | The unsigned interim path produces assets named and described as unsigned; the signed path fails (does not downgrade) when a credential is missing or invalid. | FR-028, FR-030 |
| P-9 | A canary secret echoed by a test step is masked, and a search of all job logs for the real credential names finds nothing. | FR-029, SC-010 |
| P-10 | Build time from the tag to a published release is under 45 minutes on the reference runners (measured, recorded in the release summary). | SC-003 |
| P-11 | A `v*` tag created by anyone other than the release App is rejected by the repository ruleset, so no release can start without an approved proposal. | FR-020 |
| P-12 | Every in-app installer has a `<name>.sig` that verifies against the public key(s) built into the app, and tampering with the installer or its name invalidates it. | FR-016 |

## Artifact naming and update feed

- Installers: `Cashfold-<version>-<os>-<arch>.<ext>`, where `<os>` is `win`, `mac` or `linux`, `<arch>` is `x64` or `arm64`. No spaces.
- Update signatures: `<installer name>.sig` for every installer of an `in-app` format (NSIS exe, mac zip, AppImage). Signed message: `cashfold-update-v1\n<asset name>\n<sha512 base64>` (the same sha512 as in the feed), signature base64. Produced by `scripts/sign-update-assets.mjs` in the `publish` job, checked by the app (research R-D-10).
- Feeds (electron-updater, GitHub provider): `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml`. Each lists file names, sizes and SHA-512; file names must match asset names exactly. The feeds are uploaded in the same step as the installers and only become visible when the draft is published, so an updater can never see a half-published release.
- `SHA256SUMS` covers installers and feeds (separate from the existing web `SHA256SUMS`; the combined release carries a single merged file to keep one verification command).

## Secrets and environment

- A repository **tag ruleset** (owner task) restricts creation of tags matching `v*` to the release App and forbids updating or deleting them, closing the manual-tag bypass.
- Two environments. **`release-proposal`** (no required reviewers, deployments limited to `main`) holds `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`, so keeping the proposal up to date never waits for a person. **`release`** (required reviewers, deployments limited to `v*` tags) holds the rest and is the only environment the signing and publish jobs use: `UPDATE_SIGNING_KEY` (Ed25519 private key for update signatures), `APPLE_CERT_P12`, `APPLE_CERT_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, plus the Windows signing credentials of the route chosen in R-D-14.
- `desktop-smoke.yml` references no environment. In `desktop-build.yml` the signing jobs select `environment: ${{ inputs.sign && 'release' || '' }}`: dispatch and pull-request runs use `sign: false`, so they never reach a secret. Environment secrets are not inherited through `workflow_call`, so the called workflow declares the environment itself. The reviewers approve all pending deployments of a run together (*Review deployments*).
- The `publish` job declares `environment: release` (it reads `UPDATE_SIGNING_KEY`). `release.yml` is only ever run on a tag ref (pushed by the App, or a manual re-run dispatched **on the tag itself**, which also satisfies the environment's tag restriction); every job checks out `github.ref` and the `gates` job fails unless `github.ref_type` is `tag`, the name matches `v*`, and `HEAD` is the tagged commit.
- No secret is passed on a command line or written to disk outside the runner temp directory; the temp keychain on macOS is created and deleted within the job.

## Failure notification (FR-022)

When `release.yml` fails, a final `notify` job (`if: failure()`) opens or updates a GitHub issue titled `Release vX.Y.Z failed` that names the failed platform jobs and links the run. It has `issues: write` only.
