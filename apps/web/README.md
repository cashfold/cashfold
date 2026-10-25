# `@cashfold/web`

The Cashfold web client: a Next.js app built as a **static export** (`apps/web/out`) that runs
entirely in the browser. It is also the app that the [desktop shell](../desktop/README.md) serves in
its own window.

All data handling happens in a worker in the browser. Data is kept in an encrypted SQLite database on
the browser's private file system, and the page never sees keys. The relay is optional and only ever
receives ciphertext.

## Layout

| Path            | What it holds                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`      | Routes (Next.js App Router)                                                                                                                                                           |
| `src/ui/`       | Screens, the vendored UI kit, the message catalogs and right-to-left support                                                                                                          |
| `src/worker/`   | The core worker: it owns the keys, the database and the sync service                                                                                                                  |
| `src/adapters/` | Implementations of the ports `packages/core` defines: SQLite on OPFS, the relay transport                                                                                             |
| `src/sw/`       | The service worker that makes the app work offline and pins the asset set it installed                                                                                                |
| `scripts/`      | Build steps: copying and verifying the SQLite and SRP WebAssembly files and the fonts, hardening the HTML (integrity hashes, content security policy) and building the service worker |

## Commands

Run from the repository root:

```sh
pnpm --filter @cashfold/web dev            # development server on http://localhost:3000
pnpm --filter @cashfold/web build          # static export in apps/web/out
pnpm --filter @cashfold/web typecheck
pnpm --filter @cashfold/web test:browser   # storage, workers and WebAssembly in a real browser
pnpm test:e2e                              # end-to-end tests (builds the app and starts a relay)
```

`dev` and `build` first copy and verify the WebAssembly files and fonts (`predev`, `prebuild`). The
SQLite files are checked against `vendor/sqlite3mc.sha256`, so a changed file stops the build. The
development server has no service worker, so test offline behaviour against a build.

## Building for your own relay

Two variables at build time pin the app to your relay; see
[Running your own relay](../../docs/self-hosting.md), step 4.

| Variable                     | Effect                                                              |
| ---------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_DEFAULT_SERVER` | The relay address offered at sign-up                                |
| `CSP_CONNECT_SOURCES`        | The only addresses the content security policy lets the app talk to |

## Related

[Architecture](../../docs/ARCHITECTURE.md) (client hardening, section 10) ·
[Threat model](../../docs/threat-model.md) · [Contributing](../../CONTRIBUTING.md)
