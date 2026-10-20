# Research: Calm, Task-Focused UX and Design-System UI

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-20

Each entry gives the decision, why, and what was rejected. IDs are `R-UX-n` so they do not collide with `R-n` in [spec 001's research](../001-secure-finance-core/research.md). Entries marked **MEASURED** come from a spike run for this plan (esbuild bundles of the real Catalyst files with Headless UI 2.2.10, gzip -9, React external). **Reference** entries cite [docs/reference/reference-app](../../docs/reference/reference-app/) and are interaction ideas only.

## Unknowns resolved

There were no `NEEDS CLARIFICATION` markers in the spec. The technical unknowns the spec left open were the licence, size, CSP, RTL, contrast, theming, font delivery and routing. They are resolved below.

---

### R-UX-01 — Tailwind Plus licence vs. this repository (GATE)

**Finding.** The kit ships `demo/typescript/LICENSE.md` (Tailwind Plus License). Relevant terms:
- Allowed: "End Products that are open source and freely available to End Users", and, as an allowed example, a free open-source web application "where the primary purpose is clearly not to simply re-distribute the components … where the source code is publicly available".
- Derivatives ("modify the Components … to create derivative components") are **subject to the same licence**.
- Not allowed: re-distributing the components or derivatives **separately from an End Product**, publishing a repository of components, building a kit or starter template from them.
- Personal licence: one named individual. Team licence: up to 25 employees and contractors of one business, and End Products must be the property of the licensee or its clients.
- This repository is AGPL-3.0 (`LICENSE`). AGPL grants every recipient the right to copy and redistribute all files, which does not match a proprietary licence on some files.

**Decision.**
1. Using Catalyst inside Cashfold is **permitted** (open-source End Product, not a UI kit).
2. The Catalyst-derived files live in **one isolated directory**, `apps/web/src/ui/kit/`, with a `LICENSE-TAILWIND-PLUS.md` beside them and an entry in `THIRD_PARTY_NOTICES.md`. They carry a header comment stating that they are under the Tailwind Plus License and are not covered by the repository's AGPL grant.
3. The rest of the UI imports only from the `ui/kit` barrel and never copies kit code elsewhere, so the kit can be swapped or removed by changing one directory.
4. **Phase 0 go/no-go (plan item WS0-1):** the project owner confirms (a) they hold a licence that covers every committer, and (b) the isolation scheme above is acceptable to Tailwind Labs. A short email to `support@tailwindcss.com` (the licence's own contact) is the recommended way to get written confirmation. The task cannot be completed by an engineer alone.
5. **Fallback if refused:** author the same component set independently on Headless UI (MIT) and Tailwind, using the design tokens and the contracts in `contracts/ui-kit.md`, with no Catalyst source copied. This costs about 1.5× the kit work. The barrel boundary in step 3 is what makes this swap cheap.

**Alternatives rejected.** Copying the kit throughout `src/ui` (no boundary, hard to remove). Keeping the kit out of git (breaks reproducible builds and the build-verify gate).

**Not legal advice.** The above reads the licence text as shipped. It does not replace the confirmation in step 4.

---

### R-UX-02 — Bundle budget and the `motion` dependency (MEASURED)

**Finding.** The existing budgets (research R-12) are tight: initial JS 270 KiB gz (measured 254.5, headroom ≈ 15 KiB) and lazy/worker JS 280 KiB gz (measured 266.0, headroom ≈ 14 KiB). Measured cost of the kit, gzip -9, React external:

| Set | gzip |
|---|---|
| Primitives (button, input, fieldset, text, heading, badge, divider, link) | 12.8 KiB |
| + dialog, alert | 26.2 KiB |
| All components used by this plan (adds dropdown, listbox, select, switch, checkbox, radio, textarea, table, sidebar, sidebar-layout, navbar, stacked-layout, auth-layout, avatar, description-list, pagination) | 58.4 KiB |
| Whole kit, with `motion` stubbed | 75.7 KiB |
| `motion/react` alone (`LayoutGroup` + `motion`) | ≈ 45.9 KiB |

Only `navbar.tsx` and `sidebar.tsx` use `motion`, for one thing: a `layoutId` indicator that slides between the current nav items.

**Decision.**
- **Drop `motion` entirely.** Replace the sliding indicator with a static current-item marker (a CSS class on the active item, with a short colour transition that respects reduced motion). This saves ≈ 46 KiB gz of a ≈ 105 KiB addition and loses only a decorative animation.
- Keep `@headlessui/react` and `clsx` (both required by every interactive component) and add `@heroicons/react` (MIT, per-icon named imports, ≈ 0.3 KiB each) for icons.
- **Budget change.** The new components cost roughly 58 KiB gz in total, which exceeds the headroom. The budgets are re-set by the rule 001 used: **measurement plus ≈ 6 %**, measured at the end of the feature, never set in advance. Expected result: initial ≈ 290–305 KiB, lazy ≈ 290–300 KiB. A hard ceiling of **+70 KiB gz combined** over the 001 final measurement (254.5 + 266.0 KiB) is recorded as the test: if the final measurement exceeds it, the work reverts to native `Select` for pickers, drops Combobox, and defers Table/Pagination styling.
- Keep initial JS small by loading the overlay-heavy parts (Dialog, Dropdown, Combobox, the add sheet, Filters panel) from lazily loaded chunks. Next's route-level splitting already separates screens. The shell (sidebar-layout, navbar, button, link) is the only kit code in the initial chunk.
- `scripts/check-bundle-size.mjs` gets the two new numbers and one added line printing the kit's share (plan item WS8-3).

**Alternatives rejected.** Keeping `motion` (+46 KiB for a decorative effect). `LazyMotion`/`m` (still ≈ 31 KiB). Replacing Headless UI with native `<dialog>`/`<select>` everywhere (violates FR-039 and loses the tested accessible behaviour of menus and comboboxes).

---

### R-UX-03 — Content-Security-Policy and Trusted Types compatibility

**Finding.** The CSP is `style-src 'self'` (no inline styles, no `'unsafe-inline'`), `script-src 'self'` plus build-time inline script hashes, and `require-trusted-types-for 'script'`. `harden-html.mjs` hashes inline scripts and adds SRI.
- `style=""` **attributes in prerendered HTML** are blocked by this policy. Styles set from script through the CSSOM (React's `style` prop on the client) are allowed.
- Headless UI renders `style` attributes in a few places: floating panels (set on the client when open: fine), and the `Hidden` helper that backs form-associated inputs for `Switch`, `Checkbox`, `Radio`, `Listbox` and `Combobox` **when a `name` prop is passed**.
- Catalyst's Dialog, Dropdown, Combobox and Listbox render into a portal that Headless UI creates at runtime. This is client-only and not in the static HTML.

**Decision.**
- Never pass `name` to Headless UI inputs. The app has no native form posts (`form-action 'none'`), so it does not need them. A lint rule (an `eslint-rules/` entry) bans `name` on these kit components.
- Add a CI check to `scripts/` that fails if any prerendered `out/**/*.html` contains a `style=` attribute.
- Add a Playwright fixture that fails any test on a `securitypolicyviolation` event or a Trusted Types violation, so every e2e journey doubles as a CSP test (plan item WS8-3).
- No inline `<style>`. Tailwind's output is a single hashed CSS file (as today).
- The theme bootstrap needs an inline script (R-UX-05). `harden-html.mjs` already hashes inline scripts, so no policy change is needed. Add a test that the script's hash is present in every page's CSP meta.

---

### R-UX-04 — Right-to-left lint vs. Catalyst's physical utilities

**Finding.** `ui/logical-layout.test.ts` (FR-095 of spec 001) fails any `ml-/mr-/pl-/pr-/left-/right-/text-left/rounded-l…` in `src/ui`. Catalyst uses them in `combobox`, `listbox`, `dropdown`, `navbar`, `sidebar`, `button` (e.g. `pr-`, `pl-`, `ml-`, `text-left`, `right-0`, `-ml-4`, `left-1/2`).

**Decision.** When the files are brought into `ui/kit/`, **port each physical utility to its logical equivalent** (`ps-`/`pe-`/`ms-`/`me-`, `start-`/`end-`, `text-start`, `rounded-s-`/`rounded-e-`); the existing test then guards the port for free and continues to apply to `ui/kit/`. The centring idiom `left-1/2 -translate-x-1/2` becomes `inset-x-0 mx-auto` or `start-1/2 -translate-x-1/2 rtl:translate-x-1/2`. Do not exempt `ui/kit/` from the test. A port checklist is in `contracts/ui-kit.md`.

---

### R-UX-05 — Theming: Light / Dark / System without a flash

**Finding.** `tokens.css` switches only with `@media (prefers-color-scheme: dark)`. Catalyst uses Tailwind's `dark:` variant (media-based by default in v4) with zinc/white utilities. The spec needs a manual override (FR-041) and no flash.

**Decision.**
- Declare `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` so `dark:` follows an attribute, not the media query.
- A tiny inline script in `<head>` (hashed by `harden-html.mjs`) reads the stored choice and sets `data-theme` on `<html>` before first paint: `light`, `dark`, or, for `system`, the result of `matchMedia`. A `change` listener keeps `system` live.
- The stored choice lives in `localStorage` under `cashfold.ui` (R-UX-08), wrapped in try/catch with a fallback to `system`.
- `color-scheme` is set on `<html>` so native controls and scrollbars match.
- The semantic tokens in `tokens.css` (`--bg`, `--text`, `--danger`, `--success`, `--warning`, `--focus`, `--border-strong`) stay, because many screens use them and the gain/loss/warning cues depend on them. Their values move to the emerald/zinc scale and they are re-keyed to `[data-theme]` instead of the media query. `tokens.test.ts` is updated to read both blocks and keeps asserting WCAG 2.2 AA pairs.

---

### R-UX-06 — Accent colour: the kit's `emerald` button fails AA (MEASURED)

**Finding.** Computed contrast ratios (WCAG relative luminance):

| Pair | Ratio | Verdict |
|---|---|---|
| white on emerald-600 (Catalyst's `emerald` button background) | 3.77 | **fails** 4.5:1 for normal text |
| white on emerald-700 | 5.48 | passes |
| emerald-700 text on white (links) | 5.48 | passes |
| zinc-950 text on emerald-500 | 7.84 | passes |
| emerald-500 text on zinc-900 / zinc-950 (dark links) | 6.98 / 7.84 | passes |
| emerald-400 text on zinc-900 | 9.22 | passes |

**Decision.** Do **not** use the kit's built-in `emerald` button colour. Define the primary button as a token pair: light = emerald-700 background with white text, dark = emerald-500 background with zinc-950 text. Links and accents: light emerald-700, dark emerald-400. Focus rings use emerald-600 (3:1 non-text) in light and emerald-400 in dark. `tokens.test.ts` asserts these pairs so a palette edit cannot regress them. Gain/loss/warning stay on the existing semantic colours plus a text or sign cue (FR-042).

---

### R-UX-07 — Typeface: Ubuntu, bundled

**Finding.** Ubuntu is under the **Ubuntu Font Licence 1.0 (UFL)**, which permits bundling and redistribution but requires the licence text to accompany the font and forbids modified versions under the same name. `scripts/check-licenses.mjs` allow-lists permissive licences and scans production dependencies only. The CSP already has `font-src 'self'`.

**Decision.**
- Add `@fontsource/ubuntu` (exact-pinned) as a **devDependency** and copy the needed `woff2` files into `apps/web/public/fonts/` in `prebuild`, the same way the SQLite and SRP wasm are copied. The files are used **unmodified** (UFL's modified-version clause does not apply).
- Weights: 400, 500, 700, normal style only. Subsets: `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek` via `unicode-range` `@font-face` rules, so a page downloads only the subsets its text needs. `font-display: swap`. Preload only the Latin 400 and 500 files.
- Add the UFL text and an entry to `THIRD_PARTY_NOTICES.md` (the generator `gen-third-party-notices.mjs` is extended to include the font), and add `UFL-1.0` to the licence script as a **reviewed asset exception** with the reason, not to the general allow-list.
- Font stack: `Ubuntu, system-ui, sans-serif`. Scripts Ubuntu lacks (CJK, Arabic, Hebrew, …) fall back to the system font (accepted in the spec). Numerals use `font-variant-numeric: tabular-nums` for amounts (FR-042).
- Fonts do not count against the JS budgets, but a new check records the total font bytes shipped.

**Alternatives rejected.** Self-converting from the Ubuntu release (a modification, plus a build tool). Loading from Google Fonts (violates FR-049).

---

### R-UX-08 — Where interface preferences live

**Finding.** Device-local lock settings are in IndexedDB behind `DeviceSettingsPort` (async, used inside the Core Worker). Interface preferences must be readable **synchronously before first paint** (theme) and by UI code, contain no financial content, and are never synced or exported (FR-051).

**Decision.** A small `ui/prefs` module over `localStorage` (key `cashfold.ui`, one JSON object with a `v: 1` version). Reads are parsed defensively with a schema and fall back to defaults on any error. Writes are try/catch. A `useSyncExternalStore` hook gives React components live values, and the `storage` event keeps other tabs in step. It does **not** go through the Core Worker, the encrypted store or the sync layer. The plaintext-leak scan is updated to allow only this key and to assert that it holds none of: amounts, names, ids, emails. Schema in `data-model.md`.

---

### R-UX-09 — Routing, redirects and the static export

**Finding.** The app is a static export with `trailingSlash: true`. There is no server to issue 301s, and the service worker pins files. Old addresses are `/dashboard/`, `/transfers/`, `/budgets/`, `/schedules/`, `/goals/`, `/categories/`, `/data/`, `/devices/`, `/folds/`. `/add/` is the add-device flow.

**Decision.** New routes: `/overview/`, `/transactions/`, `/accounts/`, `/plan/`, `/settings/…` (sub-routes per group). Each old address stays as a tiny **redirect page** (a client component that calls `router.replace` to the new route, preserving query parameters such as `?account=`, plus a `<noscript>` link). A table in `contracts/routes.md` is the single source of truth and a unit test asserts every old route has a target that exists. The service worker's precache list is regenerated by the existing build. `/` for an unlocked person redirects to `/overview/`. Deep linking into a sheet uses a query flag (`?new=expense|income|transfer`) that opens the add sheet over the page, so the add flow is addressable and the Back button closes it.

**Alternatives rejected.** Host-level `_redirects` only (not all self-hosters use a host that reads them, per `docs/self-hosting.md`). Keeping old pages alive as duplicates (violates FR-054).

---

### R-UX-10 — Overlays when the app is covered or locked

**Finding.** `AppShell` marks the content wrapper `inert` when `core.covered` and shows `PrivacyCover`. Headless UI portals dialogs to `#headlessui-portal-root` on `<body>`, **outside** that wrapper, so an open sheet would stay visible and focusable under the cover. This is a privacy regression risk that the spec lists as an edge case.

**Decision.** A single `OverlayHost` in the shell owns a counter of open overlays. When `core.covered` becomes true, the host (a) sets `inert` and `aria-hidden` on the portal root, and (b) leaves overlay React state mounted, so a half-written form survives a short cover and is restored on uncover. On **lock** (not mere cover) all overlays are closed and their state discarded, because the keys are gone. A Playwright test covers both. Unsaved-changes confirmation is **not** shown for the automatic lock close, to avoid an interaction on a hidden screen. This is consistent with spec 001's lock behaviour.

---

### R-UX-11 — Navigation shell design

**Reference.** The reference app has five top-level sections (accounts, transactions, plan, report, settings) with three layouts, a floating add button and a drawer ([01 §1.3–1.5](../../docs/reference/reference-app/01-navigation-and-screens.md)). It is mobile-first, with a tab bar on phones.

**Decision.** Use Catalyst `SidebarLayout` (sidebar on `lg+`, off-canvas drawer below) as the base, with five entries: Overview, Transactions, Accounts, Plan, Settings. The sidebar header holds the Fold switcher (a `Dropdown`), and the sidebar footer holds sync status and Lock. On phone widths the navbar shows the page title, the sync dot and an **Add** button (always present: FR-007), with the drawer reachable from a menu button. A bottom tab bar was considered (it matches the reference's tab layout and thumb reach) but is rejected for the first release: it needs a second layout, safe-area handling and a fifth-tab-plus-add pattern. The drawer + persistent Add satisfies FR-003 and FR-007 at lower cost, and a bottom bar can be added later without touching screens.

---

### R-UX-12 — Add-transaction sheet and the form model

**Reference.** The reference editor lets the user choose which fields show and set defaults ([01 §4.5–4.6](../../docs/reference/reference-app/01-navigation-and-screens.md)); amount entry uses its own keypad.

**Decision.**
- One `AddSheet` component: bottom sheet below `sm`, centred dialog from `sm` up (both are the same Headless Dialog with different placement classes). The footer holds the primary action and stays above the on-screen keyboard (using `dvh` units and `env(keyboard-inset-height)` where supported, with a sticky footer as the fallback).
- A **form field registry** (`contracts/form-fields.md`) classifies every field of every form as essential, optional or technical (FR-009). Visibility is computed by one pure function `visibleFields(form, prefs, existingValues)`, which is unit-tested and returns hidden-but-filled fields as visible (the spec's edge case).
- Remembered "More details" open/closed state and which optional fields are on by default come from `ui/prefs`.
- The native on-screen numeric keyboard (`inputMode="decimal"`) is used for the amount. A custom keypad is **not** built, since the spec rejected expressions and the reference keypad exists mainly for them.
- Defaults (FR-022): last-used account and recently used categories come from a small `recents` list in `ui/prefs` holding **ids only** (no amounts, no names). Ids are Fold-scoped and pruned when they no longer exist. If this proves too weak a signal, a query-side "most used" can be added later (not in scope).
- Place entry becomes: a name field plus "Use my location"; latitude/longitude move under an "Exact coordinates" disclosure.

**Alternatives rejected.** Building a custom keypad (not needed after Q1). Server-side or synced defaults (violates FR-051).

---

### R-UX-13 — Overview composition

**Reference.** The reference's main screen has a period selector, four headline tiles (income, expenses, period balance, current balance) and the list; the report screen offers chart + breakdown with drill-down ([01 §3, §4.10](../../docs/reference/reference-app/01-navigation-and-screens.md); rules in [02 §3.4](../../docs/reference/reference-app/02-data-model-and-rules.md)).

**Decision.** `OverviewScreen` shows: period `Listbox` (Today… All time, Custom opens a small `Dialog` with two date inputs), four stat tiles (Income, Expenses, Net, Total balance), then collapsible `Disclosure` sections (By category, By tag, Trend, Balance over time, Accounts) with a one-line summary when collapsed. Rare toggles (adjustments, transfers) move into an Options `Dropdown`, and a text note under the tiles appears when either is non-default. Breakdown rows link to `/transactions/?category=…&from=…&to=…`. The data comes from the **existing** `ledger.*` queries; no worker or core change. Charts stay as the current accessible SVG/table pair, restyled.

---

### R-UX-14 — Transaction list: grouping, filters, paging

**Reference.** The reference groups by day with an optional daily summary and puts filters behind one control with an "applied" indicator ([01 §3, §4.14](../../docs/reference/reference-app/01-navigation-and-screens.md)).

**Finding.** `TransactionsScreen` already (a) asks the worker for `ledger.transactions` with `sort: date_desc` and `page: { limit, offset: 0 }` and a "load more" `limit`, (b) groups the loaded rows by `localDate`, (c) debounces search by 200 ms, (d) seeds the account filter from `?account=`, and (e) shows a **needs-attention** panel and a **recently deleted** list with a Restore action.

**Decision.**
- Keep that data flow unchanged (FR-048). Restyle the day groups into sticky headings with a day net total computed from the rows already loaded in that group; a group cut off by paging shows its total only for loaded rows and is marked "partial" until the next page arrives (so a displayed total is never silently wrong).
- Keep incremental paging. Add list windowing (render only visible rows plus overscan, with a small in-house hook) **only if** the 10,000-row check in `quickstart.md` misses the 200 ms target; the default is the existing paging plus CSS `content-visibility: auto` on day groups.
- Move the nine filter inputs into a Filters panel (`Dialog` below `sm`, `Popover` above), and mirror applied filters in the URL query (`account`, `category`, `status`, `from`, `to`, `min`, `max`, `q`) so reload and Back work. Chips read from the same state. The min/max amount filters stay disabled until an account is chosen (as today, since an amount needs a currency); the panel says why.
- The needs-attention panel becomes a dismissible banner at the top of the list. "Recently deleted" becomes a secondary view reachable from the list header menu (not a permanently open section), with Restore unchanged.

### R-UX-15 — Plan section

**Reference.** The reference's Plan screen combines goals and budgets in one scrollable page with section headers and progress bars ([01 §4.15–4.18](../../docs/reference/reference-app/01-navigation-and-screens.md)).

**Decision.** `/plan/` hosts three views (Budgets, Goals, Schedules) in a Headless `TabGroup` styled as the kit's navbar-style segmented control, with the selected tab in the query (`?view=`) and mirrored in `ui/prefs` as the last used. Each view keeps its existing screen logic and queries, wrapped in the new layout. Items become cards with a progress bar and a text status (on track / near limit / over; in progress / reached / overdue). Existing screen files are moved, not rewritten, and their data hooks and commands are untouched.

---

### R-UX-16 — Testing strategy for a visual and IA change

**Finding.** The e2e suite navigates by link names ("Dashboard", …) and via the `Main` navigation landmark (`a11y.spec.ts` SCREENS list), and asserts `aria-current`, a single `<h1>`, landmarks and the skip link. The `rtl` project reruns every spec in Arabic.

**Decision.**
- Keep the stable hooks: one `<h1>` per page, `main#main`, `nav[aria-label="Main"]`, `aria-current="page"`, the skip link, and every `data-testid` already in use. Rename only where the IA changes, and update the specs in the same PR (FR-053).
- A test-only pseudo-locale `en-XA` (accented text about 40 % longer, ICU syntax preserved) is registered in `ui/i18n` and exercised by a `pseudo` Playwright project so FR-046's 40 % expansion rule is testable.
- New specs: `ux-shell.spec.ts` (5 entries, redirects, Fold switch, lock), `ux-add.spec.ts` (≤ 4 interactions, `More details` persistence, hidden-but-filled), `ux-overview.spec.ts`, `ux-list.spec.ts` (day groups, filter chips, row menu), `ux-theme.spec.ts` (no flash, persistence, forced-colours and reduced-motion media emulation), `ux-csp.spec.ts` (no violations across a journey), `ux-responsive.spec.ts` (320/768/1920 px and 200 % zoom, no horizontal page scroll).
- A **baseline recorder** (`e2e/bench/ui-baseline.spec.ts`) counts visible interactive controls per screen. It runs **first** (before any UI change) and its JSON output is committed as the SC-005 baseline.
- Unit tests, written first: `visibleFields`, prefs parse/migrate, route table, filter-chip serialisation, day grouping, windowing maths, contrast pairs.
- Usability outcomes (SC-001, 003, 004, 009, 012) are manual moderated sessions with a script in `quickstart.md`; they are release checks, not CI.

---

### R-UX-17 — Reference mapping decisions (adopt, adapt, decline)

Details per screen are in `contracts/screen-map.md`. Summary of what is deliberately **not** taken from the reference: its paid-tier gating and paywall, its own sync account screens, icon packs and app-icon pickers, widgets, the amount keypad with expressions, the classic/tabs/column layout trio, import column-assignment UX (Cashfold's import already exists and is out of scope for restyling beyond the shared components), and the dashboard "significant transactions" mode (rule unknown; not specified in 002).
