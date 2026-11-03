# Zero knowledge, secrets and security hygiene

**Scope:** all changed source, excluding tests.

Follow `_contract.md`. Constitution I and VIII are the standard; `docs/privacy.md` lists exactly what
the service may learn.

- **No plaintext leaves the device.** A new request field, header, URL, query string, log entry,
  analytics event, error message or filename that carries content (names, amounts, notes, account
  details) is a `blocker`. Check the whole path to the network, not just the call site.
- **No secrets in the wrong place.** Passwords, Secret Keys, Recovery Keys, key material and tokens
  never reach logs, storage outside the encrypted store, URLs, error text or telemetry. Prefer
  non-extractable `CryptoKey`s; overwrite secret buffers when done (`secret-buf`).
- **Cryptography.** Go through the narrow interfaces in `packages/crypto/src/ports`. Flag home-made
  primitives, a reused nonce, a missing authentication check, a comparison of secrets with `===`, a
  weaker algorithm, or any change to a pinned format without a version bump and test vectors.
- **Untrusted input.** Wire data, imported CSV, backups, attachments, deep links (`cashfold://`) and
  anything from another member are hostile until validated by a schema. Look for unchecked sizes,
  prototype pollution, path traversal in file names, and decompression of unbounded data.
- **Content-Security-Policy and Trusted Types.** No inline script or style, no `eval`, no
  `dangerouslySetInnerHTML`, no new third-party origin, font or script, no `name` prop on a Headless UI
  control (it renders a hidden input and breaks the policy).
- **Desktop shell.** Context isolation and sandbox stay on; no Node in the page; every bridge call is
  validated by a schema on both sides; navigation, new windows and webviews stay refused. A new
  permission or channel needs a rejected-call test.
- **Dependencies.** A new runtime dependency is exact-pinned, AGPL-compatible, audited and justified;
  a postinstall script or a network call at install time is a `blocker`.
- **Releases and CI.** Workflow changes keep actions pinned to commits and permissions minimal, and
  never print a secret.
