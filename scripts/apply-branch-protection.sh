#!/usr/bin/env bash
# Applies the `main` protection described in docs/repo-settings.md.
# Reviewed in PRs but run ONLY by a maintainer with admin rights: ./scripts/apply-branch-protection.sh OWNER/REPO
set -euo pipefail
repo="${1:?usage: apply-branch-protection.sh OWNER/REPO}"

# Reviews are not required by the settings while the project has a single maintainer: GitHub does not let an author approve their own
# pull request, so a required approval would block every merge. The constitution still asks for two reviewers on security-sensitive paths.
# With a second maintainer, set required_approving_review_count to 2 and require_code_owner_reviews to true (docs/repo-settings.md).

gh api --method PUT "repos/${repo}/branches/main/protection" --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["verify"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

gh api --method PATCH "repos/${repo}" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false >/dev/null
echo "Branch protection applied to ${repo}:main"

# The tag ruleset that keeps releases behind the approved release proposal is set up by hand in the repository settings (Rules > Rulesets):
# target: tags matching v*; rules: restrict creation, restrict updates, restrict deletions; bypass list: only the release GitHub App.
# See docs/repo-settings.md ("Releases"). A maintainer checks it by trying to push the tag v0.0.0-test, which must be rejected.

