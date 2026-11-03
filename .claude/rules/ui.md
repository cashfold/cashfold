---
paths:
  - "apps/web/src/ui/**/*"
  - "apps/web/src/app/**/*"
  - "eslint-rules/ui-kit-boundaries.js"
---

# Web interface

Layout of `apps/web/src/ui/` is in `docs/ARCHITECTURE.md` ("The interface layer"). The app is a
**client-only static export**: no server components, server actions or API routes that touch user
data.

## The kit

- `apps/web/src/ui/kit/` is the only place Catalyst-derived and Headless UI code lives. Screens
  import from `@/ui/kit` only. Do not edit the vendored kit files for a one-off need; add a wrapper.
- Lint (`ui-kit/*` in `eslint.config.js`) rejects: Headless UI imports outside the kit, bare
  `button`, `input`, `select`, `textarea` (hidden and file inputs are allowed), and a `name` prop on a
  Headless-based control (it renders a hidden input, which breaks the strict CSP and Trusted Types;
  hold state in React and submit from the screen).
- The app draws no emoji: use the line icons (`no-emoji.test.ts` reads source and catalogues).
- Desktop-only styling belongs in `apps/desktop/src/main/native-feel.ts`, never in the web app
  (`native-feel-not-in-web.test.ts`).

## Behaviour that must hold

- Works fully offline and never blocks on the network (constitution VII). Network work queues or
  fails gracefully.
- Keyboard operable, visible focus, and no axe violations (`e2e/a11y.spec.ts` asserts WCAG 2.2 AA).
- Right-to-left safe: use logical properties (`ms-*`, `me-*`, `ps-*`, `start`, `end`), not `left` or
  `right`. `logical-layout.test.ts` and the `rtl` Playwright project catch regressions.
- Long text must not clip or overflow: messages can be about 40 percent longer in other languages
  (the `pseudo` project checks this).
- No third-party scripts, fonts from CDNs, analytics or session replay. The CSP is strict
  (`ux-csp.spec.ts`), so no inline scripts and no `eval`.
- Device-local presentation state lives in `localStorage` key `cashfold.ui`, parsed defensively
  (`ui/prefs`), never synced or exported. The UI thread holds no key material.
- Privacy mode must cover every place an amount or name is shown; new screens that show money go
  through the shared `Amount` component in the kit.
- Which optional fields the add form shows is decided by the field registry
  (`ui/prefs/fields.ts`), not by ad-hoc conditions in the form.
