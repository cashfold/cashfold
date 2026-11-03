---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "e2e/**/*"
  - "tests/**/*"
  - "vitest*.ts"
---

# Testing

## Layers

| Layer                  | Where and how                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Unit and property      | `*.test.ts` next to the code, Vitest. `fast-check` for properties and fuzzing.        |
| Real browser           | `*.browser.test.tsx`, `pnpm --filter @cashfold/web test:browser` (OPFS, workers, WASM) |
| End to end             | `e2e/*.spec.ts`, Playwright, config in `e2e/playwright.config.ts`                     |
| Relay integration      | `pnpm --filter @cashfold/server test:integration` (Testcontainers, needs Docker)      |
| Desktop                | `pnpm --filter @cashfold/desktop test`, `test:packaged`, `test:sync`, `test:update`   |
| Architecture guards    | `architecture.test.ts`, `eslint-rules/*.test.js`, `scripts/*.test.ts`                 |

## Write tests that fail usefully

- Test **observable behaviour**, not implementation. Assert on what a person or caller sees.
- Prefer real flows to mocks. Mock only the network, time or randomness, and use the fakes in
  `packages/core/src/testing` and `apps/web/src/worker/fakes.ts` before inventing new ones.
- Deterministic: no real clocks or randomness without control (inject `ClockPort`, `RandomPort`; use
  the seeded `createRng`). A flaky test is a bug, not a retry.
- Cover the happy path **and** the realistic bad paths: invalid input, offline, corrupt storage, a
  replayed or reordered operation.
- A bug fix starts with a test that reproduces it.
- Changes to operation or payload schemas need a replay test over the frozen fixtures in `vectors/`.

## Playwright specs

- Select by role, label or visible text (`getByRole`, `getByLabel`), never by CSS class or index.
  Use the helpers in `e2e/fixtures` (`nav.ts`, `select.ts`, and so on) instead of copying setup.
- Every spec also runs under `chromium`, `firefox`, `webkit` and `rtl`; do not write a spec that
  assumes left-to-right order or one browser's behaviour.
- No fixed sleeps. Wait on an observable condition with `expect(...)` auto-waiting.
- Each test creates its own account; tests must not share state, ports or storage.
- Keep `e2e/leak-scan` in mind: nothing readable may appear in network traffic.

## Running on this project

- One Playwright invocation at a time (each rebuilds `apps/web/out`, ports 3100 and 3200); use
  `--workers=3` for specs that sign up. To run one spec call Playwright directly:
  `pnpm exec playwright test -c e2e/playwright.config.ts e2e/<file>.spec.ts --project=chromium`.
  `pnpm test:e2e -- <file>` runs everything.
- Under heavy load the SRP fuzz unit test can exceed its 5 s timeout; rerun it alone before treating
  it as a failure.
- Lint after a Playwright run finishes, not during it.
