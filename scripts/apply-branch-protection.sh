#!/usr/bin/env bash
# Applies the `main` protection described in docs/repo-settings.md.
# Reviewed in PRs but run ONLY by a maintainer with admin rights: ./scripts/apply-branch-protection.sh OWNER/REPO
set -euo pipefail
repo="${1:?usage: apply-branch-protection.sh OWNER/REPO}"

gh api --method PUT "repos/${repo}/branches/main/protection" --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["verify"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 2
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
