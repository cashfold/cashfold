# Contract: Sign-in Handshake and Transport Framing

Normative source: [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) §5.3, §6. This file fixes the message-level contract between client and server. Algorithms and constants are defined in the architecture document and are not repeated here.

## Roles and trust

- **Client**: holds password, Secret Key, derived values. Trusts nothing the server says about security settings without checking floors.
- **Server**: holds verifier `v`, salts, KDF parameters, encrypted key set. Learns nothing that lets it decrypt content or test password guesses without the Secret Key.

## Messages

| # | Direction | Endpoint | Body | Server checks | Client checks |
|---|---|---|---|---|---|
| 1 | C→S | `POST /auth/hello` | `{email, device_id}` | Rate-limit per IP and email | — |
| 2 | S→C | reply | `{account_id, auth_salt, kdf, session_id}` | Unknown email ⇒ deterministic fake values from a keyed MAC of the email | `kdf` meets floors; `auth_salt` is 16 bytes |
| 3 | C→S | `POST /auth/proof-a` | `{session_id, A}` | `A mod N ≠ 0`; session in state `SALT_SENT`; not expired (60 s) | — |
| 4 | S→C | reply | `{B}` | — | `B mod N ≠ 0` |
| 5 | C→S | `POST /auth/proof-m1` | `{session_id, M1}` | Constant-time compare; state `B_SENT`; failure counter | — |
| 6 | S→C | reply | `{M2}` | — | Constant-time compare of M2 |
| 7 | both | all later calls | AEAD frame | Counter strictly increasing; direction bit; tag valid | Same |

All failure replies for steps 3–5 are a uniform rejection with no detail. Timing for existing and non-existing accounts MUST be indistinguishable within measurement noise.

## State machines

Server session: `IDLE → SALT_SENT → B_SENT → AUTHED`, any failure or timeout ⇒ `FAILED` and secrets discarded.
Client session: `START → WAIT_SALT → WAIT_B → WAIT_M2 → AUTHED`, any invalid message ⇒ `FAILED`.

## Framing after `AUTHED`

- Keys: `K_c2s`, `K_s2c` derived from the SRP session key and the transcript hash (ARCH §6.5).
- Frame fields: session id, direction, counter, ciphertext (see `frame` in [op-envelope.cddl](op-envelope.cddl)).
- Associated data binds session id, direction, counter and length.
- A frame whose counter is not greater than the last accepted counter in its direction MUST close the session.
- Sessions expire after 30 min idle or 24 h absolute. Re-authentication reuses the locally cached secret and needs no password retyping.

## Behavioural requirements (testable)

| ID | Requirement | Spec |
|---|---|---|
| AUTH-1 | A recorded exchange cannot be replayed in a new session | FR-015 |
| AUTH-2 | Server database dump + guessed passwords cannot be verified without the Secret Key | FR-013 |
| AUTH-3 | Server-supplied KDF parameters below the floor abort sign-in | FR-019 |
| AUTH-4 | Response to unknown email is indistinguishable from known | FR-014 |
| AUTH-5 | Failed attempts are rate-limited per account and per IP with back-off | FR-014 |
| AUTH-6 | Changing password/Secret Key invalidates all other sessions and requires re-sign-in on other devices | FR-008 |
| AUTH-7 | Revoked devices are refused at message 1 and on every frame | FR-010 |

## Test vectors required (stored in `vectors/srp/`)

1. Fixed `password`, `email`, `secret_key`, `auth_salt`, KDF params ⇒ expected `SRP-x`, `v`.
2. Fixed `a`, `b` ⇒ expected `A`, `B`, `u`, `S`, `K`, `M1`, `M2`.
3. Negative vectors: `A = 0`, `A = N`, `B = 0`, `u = 0`, truncated and oversized fields, wrong proof.
4. Differential: 100 random exchanges cross-checked against an independent reference implementation.
