// Constant-time big-integer arithmetic for the SRP client, in WebAssembly built from the audited `crypto-bigint` crate
// (packages/crypto/wasm/srp-bigint, docs/adr/0006-srp-wasm.md). JavaScript `bigint` is variable-time, so every
// operation whose inputs include a secret exponent runs here (ARCH 6.9). The module has no imports, so it can reach
// nothing outside its own memory. Its bytes are checked against a pinned SHA-256 before they are compiled.

const SIZE = 512;

export interface SrpBigint {
  /** `base ^ exp mod modulus` for 512-byte big-endian inputs; `expBits` is a public bound on the exponent's size. */
  modpow(base: Uint8Array, exp: Uint8Array, expBits: number, modulus: Uint8Array): Uint8Array;
  /** `a + u * x` for 512-byte big-endian inputs that are known to be small (256 bits each). */
  expSum(a: Uint8Array, u: Uint8Array, x: Uint8Array): Uint8Array;
}

interface Exports {
  memory: WebAssembly.Memory;
  cf_alloc(len: number): number;
  cf_free(ptr: number, len: number): void;
  cf_modpow(base: number, exp: number, expBits: number, modulus: number, out: number): number;
  cf_exp_sum(a: number, u: number, x: number, out: number): void;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class SrpWasmError extends Error {
  constructor(readonly kind: 'hash_mismatch' | 'bad_input' | 'bad_module') {
    super(kind);
    this.name = 'SrpWasmError';
  }
}

/** Compiles the module after checking its bytes against `pinnedSha256` (lowercase hex). */
export async function loadSrpBigint(wasm: Uint8Array, pinnedSha256: string): Promise<SrpBigint> {
  if ((await sha256Hex(wasm)) !== pinnedSha256.trim()) throw new SrpWasmError('hash_mismatch');
  const { instance } = await WebAssembly.instantiate(wasm as BufferSource, {});
  const x = instance.exports as unknown as Exports;
  if (typeof x.cf_modpow !== 'function' || typeof x.cf_exp_sum !== 'function' || !(x.memory instanceof WebAssembly.Memory)) throw new SrpWasmError('bad_module');

  const take = (...inputs: Uint8Array[]): number[] => {
    const ptrs = inputs.map((input) => {
      if (input.length !== SIZE) throw new SrpWasmError('bad_input');
      const ptr = x.cf_alloc(SIZE);
      new Uint8Array(x.memory.buffer, ptr, SIZE).set(input);
      return ptr;
    });
    return ptrs;
  };
  const release = (ptrs: number[]): void => {
    for (const p of ptrs) x.cf_free(p, SIZE); // zeroed before it is freed
  };

  return {
    modpow(base, exp, expBits, modulus) {
      if (!Number.isInteger(expBits) || expBits < 1 || expBits > 4096) throw new SrpWasmError('bad_input');
      const ptrs = take(base, exp, modulus);
      const out = x.cf_alloc(SIZE);
      try {
        if (x.cf_modpow(ptrs[0]!, ptrs[1]!, expBits, ptrs[2]!, out) !== 0) throw new SrpWasmError('bad_input');
        return new Uint8Array(new Uint8Array(x.memory.buffer, out, SIZE));
      } finally {
        release([...ptrs, out]);
      }
    },
    expSum(a, u, xx) {
      const ptrs = take(a, u, xx);
      const out = x.cf_alloc(SIZE);
      try {
        x.cf_exp_sum(ptrs[0]!, ptrs[1]!, ptrs[2]!, out);
        return new Uint8Array(new Uint8Array(x.memory.buffer, out, SIZE));
      } finally {
        release([...ptrs, out]);
      }
    },
  };
}
