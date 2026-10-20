// Copies the SRP big-integer module into public/ so it is served byte for byte, after checking it against the SHA-256 the
// build pins (packages/crypto/src/adapters/srp-wasm/srp-bigint.wasm.sha256). The page checks the same hash again before it
// instantiates the module (docs/adr/0006-srp-wasm.md).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, '../../packages/crypto/src/adapters/srp-wasm');
const pinned = readFileSync(join(from, 'srp-bigint.wasm.sha256'), 'utf8').trim();
const actual = createHash('sha256').update(readFileSync(join(from, 'srp-bigint.wasm'))).digest('hex');
if (actual !== pinned) throw new Error('srp-bigint.wasm does not match its pinned hash');
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(join(from, 'srp-bigint.wasm'), join(root, 'public/srp-bigint.wasm'));
console.log('srp-bigint.wasm: verified and copied to public/');
