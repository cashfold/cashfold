# External security review: status

A release is published only when this page says the review is complete (`scripts/check-review-gate.mjs`, run by `.github/workflows/release.yml`). Edit the lines below when the review happens; the gate reads them.

- Status: complete <!-- pending | in progress | complete -->
- Reviewer: Andrii Pohuliailo (maintainer). Internal review, not independent: see History.
- Scope: see [README.md](README.md)
- Completed: 2026-10-24
- Report: [internal-review-2026-10.md](internal-review-2026-10.md)

## Findings

One row per finding, with the reviewer's severity. A **critical** or **high** finding blocks the release until its status starts with *fixed*, *accepted* (with the reason and a link to the threat-model entry) or *wontfix*. Every row needs a status.

| ID | Severity | Status | Notes |
| --- | --- | --- | --- |
| INT-1 | Medium | Fixed | Sign-in does the same work for unknown and existing addresses (PR #27). Response time over a real network was not measured. |
| INT-2 | Medium | Fixed | An update is installed only if the installer name carries the offered version (PR #27). |
| INT-3 | Medium | Fixed | The relay refuses a `RATE_LIMIT_SCALE` that is not a positive number (PR #27). |
| INT-4 | Low | Fixed | `TRUST_PROXY`; the default trusts only loopback and private ranges (PR #27). |
| INT-5 | Low | Accepted: a snapshot carries no time, so a removed editor's old snapshot is still accepted; closing it needs a signed time in the snapshot format. Narrowed in PR #27 (viewers and from-now-on members are refused). See threat-model residual risk 10. | Follow-up: protocol change. |
| INT-6 | Low | Fixed | Stale entries are swept and handshakes re-check the lock (PR #27). Lockouts are kept in memory only, as the threat model says. |
| INT-7 | Low | Fixed | The attachment quota is counted and written in one step (PR #27). |

## History

- 2026-10: package prepared (README.md); reviewer not yet engaged.
- 2026-10-24: internal review by the maintainer (Andrii Pohuliailo), see [internal-review-2026-10.md](internal-review-2026-10.md). The project is open source with no independent security reviewer, so the maintainer marked the gate complete on this review, with all findings fixed or accepted. An independent external review has not been done; a later one would add its own rows and history entry.
