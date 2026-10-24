# Repository settings

Applied by a maintainer with `scripts/apply-branch-protection.sh OWNER/REPO` (the script is reviewed here but never run by CI or contributors).

`main` is protected:

- Required status check `verify` (CI job: type-check, lint, tests and coverage floors, build, bundle/licence/float gates, audit, Playwright with blocking axe WCAG 2.2 AA assertions, Testcontainers, SBOM).
- Pull requests only; **two** approving reviews, enforced through CODEOWNERS for `packages/crypto/`, `packages/core/src/sync/` and `packages/core/src/sharing/`. The repo-wide review count is set to two for simplicity; relax to one for non-sensitive paths if this becomes a bottleneck.
- Stale approvals are dismissed on new commits.
- Linear history, squash merge only, no force pushes, no deletions, applies to admins.

## Releases

Releases are made by merging a **release proposal**, never by hand. The pieces, and what a maintainer sets up once (specs/003-desktop-apps-releases, `docs/desktop.md`):

- **The proposal.** `.github/workflows/release-please.yml` keeps one pull request up to date on every push to `main`: the next version (worked out from the Conventional Commit titles that were squash-merged: `fix` raises the patch number, `feat` the minor number, a breaking change the major number) and the changelog. Changes under `apps/server`, `docs`, `specs`, `e2e`, `tests`, `deploy` and `.github` are not counted, so they never make a release by themselves. The proposal is an ordinary pull request: it needs the `verify` check and the same reviews as any change, and **merging it is the approval to release**. It then makes the tag `vX.Y.Z` and a draft release.
- **The GitHub App.** The proposal and the tag are made with a GitHub App token, not the default token (events made with the default token start no other workflows, so the proposal's checks would never run and the tag would never start the release). The App has repository permissions Contents (write), Pull requests (write) and Issues (write), and nothing else; no personal access token is used.
- **Two environments.**
  - `release-proposal`: no required reviewers, deployments limited to `main`. Holds `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`. Updating a proposal must never wait for a person.
  - `release`: required reviewers, deployments limited to `v*` tags. Holds `UPDATE_SIGNING_KEY` (the Ed25519 private key that signs updates, base64 PKCS#8; ADR-0010) and, once signing is set up, the Apple and Windows signing credentials. Only the `publish` job of `release.yml` and the signing jobs of `desktop-build.yml` use it. Approve all of a run's pending deployments together (_Review deployments_).
- **Tag ruleset.** Creating a tag that matches `v*` is restricted to the release App; updating and deleting such tags is blocked; nobody bypasses it. Without this, a hand-pushed tag would run the release workflow without a proposal having been approved. Check it by trying to push `v0.0.0-test` as a maintainer: it must be rejected.
- **Review gate.** `release.yml` refuses to run while `docs/security-review/status.md` is not complete (`scripts/check-review-gate.mjs`).
- **Failure.** A failed run leaves the release a draft and opens an issue named `Release vX.Y.Z failed`. To try again, run the Release workflow on the tag.

The release proposal pull request is subject to the same two-approval rule as `main`; relax the count for it if that becomes a bottleneck.
