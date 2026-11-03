# Interface: kit, accessibility, right-to-left, offline

**Scope:** `apps/web/src/ui/**`, `apps/web/src/app/**`.

Follow `_contract.md`. The rules are in `.claude/rules/ui.md`; read them first.

- **The kit.** Screens import from `@/ui/kit` only: no Headless UI outside the kit, no bare `button`,
  `input`, `select` or `textarea`, no `name` on a Headless control, no emoji, no desktop-only styling in
  the web app. The kit's vendored files are not edited for a one-off need.
- **Keyboard and accessibility.** Every control is reachable and operable by keyboard, has a visible
  focus and an accessible name, and dialogs trap and return focus. Colour is never the only signal.
  Check that a change would not introduce an axe violation (WCAG 2.2 AA is a blocking e2e assertion).
- **Right-to-left and long text.** Logical properties (`ms-*`, `me-*`, `ps-*`, `start`, `end`), no
  `left` or `right`, no layout that breaks when text is 40 percent longer.
- **Offline first.** Nothing local waits on the network. A request that fails queues or reports plainly.
- **Privacy mode.** Anything that shows an amount, a name or a note goes through the privacy-aware
  component (the kit `Amount`) and is covered when privacy mode is on, including in titles, labels and
  the palette.
- **State.** One source of truth for a value; derived values computed during render; effects only for
  things outside React. Preferences are device-local (`cashfold.ui`), parsed defensively, never synced.
- **Forms.** Which optional fields show comes from the field registry (`ui/prefs/fields.ts`), not an
  ad-hoc condition. A field added to one of the add, transfer or schedule forms has a decision for the
  other two.
- **Keys and routes.** A new shortcut avoids clashing with the palette and privacy keys and appears in
  the help dialog; a new route goes in `ui/shell/routes.ts` and a retired one has a redirect stub.
