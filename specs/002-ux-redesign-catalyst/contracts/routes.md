# Contract: Routes, Navigation and Redirects

**Spec**: FR-001 to FR-006, FR-054 | **Research**: R-UX-09, R-UX-11

The app is a static export (`trailingSlash: true`). All routes end with `/`. Every route except the auth/recovery group requires an unlocked app (`RequireUnlocked`).

## 1. Primary navigation (exactly five entries, in this order)

| # | Label key | Route | Icon (Heroicons, outline) | Contains |
|---|---|---|---|---|
| 1 | `nav.overview` | `/overview/` | `HomeIcon` | headline figures, breakdowns, trend |
| 2 | `nav.transactions` | `/transactions/` | `ArrowsRightLeftIcon` | list, search, filters, needs-attention, recently deleted |
| 3 | `nav.accounts` | `/accounts/` | `BanknotesIcon` | accounts by type, groups, adjust balance |
| 4 | `nav.plan` | `/plan/` | `FlagIcon` | tabs: budgets, goals, schedules |
| 5 | `nav.settings` | `/settings/` | `Cog6ToothIcon` | grouped settings (below) |

`nav.label` remains `"Main"` (the `nav[aria-label="Main"]` landmark is relied on by tests). The current entry carries `aria-current="page"`. An entry is current for its route and all sub-routes.

Not navigation entries: the Fold switcher, sync status and Lock (shell, FR-005); the global **Add** action (FR-007).

## 2. Settings groups (at most seven)

| Group | Route | Replaces / contains |
|---|---|---|
| Profile and security | `/settings/profile/` | account details, password, email, quick unlock, auto-lock, Emergency Kit export, recovery |
| Appearance | `/settings/appearance/` | theme, optional add-form fields, reset interface settings |
| Categories | `/settings/categories/` | expense and income categories, tags, payees (merge, archive, reorder, delete) |
| Sync and devices | `/settings/sync/` | sync status/controls, devices list, add device (links to `/add/`) |
| Data and storage | `/settings/data/` | CSV import and export, backup, storage persistence |
| Folds and sharing | `/settings/folds/` | Folds list, create, delete, members, invitations |
| Advanced | `/settings/advanced/` | service address, storage diagnostics, notification amounts |

`/settings/` itself is a list of these seven groups with a one-line description each and no form controls (US7).

## 3. Other routes

| Route | Purpose | Layout |
|---|---|---|
| `/` | Unlocked: redirect to `/overview/`. Locked: unlock form. No account: sign-up link. | auth layout |
| `/sign-in/`, `/sign-up/`, `/recover/` | Authentication and recovery (existing) | auth layout |
| `/add/` | Add this device to an account (existing flow, entered from Settings → Sync and devices) | auth layout |

## 4. Query-string state

| Route | Parameter | Meaning |
|---|---|---|
| any unlocked route | `new` = `expense` \| `income` \| `transfer` | open the add sheet over the page (closing it removes the parameter) |
| `/transactions/` | `account`, `category`, `status` (`pending`/`posted`/`void`), `from`, `to` (`YYYY-MM-DD`), `min`, `max` (decimal text), `q` | applied filters; `account` is the pre-existing parameter |
| `/plan/` | `view` = `budgets` \| `goals` \| `schedules` | active tab |
| `/settings/*` | none | |

Unknown parameters are ignored. Invalid values are dropped without an error.

## 5. Redirects from previous addresses (FR-006)

Each old route is kept as a tiny client page that calls `router.replace(target)`, preserving the query string, and renders a `<noscript>` link. A unit test asserts that every row's target exists in the route table and that no old route renders its previous screen.

| Old route | New target | Notes |
|---|---|---|
| `/dashboard/` | `/overview/` | |
| `/transfers/` | `/transactions/?new=transfer` | list view of transfers is the filtered list; see below |
| `/budgets/` | `/plan/?view=budgets` | |
| `/goals/` | `/plan/?view=goals` | |
| `/schedules/` | `/plan/?view=schedules` | |
| `/categories/` | `/settings/categories/` | |
| `/data/` | `/settings/data/` | |
| `/devices/` | `/settings/sync/` | |
| `/folds/` | `/settings/folds/` | |
| `/transactions/?account=ID` | unchanged | existing parameter is still honoured |

**Transfers.** Transfers are created from the add sheet (type switch) and appear in the Transactions list with a "Transfer" badge and both accounts in the subtitle. The old transfers screen also held the manual **rate manager**; it moves to a "Exchange rates" panel reached from the add sheet (when a rate is needed, FR in US1 scenario 6) and from Settings → Advanced.

## 6. Shell regions

| Region | Wide (≥ `lg`) | Narrow (< `lg`) |
|---|---|---|
| Navigation | persistent sidebar | off-canvas drawer opened by a menu button |
| Fold name and switcher | sidebar header: the current Fold name is always shown; the switcher dropdown is offered only when the person has more than one Fold | at the top of the drawer, same rule |
| Sync status, Lock | sidebar footer | drawer footer; sync dot and Lock also in the top bar |
| Add | button in the page header and in the sidebar | persistent button in the top bar |
| Page title and actions | page header (`h1`) | top bar title (`h1` stays in the page, visually hidden when duplicated) |
| Skip link | first focusable element | first focusable element |
| Banners (removed, storage full, kit reminder, storage notice) | above the content, one at a time by priority | same |

Exactly one `<h1>` and one `<main id="main">` per page.
