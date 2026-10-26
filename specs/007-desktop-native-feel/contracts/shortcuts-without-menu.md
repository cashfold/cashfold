# Contract: Shortcuts without a menu

Handled in the main process on `before-input-event` of the main window; matched case-insensitively; `CmdOrCtrl` = Command on macOS, Control elsewhere.

| Accelerator | Action | Notes |
|---|---|---|
| CmdOrCtrl+Z / Shift+CmdOrCtrl+Z | undo / redo | macOS routed explicitly; native elsewhere |
| CmdOrCtrl+X / C / V / A | cut / copy / paste / select all | same; "select all" is a no-op outside a field because nothing outside fields is selectable |
| CmdOrCtrl+W | close window | follows background mode |
| CmdOrCtrl+M (macOS) | minimise | |
| F11, Ctrl+Cmd+F (macOS) | toggle full screen | |
| CmdOrCtrl+Q | quit | macOS also via the app menu |
| App actions (006) | not handled here | Delivered by 006 through this same table with the 006 ids and keys; this feature adds no entry for them. Ignored while locked except `lock`. |

Rules: an unknown input passes through untouched; a handled input is `preventDefault`-ed; no shortcut reaches data while locked; no handler is system-wide.
