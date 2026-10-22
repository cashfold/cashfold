# Contract: Desktop bridge (renderer ⇄ main)

The only interface between the web app and the Electron shell. Types and zod schemas live in `packages/platform` (`@cashfold/platform`) so that `apps/web`, the preload script and the main process agree and validate the same shapes. See research R-D-03, R-D-04, R-D-10, R-D-11.

## Exposure

The preload script exposes one frozen object with `contextBridge.exposeInMainWorld('cashfoldDesktop', bridge)`. Nothing else is exposed: no `ipcRenderer`, no Node module, no generic `invoke`.

The web app reads it through `apps/web/src/adapters/platform/`:

```ts
// @cashfold/platform (types only, shown for shape; not final code)
export interface AboutInfo {
  readonly version: string;            // equals the release tag without "v"
  readonly buildId: string;            // commit the web export was built from
  readonly electron: string;
  readonly chromium: string;
  readonly os: 'win32' | 'darwin' | 'linux';
  readonly arch: 'x64' | 'arm64';
  readonly packaging: 'nsis' | 'dmg' | 'appimage' | 'deb' | 'rpm' | 'unpacked';
  readonly updateMode: 'in-app' | 'manual';
  readonly signed: boolean;
  readonly dataPath: string;           // display only
  readonly sourceUrl: string;          // https URL of the source tag of this version
}

export type UpdateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly version: string; readonly notesUrl: string; readonly mode: 'in-app' | 'manual' }
  | { readonly kind: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'error'; readonly code: 'offline' | 'verify-failed' | 'download-failed' | 'unknown' };

export interface DesktopBridge {
  about(): Promise<AboutInfo>;
  revealDataFolder(): Promise<void>;
  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;       // only valid in `available` with mode `in-app`
    install(): Promise<void>;               // only valid in `ready`; quits and relaunches
    openReleasePage(): Promise<void>;       // `manual` mode and the "what's new" link
    autoCheck(): Promise<boolean>;          // periodic checks on or off (default on)
    setAutoCheck(on: boolean): Promise<void>;
    onChange(listener: (s: UpdateState) => void): () => void;
  };
}
```

## Channels

All use `ipcMain.handle` (request/response) except `update:changed` (main → renderer event).

| Channel | Request | Response | Notes |
|---|---|---|---|
| `cashfold:about` | none | `AboutInfo` | |
| `cashfold:data:reveal` | none | `void` | Calls `shell.openPath(userData)`. The path is never taken from the renderer. |
| `cashfold:update:state` | none | `UpdateState` | |
| `cashfold:update:check` | none | `UpdateState` | Non-blocking for the app; errors become `{kind:'error'}`, never exceptions. |
| `cashfold:update:download` | none | `UpdateState` | Rejected unless the current state is `available` and mode `in-app`. |
| `cashfold:update:install` | none | `void` | Rejected unless the current state is `ready`. |
| `cashfold:update:release-page` | none | `void` | Opens the release page for the pending or current version, `https` only. |
| `cashfold:update:auto-check` | `{ set?: boolean }` | `boolean` | Without `set` returns the setting, with `set` stores and returns it. |
| `cashfold:update:changed` | n/a | `UpdateState` event | main → renderer. |

## Validation rules (every handler)

1. `event.senderFrame.url` must be inside the app origin (`app://cashfold`); any other sender is rejected and logged without content.
2. Request payloads are parsed with the shared zod schema; an unexpected argument is an error (strict objects). Responses are built in main from trusted values, then parsed by the same schema before returning (catches drift in tests).
3. Handlers are state-guarded: an `install` while not `ready`, or a `download` while `manual`, returns an error object rather than acting.
4. No handler accepts a path, URL or command from the renderer. URLs opened externally are built in main from the version and the repository constant, then checked against the allowlist.

## Behavioural contract (testable)

- **B-1**: with the bridge absent (web build), no desktop UI is rendered and the web build behaves as before (FR-002, FR-005). Test: the existing web e2e suite is unchanged and green.
- **B-2**: `download()` in `manual` mode returns an error, never starts a download (FR-015).
- **B-3**: `install()` without a prior `download()` and `ready` state returns an error (FR-014: no install without consent).
- **B-4**: offline `check()` resolves to `{kind:'error', code:'offline'}` within the check timeout and does not delay any other IPC call (FR-013).
- **B-5**: `about().version` equals the release version under test, and `sourceUrl` ends with `/tree/v<version>` or the equivalent tag URL (SC-011, R-D-15).
- **B-6**: a handler called from a frame outside the app origin is rejected (R-D-11).
- **B-8**: with `autoCheck` off, no network request is made at launch or on the interval, and a manual `check()` still works.
- **B-9**: an update whose `.sig` is missing, malformed, signed by an unknown key, or made for a different asset name or SHA-512 is rejected: the state is `error(verify-failed)`, the downloaded file is deleted and `install()` stays rejected (FR-016).
- **B-7**: the test-feed override is unreachable in a release build (R-D-10): a release test asserts the compiled constant is false.

## UI contract (apps/web)

- A new **About and updates** section in Settings, shown in both builds, with an *Automatically check for updates* switch (default on) in the desktop build. In the web build it shows only the version of the web app; in the desktop it also shows build info, data location with a "Show in folder" button, source link, and the update controls.
- Update prompt states map one-to-one to `UpdateState`. Buttons: *Check for updates*, *Download* (in-app), *Restart and update* (ready), *Open release page* (manual). Copy comes from the existing i18n catalogue with new keys, in every shipped locale including RTL.
- A non-modal notice appears when `available` is reached, dismissible, and never steals focus (WCAG 2.2 AA, axe-checked).
- Before `install()` the UI waits for in-flight commands to drain (research R-D-10).
