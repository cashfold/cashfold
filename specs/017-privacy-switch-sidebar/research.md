# Research: Privacy Mode Switch in the Sidebar

What was found in the repository, the decision, and what else was considered.

## R1. What exists today

**Finding**: `ui/privacy/PrivacyIndicator.tsx` renders a `SidebarItem` only while the mode is on (it returns `null` otherwise), with the text "Privacy mode on" and a crossed-out eye; pressing it turns the mode off. It is lazy-loaded in `AppShell.tsx` and mounted in the sidebar footer above Help. The sidebar is one component rendered twice: statically for wide windows and again inside the drawer (`MobileSidebar`), so whatever is in the footer is in both. The top bar (`shell/Topbar.tsx`) is the `navbar` slot of `SidebarLayout`, which wraps it in a header that is `lg:hidden`, so it exists only on narrow windows.

**Decision**: reshape the indicator into an always-shown control, and put a compact copy in `Topbar`.

## R2. One state, no new data

**Finding**: the mode is the `privacyMode` preference. `usePrivacy()` returns `{ on, toggle, reveal }` and `toggle()` flips the preference and clears reveals. The Settings switch, the keyboard shortcut (browser listener and desktop action) and the palette commands all call it.

**Decision**: both new controls call `usePrivacy().toggle()` and read `on`. That alone keeps every route in step (FR-006, FR-011, FR-013) with no new state, event or subscription.

## R3. How the control is exposed

**Decision**: a toggle button. The sidebar item is a `SidebarItem` with `aria-pressed={on}` whose visible text is "Privacy mode: on" or "Privacy mode: off" and whose accessible name is that same text (so the name contains the visible text, WCAG 2.5.3), with an `Eye` icon when off and an `EyeSlash` icon when on. The icon is decorative (`aria-hidden`). The top-bar button is a `NavbarItem` with the icon only, `aria-pressed={on}`, and an `aria-label` equal to the same sentence ("Privacy mode: on" or "off"), so a screen reader reads the same thing in both places.

**Rationale**: the existing sidebar items are buttons; a labelled `aria-pressed` button is the standard accessible toggle and needs no new kit component. The state is in words and in the icon, never colour alone (FR-003).

**Alternatives considered**: `role="switch"` with a fixed name "Privacy mode" (rejected: the visible text includes the state, so the name would not contain it and axe flags `label-content-name-mismatch`, as the blurred-zeros work showed); the kit `Switch` inside the item (rejected: a second control inside a row that is already one, and the knob alone is colour and position, not words).

## R4. Where it sits, and the drawer

**Decision**: the sidebar footer, in the same section as Help and Lock, above Help (the indicator's place, so the footer's order does not change when the mode flips). Pressing it does not close the drawer: the drawer closes only through its own close button and the overlay signal, and `SidebarItem` does not, so the amounts visibly change underneath.

The top-bar button sits in the `NavbarSection` before the Add button, so the order is: page title, spacer, privacy, Add. At the narrowest width (320 px) the row is menu button, title, privacy, Add; the title already truncates (`truncate`), so nothing is pushed off. Both buttons keep the 44 px touch size (`min-h-11 min-w-11`) already used for Add.

**Alternatives considered**: putting it above Add in the sidebar header (rejected: that is where the Fold switcher and Add live, and a privacy switch is a utility, like Help and Lock); a floating button over the content (rejected: covers content and needs its own focus order).

## R5. Announcing a change

**Finding**: `PrivacyProvider` already has a polite `role="status"` region that says "Amount shown" and "Amounts hidden". A pressed button's `aria-pressed` change is announced by most screen readers when it has focus, but not when the mode changes from the shortcut, Settings or the palette.

**Decision**: add two messages, `privacy.announce.on` ("Privacy mode on") and `privacy.announce.off`, said by the same region when the preference changes (skipping the first render), so every route is announced (FR-004). The reveal messages stay as they are.

## R6. Strings

**Decision**: add `privacy.switch.on` ("Privacy mode: on"), `privacy.switch.off` ("Privacy mode: off"), `privacy.announce.on` and `privacy.announce.off` in English, Ukrainian and Polish. Remove `privacy.indicator.on`, `privacy.indicator.hint` and `privacy.mode.label`, which nothing uses after this change. Long translations: the sidebar item's label already truncates with the sidebar's own styles; the top-bar button is icon-only, so it has no text to overflow.

## R7. Bundle budget

**Finding**: the initial JavaScript is 374,069 of 374,784 bytes after spec 016.

**Decision**: the two components live in the existing lazy privacy chunk (the indicator and key listener are already lazy). `Topbar` imports the compact button through a `React.lazy` with a `Suspense` fallback of nothing, the same pattern as the other lazy parts, so the initial chunk gains only a few dozen bytes of import glue. Measure with `check:bundle` at the end; do not raise the budget. Removing the old indicator and its strings frees a little.

**Alternatives considered**: importing the button directly in `Topbar` (rejected: it would add the component to the initial chunk).

## R8. Tests that mention the old indicator

**Finding**: `e2e/ux-privacy-mode.spec.ts` asserts the indicator is absent while the mode is off (`toHaveCount(0)`) and present while on, by testid `privacy-indicator`; `apps/desktop/e2e/privacy.spec.ts` and `help.spec.ts` look for the same testid.

**Decision**: the testid becomes `privacy-switch` for the sidebar item and `privacy-switch-topbar` for the compact button; the "absent while off" checks become "shows off, `aria-pressed="false"`". These are test updates, not behavior to preserve.

## R9. Testing approach

**Decision**:
- Unit (server-rendered markup): both forms in both states: text, `aria-pressed`, `aria-label`, which icon, no colour-only difference, the testids.
- Browser (real Chromium, axe): both forms in light and dark; keyboard (Tab, Enter, Space) and focus kept after toggling; the sidebar item with a very long translated label stays inside the sidebar; the top-bar row at 320 px does not overflow and keeps the menu button and Add.
- E2E (web): the control shows "off" on every main screen without touching Settings, one press masks the amounts, the Settings switch and the shortcut follow it and it follows them, the drawer keeps open after pressing, the top-bar button works at a narrow width and is absent at a wide one, nothing shown while locked.
- Desktop e2e: the shortcut and the control agree.
