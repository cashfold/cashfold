# Tests

**Scope:** `**/*.test.ts(x)`, `e2e/**`, `tests/**`.

Follow `_contract.md`. The standards are in `CODING_STANDARDS.md` ("Tests") and
`.claude/rules/testing.md`.

- **Does the change have a test that would fail without it?** New behaviour and every bug fix need one.
  A test that passes on the old code proves nothing.
- **Behaviour, not implementation.** Assertions on what a person or caller observes. Flag tests that
  pin private names, call counts of internal helpers, or the shape of a mock.
- **Mocks.** Only network, clock and randomness, and those injected. Prefer the existing fakes.
- **Deterministic.** No fixed sleeps, no real time, no unseeded randomness, no reliance on order, ports
  or another test's data. A retry added to hide a failure is a `blocker`.
- **Failure messages.** A failure should say what broke. Whole-value `toEqual` over many loose checks.
- **Bad paths.** Invalid input, offline, corrupt storage, replayed or reordered operations, concurrent
  edits. A change to arithmetic or merge has property tests (`fast-check`).
- **Playwright specs.** Role, label or text selectors, never CSS classes or positions; shared helpers
  from `e2e/fixtures`; no assumption of left-to-right or one browser; each test creates its own
  account. A changed spec is repeated five times by CI; reason about whether it could flake.
- **Guards.** A test that guards a rule (architecture, no-emoji, catalogue completeness) should be shown
  to fail when the rule is broken.
