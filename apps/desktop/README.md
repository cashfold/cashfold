# `@cashfold/desktop`

The Cashfold desktop app for Windows, macOS and Linux: an [Electron](https://www.electronjs.org/)
shell around the [web app](../web/README.md)'s static export. It adds no features and changes no data
format, so the same account works on the web and on the desktop.

Installing, updating, signing and releasing are covered in [docs/desktop.md](../../docs/desktop.md).
The decision is recorded in [ADR-0009](../../docs/adr/0009-electron-desktop-shell.md), and the update
signature in [ADR-0010](../../docs/adr/0010-update-signatures.md).

## Layout

| Path                          | What it holds                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/`                   | The main process: window, the `app://` protocol that serves the export, navigation and permission lockdown, IPC, the updater and its signature check |
| `src/preload/`                | The bridge: the one frozen object the page can reach. Its contract is in [`packages/platform`](../../packages/platform/README.md)                    |
| `e2e/`                        | End-to-end tests that drive the packaged app with Playwright                                                                                         |
| `scripts/`                    | Build, packaging and test runners                                                                                                                    |
| `electron-builder.config.mjs` | Installer settings for each system                                                                                                                   |

## The desktop experience

What makes the window behave like an application is a handful of small modules in `src/main/`, each with its tests: `appearance.ts` (theme and first-frame colour), `shortcuts.ts` (shortcuts without a menu bar), `native-feel.ts` (no selectable interface text, native pointers), `text-menu.ts` and `context-menu.ts` (right-click menus), `badge.ts` and `tray.ts` (count, tray, dock menu, jump list), `intake.ts` (files and `cashfold://` links from outside), `launch.ts` (start at login) and `frame.ts` (title bar and translucent material). They are described in [docs/desktop.md](../../docs/desktop.md).

## Commands

Run from the repository root:

```sh
pnpm --filter @cashfold/web build         # the export the app serves (build it first)
pnpm --filter @cashfold/desktop dev       # run the app from source
pnpm --filter @cashfold/desktop test      # unit tests of the main process and the bridge
pnpm --filter @cashfold/desktop test:packaged   # package the app for this system and run the end-to-end tests
```

`test:packaged` runs against the packaged app, the way a person runs it. On Linux it needs a display
(`xvfb-run -a …`). `CASHFOLD_E2E_WINDOW_WIDTH=900` starts every app of a run with a narrow window, to
try the layout with the menu in a drawer.

## Security notes

The page is isolated and sandboxed with no Node, and talks to the shell only through the bridge;
every argument and answer is checked against a strict schema.
