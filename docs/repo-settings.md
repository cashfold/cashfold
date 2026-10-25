Applied by a maintainer with `scripts/apply-branch-protection.sh OWNER/REPO` (the script is reviewed here but never run by CI or contributors). The script and this page describe the same settings; change them together.

## Branch protection

`main` is protected:

- **Pull requests only.** Nobody pushes to `main`, administrators included.
- **Required status check `verify`,** on a branch that is up to date with `main`. It is the CI job: type-check, lint, tests and coverage floors, build, bundle, license and no-float gates, audit, Playwright with blocking axe WCAG 2.2 AA assertions, Testcontainers, SBOM.
- **Linear history and squash merge only.** Merge commits and rebase merging are switched off, so the pull request title is the commit on `main` and decides the version (see [CONTRIBUTING.md](../CONTRIBUTING.md#how-a-change-becomes-a-release)).
- **No force pushes and no deletions** of `main`.
- **Stale approvals are dismissed** when new commits are pushed.
- **The rules apply to administrators.** Relaxing them for an emergency is a deliberate change in the repository settings, not a button on the pull request.

### Reviews

The constitution asks for **two reviewers** on security-sensitive paths (`packages/crypto/`, `packages/core/src/sync/`, `packages/core/src/sharing/` and the desktop shell and release files listed in [`.github/CODEOWNERS`](../.github/CODEOWNERS)), together with a threat-model note.

Branch protection cannot enforce that while the project has a single maintainer: GitHub does not let an author approve their own pull request, so a required approval would block every merge. The settings therefore **require no approving reviews and no code-owner review**. When a second maintainer joins, set the required approvals to two, enable "Require review from Code Owners", and update `scripts/apply-branch-protection.sh` and this page. Until then, the review rule is applied by the maintainer, and the pull request template asks for the threat-model note.

## Releases

Releases are made by merging a **release proposal**, never by hand. The pieces, and what a maintainer sets up once (specs/003-desktop-apps-releases, `docs/desktop.md`):

- **The proposal.** `.github/workflows/release-please.yml` keeps one pull request up to date on every push to `main`: the next version (worked out from the Conventional Commit titles that were squash-merged: `fix` raises the patch number, `feat` the minor number, a breaking change the major number) and the changelog. Changes under `apps/server`, `docs`, `specs`, `e2e`, `tests`, `deploy` and `.github` are not counted, so they never make a release by themselves. The proposal is an ordinary pull request: it needs the `verify` check like any change, and **merging it is the approval to release**. It then makes the tag `vX.Y.Z` and a draft release.
- **The GitHub App.** The proposal and the tag are made with a GitHub App token, not the default token (events made with the default token start no other workflows, so the proposal's checks would never run and the tag would never start the release). The App has repository permissions Contents (write), Pull requests (write) and Issues (write), and nothing else; no personal access token is used.
- **Two environments.**
  - `release-proposal`: no required reviewers, deployments limited to `main`. Holds `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`. Updating a proposal must never wait for a person.
  - `release`: required reviewers, deployments limited to `v*` tags. Holds `UPDATE_SIGNING_KEY` (the Ed25519 private key that signs updates, base64 PKCS#8; ADR-0010) and, once signing is set up, the Apple and Windows signing credentials. Only the `publish` job of `release.yml` and the signing jobs of `desktop-build.yml` use it. Approve all of a run's pending deployments together (_Review deployments_).
- **Tag ruleset.** Creating a tag that matches `v*` is restricted to the release App; updating and deleting such tags is blocked; nobody bypasses it. Without this, a hand-pushed tag would run the release workflow without a proposal having been approved. Check it by trying to push `v0.0.0-test` as a maintainer: it must be rejected.
- **Review gate.** `release.yml` refuses to run while `docs/security-review/status.md` is not complete (`scripts/check-review-gate.mjs`).
- **Failure.** A failed run leaves the release a draft and opens an issue named `Release vX.Y.Z failed`. To try again, run the Release workflow on the tag.

The release proposal pull request is subject to the same branch protection as any other change.

## Other repository settings

These live in the repository settings, not in a file, and the documentation relies on them:

- **Private vulnerability reporting: on.** [SECURITY.md](../SECURITY.md) and the
  [Code of Conduct](../CODE_OF_CONDUCT.md) send reporters to _Security → Advisories → Report a vulnerability_. Check that the button exists on the Security tab.
- **Issues: on, blank issues: off.** The issue forms are in `.github/ISSUE_TEMPLATE/`. Discussions are off; [SUPPORT.md](../SUPPORT.md) says so.
- **Description and topics** match the README, so the repository is easy to find.
- **Labels** used by the issue forms and pull request template: `bug`, `enhancement`, `documentation`, `question`, `good first issue` and `help wanted`.
