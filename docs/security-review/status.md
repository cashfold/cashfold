# External security review: status

A release is published only when this page says the review is complete (`scripts/check-review-gate.mjs`, run by `.github/workflows/release.yml`). Edit the lines below when the review happens; the gate reads them.

- Status: pending <!-- pending | in progress | complete -->
- Reviewer:
- Scope: see [README.md](README.md)
- Completed: <!-- YYYY-MM-DD -->
- Report: <!-- a link to the published report, or its path in this folder -->

## Findings

One row per finding, with the reviewer's severity. A **critical** or **high** finding blocks the release until its status starts with *fixed*, *accepted* (with the reason and a link to the threat-model entry) or *wontfix*. Every row needs a status.

| ID | Severity | Status | Notes |
| --- | --- | --- | --- |

## History

- 2026-10: package prepared (README.md); reviewer not yet engaged.
- 2026-10-24: internal review by the maintainer (Andrii Pohuliailo), see [internal-review-2026-10.md](internal-review-2026-10.md). It is not independent and does not change the status above.
