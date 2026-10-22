// The signature that proves an application update came from the project (ADR-0010, docs/ARCHITECTURE.md section 10.1).
//
// Ed25519 (RFC 8032) through WebCrypto only: no primitive of our own and no library. The signed message is
//
//     cashfold-update-v1\n<asset name>\n<sha512 of the asset, base64>
//
// and the signature is stored, in base64, next to the installer as `<asset name>.sig`. The app trusts one or two raw public keys that are
// built into it; a signature from either is good. Verification never throws: anything wrong, malformed or missing is simply "no".
//
// Used by scripts/sign-update-assets.mjs (the release) and, bundled by esbuild, by the desktop app's updater.

const subtle = globalThis.crypto.subtle;
const ED25519 = { name: 'Ed25519' };
/** The DER prefix of an Ed25519 private key in PKCS#8 (RFC 8410); the 32-byte seed follows. `openssl genpkey -algorithm ed25519 -outform DER` makes this form. */
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const MESSAGE_TAG = 'cashfold-update-v1';

const fromBase64 = (text) => {
  if (typeof text !== 'string' || text === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error('not base64');
  return Uint8Array.from(Buffer.from(text, 'base64'));
};
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

/** The PKCS#8 form of a private key from its 32-byte seed (the form the RFC 8032 test vectors give). */
export function pkcs8FromSeed(seed) {
  if (seed.length !== 32) throw new Error('an Ed25519 seed is 32 bytes');
  return Uint8Array.from([...PKCS8_PREFIX, ...seed]);
}

/** @returns {Promise<{ privateKey: string, publicKey: string }>} PKCS#8 private key and raw public key, both base64 */
export async function generateUpdateKeyPair() {
  const pair = await subtle.generateKey(ED25519, true, ['sign', 'verify']);
  return {
    privateKey: toBase64(new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))),
    publicKey: toBase64(new Uint8Array(await subtle.exportKey('raw', pair.publicKey))),
  };
}

/** Signs bytes with a private key given as base64 PKCS#8. */
export async function ed25519Sign(privateKeyPkcs8Base64, bytes) {
  const key = await subtle.importKey('pkcs8', fromBase64(privateKeyPkcs8Base64), ED25519, false, ['sign']);
  return new Uint8Array(await subtle.sign(ED25519, key, bytes));
}

/** True only for a valid signature under a raw 32-byte public key given as base64. Any problem is false, never an exception. */
export async function ed25519Verify(publicKeyRawBase64, bytes, signature) {
  try {
    const raw = fromBase64(publicKeyRawBase64);
    if (raw.length !== 32 || signature.length !== 64) return false;
    const key = await subtle.importKey('raw', raw, ED25519, false, ['verify']);
    return await subtle.verify(ED25519, key, signature, bytes);
  } catch {
    return false;
  }
}

/** The text that is signed for one asset. Refuses a name or hash that could change the shape of the message. */
export function updateMessage(name, sha512Base64) {
  for (const part of [name, sha512Base64]) {
    if (typeof part !== 'string' || part === '' || /[\r\n]/.test(part)) throw new Error('an asset name and hash must be single, non-empty lines');
  }
  return `${MESSAGE_TAG}\n${name}\n${sha512Base64}`;
}

/** The base64 signature of an asset, made with the private key (base64 PKCS#8). */
export async function signUpdate(privateKeyPkcs8Base64, name, sha512Base64) {
  return toBase64(await ed25519Sign(privateKeyPkcs8Base64, new TextEncoder().encode(updateMessage(name, sha512Base64))));
}

/** True when the signature is good for this asset under any of the trusted raw public keys (base64). Never throws. */
export async function verifyUpdate(publicKeysRawBase64, name, sha512Base64, signatureBase64) {
  let message;
  let signature;
  try {
    message = new TextEncoder().encode(updateMessage(name, sha512Base64));
    signature = fromBase64(signatureBase64);
  } catch {
    return false;
  }
  for (const key of Array.isArray(publicKeysRawBase64) ? publicKeysRawBase64 : []) {
    if (await ed25519Verify(key, message, signature)) return true;
  }
  return false;
}
