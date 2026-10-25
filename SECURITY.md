# Security Policy

Cashfold is zero-knowledge by design, so reports about plaintext leaving a device, key handling,
sign-in, sync or sharing are the highest priority.

## Reporting a vulnerability

**Please report vulnerabilities privately. Do not open a public issue, pull request or discussion
for a security problem.**

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/cashfold/cashfold/security/advisories/new)
(on the repository, open **Security → Advisories → Report a vulnerability**). Only the maintainers
can see the report.

Include as much as you can:

- what is affected (the app, the relay, the desktop shell, a release) and which version or commit;
- what you did, and what you expected to happen instead;
- how to reproduce it, or a proof of concept;
- what an attacker could achieve, and what they would need (an account, network position, a
  shared Fold, local access).

## What to expect

- We acknowledge a report within **3 working days**.
- We assess it, tell you whether we consider it a vulnerability, and keep you informed while we fix
  it.
- We agree the disclosure date with you. We publish a
  [security advisory](https://github.com/cashfold/cashfold/security/advisories) and a fixed release
  together, and credit you if you wish.
- There is no bug bounty program.

Good-faith research that follows this policy, and does not harm other people's data or the
availability of a service you do not own, is welcome, and we will not take action against it.

## Supported versions

Cashfold is pre-1.0. Security fixes go into the latest release only, so please check that the problem
exists in the [latest release](https://github.com/cashfold/cashfold/releases/latest) or on `main`.

## Scope

In scope, roughly in order of interest:

1. The cryptographic protocol and its implementation (`packages/crypto`, `packages/protocol`): key
   derivation, sign-in, the sealed transport, operation sealing and signing, Fold-key grants, the
   membership log, snapshots, attachments, the Recovery Key and backups.
2. Authentication and authorization on the relay (`apps/server`): the sign-in handshake and its
   failure behaviour, sessions, roles and epochs, account deletion.
3. Sharing and history scope (`packages/core/src/sharing`).
4. How the client handles secrets (`apps/web`): what lives in the worker, locking and wiping, quick
   unlock, the Emergency Kit.
5. Web delivery: the content security policy, subresource integrity, the service worker and the
   reproducible build.
6. Parsers of untrusted input: CBOR and wire schemas, CSV import, backups, and operations or
   membership entries from the relay or other members.
7. The desktop shell (`apps/desktop`): the main process, the bridge and its validation, the update
   signature check, and the release workflows.

Out of scope: the hosting environment of a particular operator, third-party libraries beyond how
Cashfold uses them (report those upstream), and denial of service by sheer volume.

The [threat model](docs/threat-model.md) lists who Cashfold defends against and the risks it accepts
(see _Residual risks_). The [security review](docs/security-review/README.md) describes what has been
reviewed, what was found, and how it was addressed. A report about an accepted risk is still
welcome if you can show the risk is worse than documented.

## Verifying what you download

Every release lists a checksum for each file and a build attestation. See
[Get Cashfold](README.md#get-cashfold) for the commands.
