import { createPake, loadSrpBigint, SRP_BIGINT_SHA256, type Pake, type Rng } from '@cashfold/crypto';

// The SRP engine is a WebAssembly module served with the app (public/srp-bigint.wasm, copied from the crypto package by
// scripts/copy-srp-wasm.mjs). It is fetched once, on the first sign-in or registration, checked against the SHA-256 compiled
// into this build, and only then instantiated, so a tampered copy on a CDN or in a cache cannot be run.

export const SRP_WASM_PATH = '/srp-bigint.wasm';

export function createPakeLoader({ rng, fetchWasm }: { rng: Rng; fetchWasm?: () => Promise<Uint8Array> }): () => Promise<Pake> {
  const load = fetchWasm ?? (async () => {
    const res = await fetch(SRP_WASM_PATH, { cache: 'force-cache' });
    if (!res.ok) throw new Error('srp module unavailable');
    return new Uint8Array(await res.arrayBuffer());
  });
  let pending: Promise<Pake> | undefined;
  return () => {
    pending ??= load().then((bytes) => loadSrpBigint(bytes, SRP_BIGINT_SHA256)).then((bn) => createPake({ bn, rng })).catch((e: unknown) => {
      pending = undefined; // a failed load may be tried again
      throw e;
    });
    return pending;
  };
}
