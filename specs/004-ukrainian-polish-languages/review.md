# Native-speaker review: Ukrainian and Polish

Status: **open** (spec SC-007). The first drafts are in the app; one native speaker per language reads every screen within one release cycle, and their corrections ship as ordinary updates. Mark each box when the reviewer has signed off, and record the issues they raise at the bottom.

How to see the text: set the browser language to `uk` or `pl`, or choose the language in Settings → Appearance; `pnpm --filter @cashfold/web dev` runs it locally. The text is in `apps/web/src/ui/i18n/messages/uk.json` and `pl.json`; the desktop menu is in `apps/desktop/src/main/menu-labels.ts`.

## 1. Decide first (a change later is a rename across the whole catalogue)

| Question | Proposal now | Ukrainian | Polish |
|----------|--------------|-----------|--------|
| The word for "Fold" (a private space with its own key, which can be shared) | Простір / Przestrzeń; the personal one is called Особистий / Osobista | [ ] ok  [ ] change to: | [ ] ok  [ ] change to: |
| "Schedule" (an entry the app creates on its due days) | Регулярна операція / Operacja cykliczna | [ ] ok  [ ] change to: | [ ] ok  [ ] change to: |
| "Viewer" (a read-only member) | Читач / Czytelnik | [ ] ok  [ ] change to: | [ ] ok  [ ] change to: |
| "Net worth" | Чисті активи / Wartość netto | [ ] ok  [ ] change to: | [ ] ok  [ ] change to: |
| "Emergency Kit", "Secret Key", "Recovery Key", "Master password" | see the glossary | [ ] ok | [ ] ok |
| How the reader is addressed | Ukrainian: «ви / ваш» in lower case. Polish: «Ty / Twój» in capitals | [ ] ok | [ ] ok |

The full list of terms is in `contracts/glossary.md`.

## 2. Screens to read (each in its language, narrow and wide)

- [ ] Sign-up, Secret Key, unlock, quick unlock, recovery, add this device
- [ ] Overview and its options, the empty states and "Getting started"
- [ ] Transactions: the list, filters, the add sheet (expense, income, transfer), place, attachment, Recently deleted
- [ ] Accounts (kinds, groups, adjust balance, delete) and the starter categories (49 names)
- [ ] Plan: Budgets, Goals, Regular operations, reminders and notifications
- [ ] Settings: Profile and security, Appearance (including this language picker), Categories, Folds and sharing (invitations, fingerprints, roles), Sync and devices, Data and storage (CSV import and export, backup and restore), Advanced, About, Updates
- [ ] Errors and the "needs attention" messages
- [ ] The Emergency Kit page (download or print it)
- [ ] The desktop menu and the start-up error dialog

## 3. Things the reviewer should check on purpose

1. **Plurals.** Every count message has four forms (one, few, many, other); `=1` is used where the wording differs for exactly one. Look at "21 …", "22 …", "25 …" and "1,5 …" cases.
2. **Gender.** The drafts avoid "I saved / I read" and use impersonal wording. Confirm nothing sounds addressed to one gender.
3. **Words that stay the same on purpose:** Cashfold, CSV, QR, PIN, Windows, macOS, Linux, AppImage, KB/MB/GB (Polish).
4. **Long text.** Anything that looks cut off or crowded on a phone.
5. **Money wording** in budgets, goals and transfers: is it what a person would say?

## 4. Issues raised

| # | Language | Where (key or screen) | Problem | Fix |
|---|----------|-----------------------|---------|-----|
|   |          |                       |         |     |
