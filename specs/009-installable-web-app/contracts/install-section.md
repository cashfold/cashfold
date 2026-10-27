# Contract: the Install section

Location: Settings group `install` (`/settings/install/`), listed in the settings index only when `InstallState` is `promptable` or `steps`.

| State | Content |
|---|---|
| `promptable` | Title "Install Cashfold"; one sentence on what it gives (its own window, opens from the dock, start menu or home screen, works offline); an **Install** button. Pressing it calls the deferred prompt. After acceptance the section says the app is installed. |
| `steps` | The same title and sentence; a numbered list of steps for `kind` (iPhone and iPad: Share, Add to Home Screen, Add; Mac Safari: File, Add to Dock; iOS Chrome/Edge: Share, Add to Home Screen). No button. |
| `installed-in-tab` | A single line saying Cashfold is installed, for as long as the tab stays open. |
| `installed` (own window), `unavailable`, desktop app | The group is not listed and its address shows the Settings index. |

Accessibility: a heading, a button with a visible name, an ordered list; passes axe in light and dark, at narrow width and in right-to-left layout. All text exists in English, Ukrainian and Polish (`install.*`).

Not allowed: a prompt, banner, toast, badge or sidebar item for install; remembering that the person was "asked".
