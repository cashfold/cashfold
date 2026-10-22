# ADR-0010: Application updates carry a project Ed25519 signature

- **Status**: accepted
- **Date**: 2026-10-22
- **Decides**: `specs/003-desktop-apps-releases` research R-D-10, FR-016; documented in `docs/ARCHITECTURE.md` §10.1

## Context

The desktop app updates itself from GitHub Releases, after the user agrees. The updater checks the SHA-512 listed in the release's feed file, which proves the download matches the feed but not that the project published it: anyone who can alter a release alters both. The operating system's signature check helps only where it exists (Windows Authenticode, signed macOS builds). AppImage and unsigned builds have none. FR-016 requires that an update which cannot be verified as genuinely published by the project is never installed, on every format.

## Decision

Every installer that can update in the app has a detached **Ed25519 signature** (RFC 8032) over the UTF-8 message

```text
cashfold-update-v1\n<asset name>\n<sha512 base64>
```

stored as `<asset name>.sig` in the same release. The app compiles in one or two public keys (`UPDATE_PUBLIC_KEYS`) and accepts a signature by any of them. The private key is a secret in the protected `release` environment plus an offline backup held by a second person. After downloading and before reporting the update as ready, the main process fetches the `.sig`, verifies it, and on any failure deletes the file and reports `verify-failed`. Download URLs are pinned to the project's release URL over HTTPS.

Implementation: **WebCrypto only** (`crypto.subtle`, Ed25519), in `scripts/lib/update-signature.mjs`, used by `scripts/sign-update-assets.mjs` and bundled into the desktop main process. No new primitive, no third-party signing library. Tested with the RFC 8032 §7.1 vectors plus tamper cases.

The code lives outside `packages/crypto`. The constitution says a shell MUST NOT require changes to `crypto`, and adding an export for a shell would be exactly that; importing `crypto` into the shell would also break the boundary rule between the shell and the domain packages. The code is a few dozen lines of platform WebCrypto, with two reviewers required by CODEOWNERS.

## Alternatives rejected

- **SHA-512 only**: integrity, not authenticity.
- **Relying on the OS signature**: absent for AppImage and unsigned builds.
- **minisign, sigstore or TUF client libraries**: more surface and dependencies than the problem needs; the scheme above is a signature over one short message.
- **Reusing the operation-signing primitive in `packages/crypto`**: needs a new export for the shell (see above).

## Consequences

- One more secret to protect and back up. Losing the private key means installed apps can no longer verify updates and users must reinstall by hand. Rotation: ship a release trusting old and new keys, retire the old one a release later.
- A stolen private key allows a malicious signed update. Mitigations: custody in the protected environment, offline backup, rotation, the OS signature on signed builds, and the provenance attestation on release assets. Documented in the threat model.
- Test builds use a throwaway key pair that only builds compiled with the test-feed flag trust; the flag is absent from release builds and checked by `check:desktop-config`.
