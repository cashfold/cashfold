# Contract: UI Kit (`apps/web/src/ui/kit`)

**Spec**: FR-039 to FR-044, FR-049 | **Research**: R-UX-01, 02, 03, 04, 05, 06, 07

The only place Catalyst-derived code lives. The rest of the UI imports from `ui/kit` (a barrel) and nowhere else. See R-UX-01 for the licence handling.

## 1. Directory

```text
apps/web/src/ui/kit/
├── LICENSE-TAILWIND-PLUS.md      # terms + note that these files are not covered by the repository's AGPL grant
├── index.ts                       # the barrel; the only public import path
├── button.tsx  input.tsx  textarea.tsx  select.tsx  checkbox.tsx  radio.tsx  switch.tsx
├── fieldset.tsx                   # Field, Label, Description, ErrorMessage, FieldGroup, Fieldset, Legend
├── listbox.tsx  combobox.tsx  dropdown.tsx
├── dialog.tsx                     # Dialog + `placement` extension (see 3)
├── alert.tsx  badge.tsx  avatar.tsx  divider.tsx  heading.tsx  text.tsx  link.tsx
├── table.tsx  pagination.tsx  description-list.tsx
├── navbar.tsx  sidebar.tsx  sidebar-layout.tsx  stacked-layout.tsx  auth-layout.tsx
└── (extensions authored here, not from the kit)
    ├── sheet.tsx                  # bottom-sheet/dialog responsive wrapper
    ├── disclosure.tsx             # "More details" and collapsible sections
    ├── tabs.tsx                   # segmented tab control
    ├── stat.tsx                   # headline figure tile
    ├── empty-state.tsx
    ├── status-message.tsx         # brief polite live-region confirmation (FR-013), driven by shell/StatusProvider
    ├── amount.tsx                 # monetary amount display (tabular, sign, currency)
    ├── progress.tsx               # progress bar with text status
    ├── chip.tsx                   # removable filter chip
    └── icons.ts                   # re-exports of the Heroicons used (named, so tree-shaken)
```

## 2. Allowed dependencies

| Package | Version policy | Licence | Purpose |
|---|---|---|---|
| `@headlessui/react` | exact pin (2.2.x) | MIT | accessible behaviour for dialog, menu, listbox, combobox, switch, checkbox, radio, tabs, disclosure |
| `clsx` | exact pin | MIT | class-name composition |
| `@heroicons/react` | exact pin | MIT | icon set (named imports only) |
| `@fontsource/ubuntu` | exact pin, **devDependency** | UFL-1.0 | source of the unmodified font files copied at build |
| ~~`motion`~~ | **not adopted** | | replaced by a CSS current-item marker (R-UX-02) |

Each new dependency passes `pnpm audit`, the licence script (UFL via a documented asset exception), the SBOM and the lockfile gates before merge.

## 3. Changes made when porting kit files

1. **Logical utilities.** Replace every physical utility (`ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`border-l`/`rounded-l`…) with its logical equivalent. `ui/logical-layout.test.ts` must pass over `ui/kit/` unchanged.
2. **No `motion`.** In `navbar.tsx` and `sidebar.tsx` delete the `LayoutGroup`/`motion.span` and render a plain `<span>` with the same classes, shown when `current`; its colour transition uses `motion-safe:`.
3. **Link.** Implement `link.tsx` with Next's `Link` (the kit's own file has a TODO for this), keeping `DataInteractive` wrapping for focus styling.
4. **Dark variant.** Do not rely on `prefers-color-scheme` for `dark:`; use the attribute-driven custom variant (R-UX-05).
5. **Accent.** Remove the kit's `emerald`/`zinc` button colour map in favour of a `primary` colour defined by tokens (R-UX-06). All other colour variants are kept only if used.
6. **No `name` on Headless inputs** (R-UX-03). `Switch`, `Checkbox`, `Radio`, `Listbox`, `Combobox` wrappers drop the prop from their types.
7. **Dialog `placement`.** `dialog.tsx` gains `placement: 'center' | 'sheet'`. `sheet` anchors the panel to the bottom edge with rounded top corners below `sm`, and centres it from `sm` up; the panel has `max-h-[100dvh]`, scrolls its body, and keeps its footer sticky.
8. **Forced colours.** Keep the kit's `forced-colors:` classes; add focus and state outlines where the kit relies on colour alone.
9. **Unused files.** Delete kit components the app does not use (initially: none of the listed ones, but `pagination.tsx` and `table.tsx` are dropped if the list view does not need them after WS5).
10. **Header.** Each ported file starts with a comment: `Derived from Catalyst (Tailwind Plus). Licence: ./LICENSE-TAILWIND-PLUS.md`.

## 4. Component API additions (authored)

```ts
// sheet.tsx
<Sheet open onClose title description? footer? size?: 'sm'|'md'|'lg'>…</Sheet>
// disclosure.tsx
<Disclosure title summary? defaultOpen? onOpenChange?>…</Disclosure>
// tabs.tsx
<Tabs value onChange items=[{value,label,count?}] label="…">…</Tabs>
// stat.tsx
<Stat label value tone?: 'gain'|'loss'|'neutral' hint? />
// amount.tsx
<Amount minor currency locale tone? showSign? />   // tabular-nums, explicit minus, never colour alone
// progress.tsx
<Progress value max label statusText tone />       // role=progressbar + visible text
// chip.tsx
<Chip label onRemove removeLabel />
// empty-state.tsx
<EmptyState icon title body action? />
// status-message.tsx (via shell/StatusProvider)
const { notify } = useStatus();  notify('ledger.saved', { what })   // role=status, ~4 s, dismissible, no undo
```

All strings come from the i18n catalogue through props. Components contain no user-visible literals.

## 5. Tokens

`apps/web/src/app/tokens.css` remains the single source (R-UX-05, R-UX-06):

| Token group | Light | Dark |
|---|---|---|
| `--bg`, `--surface`, `--text`, `--text-muted` | white / zinc-50 / zinc-950 / zinc-600 | zinc-950 / zinc-900 / zinc-50 / zinc-400 |
| `--primary`, `--on-primary` | emerald-700 / white (5.48:1) | emerald-500 / zinc-950 (7.84:1) |
| `--accent-text` (links) | emerald-700 | emerald-400 |
| `--focus` | emerald-600 | emerald-400 |
| `--danger`, `--success`, `--warning` | existing AA values re-checked | existing AA values re-checked |
| `--border-strong` | existing | existing |
| `--radius` | `0.5rem` (kit: `rounded-lg`) | same |
| font | `--font-sans: Ubuntu, system-ui, sans-serif` | same |

`tokens.test.ts` is extended to the new keys and keeps the 4.5:1 text and 3:1 non-text rules in both themes.

## 6. Quality gates specific to the kit

| Gate | Rule |
|---|---|
| RTL | `logical-layout.test.ts` covers `ui/kit/` |
| Names | A lint rule forbids importing `@headlessui/react` outside `ui/kit/` |
| No raw controls | A lint rule (new, in `eslint-rules/`) flags `<button>`, `<input>`, `<select>`, `<textarea>` outside `ui/kit/` except in a short allow-list (native file input, hidden inputs) |
| CSP | No `style=` in prerendered HTML; no `name` on Headless inputs; no CSP violation in e2e |
| Budget | `check:bundle` with the new budgets; prints the kit's share |
| Licence | Notices updated; UFL file shipped next to the font |
