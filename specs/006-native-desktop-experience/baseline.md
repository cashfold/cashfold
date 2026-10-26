# Baseline (before spec 006 work)

Branch `feat/native-desktop-experience`, taken from `feat/ukrainian-polish-languages` at b3b4694, 2026-10-25.

- `pnpm typecheck`: passes (8 of 8 tasks).
- `npx vitest run apps/desktop packages/platform apps/web`: 64 files, 961 tests, all pass.
- `pnpm --filter @cashfold/desktop test:packaged`: 27 passed, 14 skipped (update feed and sync-parity specs skip by design).

No failures existed before this work.

## Found while implementing US1 (not caused by this work)

The Core Worker's idle timer (`session.activity()`) is reset by `open()`, which nearly every worker call goes through, and the page calls `sync.status` every 15 seconds. In the web app and the desktop app alike, an unlocked window that stays open therefore never reaches its "lock after no activity" time; only the hidden-window time, blur and the Lock button lock it. The desktop app now has its own input-only idle lock (T020a). The web app is unchanged; fixing the worker (activity from the page's own input pings only) is a follow-up decision.

## Bundle after US1

`pnpm check:bundle`: initial 355,919 bytes gzipped (budget 374,784), worker and lazy 261,940 (budget 263,168, about 1.2 KB left: the later stories will need the lazy budget raised or the desktop code trimmed).
