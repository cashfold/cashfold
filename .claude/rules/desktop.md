---
paths:
  - "apps/desktop/**/*"
  - "packages/platform/**/*"
  - ".github/workflows/desktop-*.yml"
  - ".github/workflows/release*.yml"
  - "scripts/*sign*"
  - "scripts/release-*"
---

# Desktop shell and releases

Full guide: `docs/desktop.md`. The desktop app is the unchanged web static export in an Electron
window, served from `app://cashfold`. It adds no features and changes no data format.

## Hard rules

- `apps/desktop` imports `@cashfold/platform` only. It knows nothing of the web app or the domain,
  and nothing below the apps knows the shell.
- The page reaches the shell through one typed bridge (`cashfoldDesktop`, from `packages/platform`).
  Every call is validated by strict schemas on both sides. A new capability means a new schema in
  `platform`, handled in `main`, with a test for a rejected malformed call.
- Keep the page isolated: context isolation and sandbox on, no Node in the page, navigation and new
  windows refused, webviews refused, only the permissions already granted.
- `apps/desktop/src/main/identity.json` (`name`, `appId`) is **frozen** once a release exists:
  Electron derives the data folder from the name and the updater identifies the app by the id.
  `pnpm check:desktop-config` guards this.
- The version has one source, the root `package.json`, written by the release bot.
  `apps/desktop/package.json` stays `0.0.0`.
- The shell's log is structured and redacted by type: no paths, keys or IPC payloads.
- Update assets are signed (`scripts/sign-update-assets.mjs`); never weaken the signature check or
  commit a signing key. Secrets come from the environment (`scripts/check-signing-env.mjs`).
- Never tag a release by hand; merging the release pull request publishes it.

## Working on this machine

- Electron started with `ELECTRON_RUN_AS_NODE=1` runs as plain Node and fails with
  `Cannot read properties of undefined (reading 'commandLine')`. Editor-hosted shells set it. Start
  Electron with `env -u ELECTRON_RUN_AS_NODE`.
- After a fresh `pnpm install` the Electron binary may be missing (pnpm blocks build scripts):
  run `node apps/desktop/node_modules/electron/install.js`.
- There is no `timeout` command on macOS, and `gh` may not be installed; use `git ls-remote` or the
  GitHub REST API with `curl` for repository facts.
- The web build must exist first: `pnpm --filter @cashfold/web build`.
