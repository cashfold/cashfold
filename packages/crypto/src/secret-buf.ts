const INSPECT = Symbol.for('nodejs.util.inspect.custom');

/**
 * Holds secret bytes. It has no serialisation: `JSON.stringify` yields `{}`, inspection is redacted,
 * and the bytes are reachable only through `use`. `wipe()` zeroes them in place (best effort: JavaScript
 * cannot guarantee that no copy survives elsewhere in memory; see docs/threat-model.md).
 */
export class SecretBuf {
  #bytes: Uint8Array | null;

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  /** Copies `bytes`. The caller remains responsible for wiping its own copy. */
  static from(bytes: Uint8Array): SecretBuf {
    return new SecretBuf(Uint8Array.from(bytes));
  }

  /** Takes ownership of `bytes` without copying. */
  static take(bytes: Uint8Array): SecretBuf {
    return new SecretBuf(bytes);
  }

  get length(): number {
    return this.#bytes?.length ?? 0;
  }

  get isWiped(): boolean {
    return this.#bytes === null;
  }

  /** Runs `fn` with the raw bytes. Do not retain or copy the array beyond `fn`. */
  use<T>(fn: (bytes: Uint8Array) => T): T {
    if (this.#bytes === null) throw new Error('SecretBuf was wiped');
    return fn(this.#bytes);
  }

  wipe(): void {
    this.#bytes?.fill(0);
    this.#bytes = null;
  }

  [INSPECT](): string {
    return this.#bytes === null ? 'SecretBuf { wiped }' : `SecretBuf { ${this.#bytes.length} bytes }`;
  }
}
