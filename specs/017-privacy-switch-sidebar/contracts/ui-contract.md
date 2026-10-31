# UI Contract: Privacy Mode Switch in the Sidebar

The interfaces the rest of the app and the tests rely on.

## 1. Components (`ui/privacy/PrivacySwitch.tsx`)

```text
PrivacySidebarItem()   // the labelled item, in the sidebar footer (wide window and drawer)
PrivacyTopbarItem()    // the compact icon-only button, in the narrow-window top bar
```

Both read `usePrivacy()` and call `toggle()`; neither holds state. Both are loaded as one lazy chunk (`React.lazy`), and render nothing until the chunk is there.

## 2. Sidebar item

| Part | Value |
|------|-------|
| Element | the kit's `SidebarItem` (a button) |
| Testid | `privacy-switch` |
| Text | `privacy.switch.off` ("Privacy mode: off") or `privacy.switch.on` ("Privacy mode: on") |
| Icon | `EyeIcon` when off, `EyeSlashIcon` when on; `aria-hidden` |
| Pressed state | `aria-pressed="false"` / `"true"` |
| Accessible name | its visible text |
| Place | the sidebar footer section, above Help; present on every screen of the unlocked shell, in both states |
| Activate | click, tap, Enter, Space: `toggle()`; focus stays on it |
| Drawer | the same item; activating it does not close the drawer |

## 3. Top-bar button

| Part | Value |
|------|-------|
| Element | the kit's `NavbarItem` (a button), `min-h-11 min-w-11` like Add |
| Testid | `privacy-switch-topbar` |
| Text | none (icon only) |
| Icon | as the sidebar item |
| Name | `aria-label` equal to the sidebar item's text |
| Pressed state | `aria-pressed` as above |
| Place | in the top bar's trailing section, before Add; exists only while the navigation is a drawer (the header is `lg:hidden`) |

## 4. Where the state can change from

The control shows, and may change, the one `privacyMode` preference. These routes already exist and stay as they are; each flips the same preference, so the control always follows:

| Route | Changes it | Control follows |
|-------|-----------|-----------------|
| The sidebar item or the top-bar button | yes | itself and the other |
| Settings → Appearance → Privacy | yes | yes |
| Keyboard shortcut (browser listener, desktop action) | yes | yes |
| Command palette commands | yes | yes |

## 5. Announcing

`PrivacyProvider` says, in its polite status region, `privacy.announce.on` ("Privacy mode on") or `privacy.announce.off` ("Privacy mode off") when the preference changes (not on the first render), whichever route changed it. The reveal messages are unchanged.

## 6. Locked and signed out

Both components are mounted inside the unlocked shell (`PaletteHostLazy` and the privacy key listener already are). The lock screen and the pages before sign-in render neither.

## 7. Text

New in `en.json`, `uk.json`, `pl.json`: `privacy.switch.on`, `privacy.switch.off`, `privacy.announce.on`, `privacy.announce.off`. Removed (unused after this change): `privacy.indicator.on`, `privacy.indicator.hint`, `privacy.mode.label`. The catalogue completeness test enforces all three languages.

## 8. Removed

`ui/privacy/PrivacyIndicator.tsx` and the testid `privacy-indicator`; the old behavior of showing nothing while the mode is off.
