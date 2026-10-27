# Contract: web app manifest

File: `apps/web/public/manifest.webmanifest`, served from the origin root (`manifest-src 'self'`).

| Member | Value | Why |
|---|---|---|
| `id` | `/` | A stable identity, so a later change to `start_url` does not create a second install. |
| `name`, `short_name` | `Cashfold` | The brand, the same in every language (spec 004). |
| `description` | One English sentence | Shown by some install UIs. |
| `lang`, `dir` | `en`, `auto` | One manifest, one language; the app's own screens are localised. |
| `start_url`, `scope` | `/`, `/` | Unchanged. |
| `display` | `standalone` | Unchanged. |
| `display_override` | `["standalone"]` | Explicit. |
| `categories` | `["finance"]` | For store-like listings. |
| `background_color`, `theme_color` | See research R6 | The splash and, where honoured, the title bar. |
| `icons` | The four existing, including `maskable` | Unchanged. |
| `shortcuts` | Six: New transaction `/transactions/?new=expense`, Overview `/overview/`, Transactions `/transactions/`, Accounts `/accounts/`, Plan `/plan/`, Settings `/settings/` | FR-011. |

Rules (tested by a unit test over the file): valid JSON; every icon file exists in `public/`; every shortcut URL is inside `scope` and is a route of the app (`routes.ts`); no URL carries an account, a name or an amount; `maskable` icon has the safe zone; no member points to another origin.
