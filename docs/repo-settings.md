# Repository settings

Applied by a maintainer with `scripts/apply-branch-protection.sh OWNER/REPO` (the script is reviewed here but never run by CI or contributors).

`main` is protected:

- Required status check `verify` (CI job: type-check, lint, tests and coverage floors, build, bundle/licence/float gates, audit, Playwright with blocking axe WCAG 2.2 AA assertions, Testcontainers, SBOM).
- Pull requests only; **two** approving reviews, enforced through CODEOWNERS for `packages/crypto/`, `packages/core/src/sync/` and `packages/core/src/sharing/`. The repo-wide review count is set to two for simplicity; relax to one for non-sensitive paths if this becomes a bottleneck.
- Stale approvals are dismissed on new commits.
- Linear history, squash merge only, no force pushes, no deletions, applies to admins.
