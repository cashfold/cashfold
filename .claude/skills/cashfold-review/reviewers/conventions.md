# Conventions, readability and hygiene

**Scope:** all changed files.

Follow `_contract.md`. The standard is `CODING_STANDARDS.md`; commit and release rules are in
`CONTRIBUTING.md`.

- **Minimal diff.** No unrelated reformatting, renames or moves. Every changed line is needed.
- **Readability.** Extract only for clarity or a second user. No one-line wrappers, speculative options
  or layers. Names are short and exact; commands are named for their intent.
- **Comments** say why (constraint, decision, trap, requirement), not what. Delete a comment that is now
  false; flag narration of obvious code.
- **Generated files.** If a generator's input changed, its output changed too (`CLAUDE.md` lists them):
  migrations, protocol docs, third-party notices, brand assets. Never hand-edit `CHANGELOG.md`.
- **Documentation.** Behaviour a person or operator can see is documented where the docs describe it.
  New Markdown is formatted (`pnpm check:docs`) and its links resolve.
- **Dependencies.** Exact versions, with a reason; the lockfile changed with `package.json`.
- **The pull request.** One purpose. The title is a Conventional Commit and decides the release: `feat`
  minor, `fix` and `perf` patch, `!` major, the rest none. **No AI-tool attribution** in commits or the
  description (no `Co-Authored-By`, no "Generated with"); flag it as a `blocker` if present.
- **Twins.** If a fact is stated in two places (a field id and its decoder, a message in three
  catalogues, a route and its redirect, a CSV column on import and on export), both sides changed, or the
  description says why not.
