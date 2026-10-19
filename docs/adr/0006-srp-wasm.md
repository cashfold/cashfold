# ADR-0006: Constant-time big-integer arithmetic for the SRP client

- **Status**: accepted
- **Date**: 2026-10-19

## Context

Signing in uses SRP-6a over the RFC 3526 4096-bit group (FR-013). The client computes `A = g^a mod N` and `S = (B − k·g^x)^(a + u·x) mod N`, where `a` and `x` are secret. JavaScript's `bigint` runs in time that depends on its operands, so doing this exponentiation with it would leak information about the secret exponents to anything that can time it (a hostile page script, a co-resident process, a malicious extension). ARCH §6.9 therefore requires secret-exponent arithmetic in a constant-time module.

Candidates considered:

| Option | Why not |
|---|---|
| Plain `bigint` | Variable-time. |
| A JavaScript big-integer library that claims constant time | JIT and garbage collection make constant time in JavaScript unreliable to claim, whatever the library. |
| A WebAssembly build of OpenSSL / libsodium | The 4096-bit modular arithmetic we need is not exposed by libsodium; OpenSSL's `BN` is large (hundreds of KB) and not constant-time by default. |
| `crypto-bigint` (Rust) compiled to WebAssembly | Audited, constant-time `pow_bounded_exp` / Montgomery arithmetic, no allocation tricks, small once only the needed functions are exported. |

## Decision

Use **`crypto-bigint` 0.7.5** (MIT OR Apache-2.0), pinned with `=`, compiled to `wasm32-unknown-unknown` by `scripts/build-srp-wasm.sh` from `packages/crypto/wasm/srp-bigint/` (`Cargo.lock` committed). The module exports four functions:

- `cf_modpow(base, exp, exp_bits, modulus, out)`: `base^exp mod modulus` for 512-byte big-endian operands. `exp_bits` is a public bound, not a secret.
- `cf_exp_sum(a, u, x, out)`: `a + u·x` for the exponent.
- `cf_alloc` / `cf_free`: memory management inside the module.

The module has **no imports**, so it can reach nothing outside its own linear memory. The build is reproducible: the script writes the SHA-256 of the artifact next to it (`srp-bigint.wasm.sha256`), the adapter (`packages/crypto/src/adapters/srp-wasm/`) refuses to compile bytes whose hash differs, and CI rebuilds and compares.

Everything else in the exchange (hashing, `k`, `u`, `M1`, `M2`, padding, transcript binding) stays in TypeScript, where no secret exponent is involved.

The relay's side uses Node's `crypto.createDiffieHellman(N, 2)` (OpenSSL, constant-time exponentiation) for its secret `b`, with the group's primality checked once at startup.

## Verification

- **Independent reference.** `vectors/srp/reference.py` implements SRP-6a with Python's standard library only and writes `vectors/srp/srp.json` (fixed `a`/`b` vectors for `A, B, u, S, K, M1, M2`, plus negative cases).
- **Differential tests.** 100 random exchanges are cross-checked between the WASM client, the OpenSSL server path and the Python reference (`packages/crypto/src/pake/srp.test.ts`, `apps/server/src/modules/auth/srp-server.test.ts`).
- **Degenerate values.** `A = 0`, `A = N`, `B = 0`, `B = N`, `u = 0`, truncated and oversized inputs are rejected on both sides.
- **Group.** `group.test.ts` recomputes the RFC 3526 prime from its defining formula and checks that it is a safe prime.

## Size

The module is about 58 KB (about 24 KB gzipped) and loads on demand the first time a device signs in or registers; it is not in the initial bundle.

## Consequences

- Building the module needs a Rust toolchain with the `wasm32-unknown-unknown` target. It is only needed when the module changes; the built artifact and its hash are committed.
- The content security policy already allows WebAssembly (`'wasm-unsafe-eval'`).
- Constant-time behaviour is a property of `crypto-bigint` compiled by LLVM; WebAssembly engines do not promise it, so this reduces rather than eliminates timing exposure. The threat model (docs/threat-model.md) records this residual risk.
- If the group changes (it will not for SRP v1), the sizes in the exports change with it.
