# Contract: where the language control is

A "language control" is the select built by `LanguagePicker` (accessible name "Language" in the current language; options "Automatic", "English", "Українська", "Polski").

1. Exactly two components render it: `SignUpForm` (form step) and `AppearanceSection`.
2. `AppShell`, `AuthLayout` and every other page or sheet MUST NOT render it, and `AuthLayout` has no slot for it.
3. On `/sign-up/` before the account exists there is exactly one control. After the account is created (Secret Key step) there is none.
4. On `/`, `/sign-in/`, `/recover/` and `/add/` there is none.
5. In the signed-in app there is one control, on `/settings/appearance/`, and none on any other route or in any dialog or sheet.
6. A change on either surface applies at once, keeps the page and any typed input, and is stored as in spec 004.
7. Every page, with or without a control, shows the saved language, else the detected one, else English.

Check: `e2e/language.spec.ts` counts `select[name="language"]` on each route listed above.
