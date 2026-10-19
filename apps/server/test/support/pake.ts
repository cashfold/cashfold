import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPake, loadSrpBigint, SecretBuf, type Pake } from '@cashfold/crypto';

// The real client-side SRP (WASM, constant-time) for tests that need a genuine client.

const dir = resolve(import.meta.dirname, '../../../../packages/crypto/src/adapters/srp-wasm');
let cached: Promise<Pake> | undefined;

export function testPake(): Promise<Pake> {
  cached = cached ?? loadSrpBigint(new Uint8Array(readFileSync(resolve(dir, 'srp-bigint.wasm'))), readFileSync(resolve(dir, 'srp-bigint.wasm.sha256'), 'utf8')).then((bn) =>
    createPake({ bn, rng: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) } }),
  );
  return cached;
}

export const secret = (hexText: string): SecretBuf => SecretBuf.from(Buffer.from(hexText, 'hex'));
export const randomX = (): Buffer => Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
