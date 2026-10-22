# ADR-0008: The interface is built on a vendored Catalyst kit

- Status: accepted
- Date: 2026-10
- Decides: research.md R-UX-01, R-UX-02, R-UX-05, R-UX-10 of `specs/002-ux-redesign-catalyst`

## Context

The first release had a working but plain interface: twelve navigation entries, forms with up to fifteen fields, and one-off controls on every screen. The redesign (spec 002) replaces it with five sections, a short add flow, themes and a consistent look, without touching the domain, the wire protocol, the database or the Core Worker (FR-048).

## Decisions

1. **A vendored kit in one directory.** The components come from the Catalyst UI kit (Tailwind Plus) and live in `apps/web/src/ui/kit/`, next to `LICENSE-TAILWIND-PLUS.md`. Those files are used under the Tailwind Plus License as part of an open-source End Product and are not covered by the repository's AGPL grant; every ported file carries a header saying so. The rest of the interface imports only from `ui/kit/index.ts`, and lint rules (`eslint-rules/ui-kit-boundaries.js`) forbid importing Headless UI elsewhere, bare `<button>`, `<input>`, `<select>`, `<textarea>`, and a `name` prop on Headless controls. If the licence ever stops fitting, the kit can be replaced by changing that one directory. The project owner confirmed the licence on 2026-10-20 (research.md R-UX-01).
2. **No `motion`.** The kit's animated current-item marker pulled in about 46 KiB gzipped. It is replaced by a plain element with a colour transition under `motion-safe`.
3. **Themes are an attribute.** `<html data-theme="light|dark">` is set by a small inline script before first paint (its hash is added to each page's Content-Security-Policy by `harden-html.mjs`), and `dark:` utilities follow the attribute, not the operating system. The choice lives in `localStorage` (`cashfold.ui`), together with other device-local presentation preferences (data-model.md §1). Nothing there is financial; the leak scan allows exactly that key and validates its shape.
4. **No `style=` attributes in prerendered HTML.** `style-src 'self'` stays; the build fails if an exported page carries a `style=` attribute. Headless controls never receive `name`, which would render a hidden input.
5. **Overlays follow the lock and the privacy cover.** Dialogs live in the layer Headless UI creates at the end of `<body>`. While the privacy cover shows, that layer is made inert and hidden but stays mounted so typed values survive; on lock the signed-in shell unmounts, which closes every overlay and discards its state without an unsaved-changes prompt.
6. **Release.** The work lands through small pull requests into the long-lived branch `002-ux-redesign-catalyst` and is released to `main` once, with the old interface deleted. The project owner accepted the rollup pull request as a release step on 2026-10-20.

## Consequences

- The initial bundle grows (the shell, the kit and Headless UI are in it); the budgets in `scripts/check-bundle-size.mjs` are reset from the final measurement (tasks.md T114).
- The Ubuntu font is bundled (`@fontsource/ubuntu`, UFL-1.0, copied unmodified with its licence into `public/fonts/` by `apps/web/scripts/copy-fonts.mjs`), so no request leaves the origin and offline use looks the same.
- The vendored files are third-party UI code in the client: they are listed in `THIRD_PARTY_NOTICES.md` and in the threat model's residual risks.
