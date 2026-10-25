# ADR-0004: Argon2id via hash-wasm

- **Status**: accepted
- **Date**: 2026-10-18

## Context

2SKD needs a memory-hard KDF (FR-004). WebCrypto has no Argon2id, so the constitution allows "a vetted Argon2id WASM build". Candidates from R-05: `hash-wasm`, `argon2-browser`. Parameter floors: `m >= 32768 KiB`, `t >= 2`, `p >= 1` (FR-019); anything lower throws `KdfBelowFloor`.

## Decision

Use **`hash-wasm` 4.12.0** (MIT licence; the Argon2 module is about 32 KB minified, loaded on demand) behind the `Kdf` port in `packages/crypto/src/adapters/argon2-wasm/`. Floors are enforced in the adapter, not by callers. PBKDF2-HMAC-SHA256 (>= 600,000 iterations, WebCrypto) is the fallback.

## Verification

- `hash-wasm` does not expose associated data, so the RFC 9106 section 5.3 vector (which uses a secret and associated data) cannot run through it directly.
- Instead the RFC vector is reproduced by `@noble/hashes` Argon2id (pure JavaScript, audited, independent implementation), and `hash-wasm` is checked against `@noble/hashes` on the RFC's password, salt and parameters plus randomised differential cases (`argon2.kat.test.ts`).
- Frozen vector: `vectors/kat/argon2id.json`.

## Benchmark

Node 26 on Apple silicon, single run (not representative of a mid-range phone browser; re-measure in the browser during the web unlock work, since the target is about 1 s there):

| m (KiB) | t   | p   | time  |
| ------- | --- | --- | ----- |
| 32768   | 2   | 1   | 33 ms |
| 65536   | 3   | 1   | 91 ms |
| 65536   | 3   | 4   | 93 ms |

## Consequences

- Default production parameters are not fixed here; choose them with the in-browser benchmark (open item for the unlock flow, T063/T071).
- `hash-wasm` ships WASM as embedded base64; the CSP needs `'wasm-unsafe-eval'` (already in `apps/web/headers.config.ts`).
- If a vetted build with associated-data support is preferred later, only the adapter changes.
