# Coding standards

How code and tests are written in Cashfold. The rules the tools can check are checked by the tools
(`pnpm verify`); this page is for the judgement calls. Where it disagrees with the
[constitution](.specify/memory/constitution.md), the constitution wins. Commit and release rules are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Match what is there

Follow the style of the file you are in. Keep a change small: no unrelated reformatting, no
drive-by renames. A diff should contain only what the change needs, so a reviewer can read all of it.
`.editorconfig` sets two-space indentation, LF endings and a final newline.

## TypeScript

- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (`tsconfig.base.json`).
  Handle the `undefined` that indexing can give you instead of asserting it away with `!`, unless the
  line above proves it.
- No `any` without a comment that says why. Prefer `unknown` and narrow it.
- ES modules only. Use `import type` for types (`verbatimModuleSyntax`).
- A rule a person can break by mistake belongs in a type or a constructor, not in a comment.
  Value objects (`Money`, `LocalDate`, `Rate`) are immutable and validated when they are made.
- Expected failures in `core` are values: return a `Result` (`ok` and `err` from `shared-kernel/result`)
  with a stable error `code`, and throw only for programmer errors. The screen turns the code into a
  message from the catalogue.
- Money is `bigint` in minor units, never `number` (see `.claude/rules/money.md`).

## Design

- Extract a function or module when it makes the code easier to read or has a second user. Do not
  add a layer, option or dependency "for later" (constitution IX). A one-line wrapper that only adds a
  call to the stack is noise.
- Name commands for the intent (`addTransaction`), and functions for what they return. Keep names
  short and exact.
- Dependencies point inward (`docs/ARCHITECTURE.md` §0.3). If an import is awkward, the code is in the
  wrong place; move the code.
- Do not copy a fact into a second place when it can be derived from the first (the palette takes its
  screens from the route table). When you must repeat it, add a test that fails when the copies drift.

## Comments

Write comments that explain **why**: the constraint, the decision, the trap, or the spec requirement
(`FR-045`) behind a line. Do not narrate what the code already says. A comment at the top of a file that
says what it is for and what it must never do is welcome. Delete a comment that has become false.

## Errors, logs and secrets

- Nothing readable leaves the device. Logs, errors, URLs and telemetry never carry content, keys or
  secrets. Log through the core logger, which sanitises entries; do not call `console` in feature code.
- User-facing messages come from the catalogue (`error.*` keys), not from the thrown text.
- Validate at the edge (the wire schemas, the form, the CSV importer) and trust the types inside.

## Interface

- Screens use the kit (`@/ui/kit`); text comes from the message catalogues in English, Ukrainian and
  Polish; layout uses logical properties so it works right-to-left (`.claude/rules/ui.md`).
- Keep component state simple: one source of truth for a value, derived values computed during render
  rather than copied into state, and an effect only for something outside React (a subscription, the
  DOM, the network).
- Every control works with the keyboard and has a visible focus and an accessible name.

## Tests

A test is a statement about behaviour that a future change can break by accident. Write fewer tests
that say more.

- **Behaviour, not implementation.** Assert what a person or caller can observe: the screen, the
  returned value, the stored result, the bytes on the wire. A test that fails when you rename a private
  function is a liability.
- **Few mocks.** Prefer real flows and the fakes already in `packages/core/src/testing` and
  `apps/web/src/worker/fakes.ts`. Mock only the network, the clock and randomness, and inject those
  (`ClockPort`, `RandomPort`).
- **Deterministic.** No sleeps, no real time, no unseeded randomness. Wait for a condition, not a
  duration. A flaky test is a bug in the test or the code; do not add a retry. CI repeats a changed
  Playwright spec five times (`.github/workflows/flaky.yml`) and fails when it is not stable.
- **Fail usefully.** The name says what should happen, and the failure message says what broke. Prefer
  `expect(actual).toEqual(expected)` on a whole value to a pile of loose assertions.
- **Cover the bad paths** as well as the good one: invalid input, offline, corrupt storage, a replayed
  or reordered operation, a second device editing at the same time.
- **Properties for arithmetic and merges.** Use `fast-check` for money, conversion, projections and
  convergence; keep the seed of a failure and add it as an example.
- **A bug starts as a failing test.**
- **Fast.** Keep a unit test in milliseconds. Slow tests belong in the browser, integration or
  Playwright layers, and only when the behaviour cannot be seen any other way.
- **Isolated.** A test makes its own data and cleans up after itself; nothing depends on order, a port
  or another test's account.
- **Playwright specs** select by role, label or visible text, never by CSS class or position; reuse the
  helpers in `e2e/fixtures`; run unchanged in every browser project and in right-to-left. Details and
  commands are in `.claude/rules/testing.md`.

## Before you push

`pnpm verify` passes, the checks that fit your change pass (browser tests, `pnpm test:e2e`,
`pnpm build`), generated files are regenerated, and the documentation you touched is formatted
(`pnpm format:docs`). The pull request template is the checklist.
