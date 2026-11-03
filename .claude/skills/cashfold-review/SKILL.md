---
name: cashfold-review
description: Review a Cashfold diff, branch or pull request through focused reviewers run in parallel — correctness, architecture, privacy and security, money, interface (kit, accessibility, right-to-left), languages, tests, and conventions. Use before opening a pull request or when asked to review changes.
---

# Reviewing Cashfold code

Run the review as **separate lenses in parallel**, so a large diff is covered faster and each reviewer
stays on one concern. Each lens is a file under `reviewers/`. You (the orchestrator) pick the lenses,
dispatch them, then merge and report.

The standards come from, in order: the constitution (`.specify/memory/constitution.md`),
`CODING_STANDARDS.md`, and the path-scoped rules in `.claude/rules/`. The repository wins over any
document when they disagree.

## How to review

1. **Get the diff. Review only what changed.**
   - Committed range (default): `git fetch origin main` first so the base is current, then
     `git diff origin/main...HEAD`. A stale base fills the review with other people's merged work.
   - Uncommitted work: take one snapshot so every reviewer sees the same bytes:
     `git add -N . && git diff HEAD > "$SCRATCH/review.diff"`, and give reviewers that path.
2. **List the changed files** (`git diff --name-only origin/main...HEAD`) and skip every lens whose scope
   is untouched (no `apps/web/src/ui/**` change means no `interface` lens). Never skip `correctness`,
   `security` or `conventions`, and never skip a lens because the diff is small: a one-line change to a
   wire id or a message key is exactly what these catch.
3. **Fan out in a single message**: one `Agent` (`subagent_type: Explore`) per lens in scope, each with
   this briefing:
   - the diff source (the range, or the snapshot path) and the globs the lens owns;
   - "Read `.claude/skills/cashfold-review/reviewers/_contract.md` for the persona and the output
     format, then read `.claude/skills/cashfold-review/reviewers/<file>`, and any rule it points to.
     Apply only that lens to the changed files in your scope. Do not review anything else."
   Reviewers are read-only and independent. Overlap between lenses is fine; you remove duplicates.
4. **Merge and report.** Drop exact duplicates; when two lenses flag the same `file:line`, keep the
   higher severity. Group by file, each finding tagged `blocker`, `suggestion` or `nit`, with
   `file:line`. If the request states what the change must deliver (an issue, a spec, acceptance
   criteria), check each deliverable against the diff and list any that are missing. If nothing is
   wrong, say so in one line; do not invent nits.

## Reviewers

| File                         | Lens                                                          | Scope                                                              |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `reviewers/correctness.md`   | Correctness and root cause                                    | all source except tests                                            |
| `reviewers/architecture.md`  | Boundaries, CQRS, event sourcing, schema changes              | `packages/**`, `apps/server/**`, `eslint.config.js`                |
| `reviewers/security.md`      | Zero knowledge, secrets, cryptography, CSP, desktop isolation | all source except tests                                            |
| `reviewers/money.md`         | Exact money, rounding, currency                               | money files (see `.claude/rules/money.md`)                         |
| `reviewers/interface.md`     | Kit, accessibility, right-to-left, offline, privacy mode      | `apps/web/src/ui/**`, `apps/web/src/app/**`                        |
| `reviewers/languages.md`     | Message catalogues and translations                           | `apps/web/src/ui/i18n/**`, `**/*.json`, any UI text, desktop menus |
| `reviewers/tests.md`         | Test quality and Playwright specs                             | `**/*.test.ts(x)`, `e2e/**`, `tests/**`                            |
| `reviewers/conventions.md`   | Standards, readability, commit and pull request hygiene       | all files                                                          |

The shared persona and the output format live once in `reviewers/_contract.md`. Change them there, not
in this file.
