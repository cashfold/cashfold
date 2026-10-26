# Contract: bridge additions

Extends [the desktop bridge contract of spec 003](../../003-desktop-apps-releases/contracts/desktop-bridge.md) and the `setLanguage` call of spec 004. The rules of that contract still apply to every item below: one frozen global, fixed channels, no generic send, strict schemas that refuse unknown keys on both sides, a sender check on every handler, and no path, URL or command taken from the page except the validated values listed here.

## Synchronous property

| Property | Type | Notes |
|----------|------|-------|
| `platform` | `'win32' \| 'darwin' \| 'linux'` | Read once at preload; lets the page set `data-platform` and `data-frame` before first paint. |

## Calls (page to shell, `ipcRenderer.invoke`)

| Channel | Request | Response | Notes |
|---------|---------|----------|-------|
| `cashfold:settings` | none | `DesktopSettings` + `Capabilities` | Defaults applied; see [data-model](../data-model.md). |
| `cashfold:settings:set` | `{ hideOnBlur?, startAtLogin?, closeBehavior? }` (at least one, strict) | `{ settings, applied: { startAtLogin: boolean } }` | Refuses `closeBehavior: 'background'` when `statusItem` is false. |
| `cashfold:theme` | `{ theme: 'system' \| 'light' \| 'dark' }` | `void` | Mirrors the page's choice; sets the native theme source and window colours. |
| `cashfold:session` | `{ state: 'locked' \| 'unlocked' }` | `void` | Lets the shell enable or disable data actions, clear recent Folds and the badge on `locked`, and release queued intake on `unlocked`. A hint for presentation only: the shell holds nothing sensitive whatever it says. |
| `cashfold:badge` | `{ count: integer 0..999 }` | `void` | |
| `cashfold:recent-folds` | `{ folds: array of 0..5 { id: string ≤ 64, name: string ≤ 40 } }` | `void` | Refused (and the list cleared) unless the last `session` was `unlocked`. |
| `cashfold:popup-menu` | `{ items: 1..12 of { id: /^[a-z][a-z-]{0,23}$/, label: string ≤ 60, destructive?: boolean } }` | `{ id: string \| null }` | Shows a native menu at the pointer; resolves with the chosen id or `null`. Items are only labels and ids: no row data. |
| `cashfold:window:show` | none | `void` | Shows, restores and focuses the window (from a notification click). |

## Events (shell to page, `webContents.send`)

| Channel | Payload | Notes |
|---------|---------|-------|
| `cashfold:system-lock` | `{ reason: 'screen-lock' \| 'suspend' \| 'idle-state' }` | The page locks exactly as its Lock button does. Sent again on `resume` if the page has not reported `locked`. |
| `cashfold:menu-action` | `{ action: ActionId }` | `ActionId` is the closed set in [menu-and-shortcuts](menu-and-shortcuts.md). |
| `cashfold:incoming` | `IncomingItem` | Only while the last `session` report was `unlocked`. |
| `cashfold:frame-state` | `{ fullscreen: boolean, maximized: boolean, translucent: boolean }` | For layout insets and the translucent sidebar. |
| `cashfold:settings:changed` | `DesktopSettings` | After a change made elsewhere (tray, argument). |

## Bridge object (what `window.cashfoldDesktop` exposes after this feature)

`about`, `revealDataFolder`, `setLanguage` (existing), `platform`, `settings` (`get`, `set`), `setTheme`, `reportSession`, `setBadge`, `setRecentFolds`, `popupMenu`, `showWindow`, `onSystemLock`, `onMenuAction`, `onIncoming`, `onFrameState`, `onSettingsChanged`, and the `updates` group (existing). The object and its `updates` and `settings` groups stay frozen; listeners return an unsubscribe function; nothing exposes `ipcRenderer`, `invoke`, `send` or `on`.

## Rules

1. Every request and every event payload is parsed against its schema before use, on both sides; an unexpected key is an error.
2. The shell never trusts `session`, `badge` or `recent-folds` for a security decision: they only change what the shell's own surfaces show.
3. The page accepts `system-lock`, `menu-action` and `incoming` only from this bridge, and only acts on a menu action when unlocked (`lock` and `quit`-like actions excepted).
4. The hardening test in `apps/desktop/e2e/hardening.spec.ts` lists the exact keys of the bridge and is updated with it.
