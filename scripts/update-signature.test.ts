import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { ed25519Sign, ed25519Verify, generateUpdateKeyPair, pkcs8FromSeed, signUpdate, updateMessage, verifyUpdate } from './lib/update-signature.mjs';

// The signature that proves an update came from the project. It is Ed25519 through WebCrypto, with no primitive of our own, and
// is tested like every primitive in this repository: against the published known answers (RFC 8032 section 7.1), then for the message
// format and for every way a signature can be wrong.

const hex = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'hex'));
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

interface Case { name: string; secret: string; public: string; message: string; signature: string }
const kat = JSON.parse(readFileSync(new URL('../vectors/kat/ed25519.json', import.meta.url), 'utf8')) as { cases: Case[] };

describe('Ed25519 known answers (RFC 8032 section 7.1)', () => {
  it('has the published cases to check against', () => {
    expect(kat.cases.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of kat.cases) {
    it(`${c.name}: the published signature verifies under the published public key`, async () => {
      expect(await ed25519Verify(b64(hex(c.public)), hex(c.message), hex(c.signature))).toBe(true);
    });

    it(`${c.name}: signing with the published secret reproduces the published signature`, async () => {
      const signature = await ed25519Sign(b64(pkcs8FromSeed(hex(c.secret))), hex(c.message));
      expect(Buffer.from(signature).toString('hex')).toBe(c.signature);
    });

    it(`${c.name}: one changed bit in the message, the signature or the key is refused`, async () => {
      const message = hex(c.message);
      const signature = hex(c.signature);
      const publicKey = hex(c.public);
      const flipped = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes, (byte, i) => (i === 0 ? byte ^ 1 : byte));
      expect(await ed25519Verify(b64(publicKey), message.length > 0 ? flipped(message) : Uint8Array.of(1), signature)).toBe(false);
      expect(await ed25519Verify(b64(publicKey), message, flipped(signature))).toBe(false);
      expect(await ed25519Verify(b64(flipped(publicKey)), message, signature)).toBe(false);
    });
  }
});

describe('the message that is signed', () => {
  it('is the version tag, the asset name and the SHA-512, one per line', () => {
    expect(updateMessage('Cashfold-1.2.3-linux-x64.AppImage', 'c2hhNTEy')).toBe('cashfold-update-v1\nCashfold-1.2.3-linux-x64.AppImage\nc2hhNTEy');
  });

  it('refuses a name or hash that could change the shape of the message', () => {
    for (const bad of ['a\nb', 'a\r\nb', '']) {
      expect(() => updateMessage(bad, 'c2hh')).toThrow();
      expect(() => updateMessage('a.exe', bad)).toThrow();
    }
  });
});

describe('signing and verifying an update', async () => {
  const name = 'Cashfold-1.2.3-win-x64.exe';
  const sha512 = b64(Uint8Array.from({ length: 64 }, (_, i) => i));
  const pair = await generateUpdateKeyPair();
  const other = await generateUpdateKeyPair();
  const signature = await signUpdate(pair.privateKey, name, sha512);

  it('round-trips with a generated key', async () => {
    expect(await verifyUpdate([pair.publicKey], name, sha512, signature)).toBe(true);
  });

  it('fails for another name, another hash, or another key', async () => {
    expect(await verifyUpdate([pair.publicKey], 'Cashfold-1.2.3-win-x64.exe.evil', sha512, signature)).toBe(false);
    expect(await verifyUpdate([pair.publicKey], name, b64(Uint8Array.from({ length: 64 }, () => 7)), signature)).toBe(false);
    expect(await verifyUpdate([other.publicKey], name, sha512, signature)).toBe(false);
  });

  it('accepts a signature from either of two trusted keys, and from neither of two others', async () => {
    expect(await verifyUpdate([other.publicKey, pair.publicKey], name, sha512, signature)).toBe(true);
    expect(await verifyUpdate([pair.publicKey, other.publicKey], name, sha512, await signUpdate(other.privateKey, name, sha512))).toBe(true);
    const third = await generateUpdateKeyPair();
    expect(await verifyUpdate([third.publicKey, other.publicKey], name, sha512, signature)).toBe(false);
  });

  it('never throws on malformed input: it says no', async () => {
    const wrongLength = b64(Uint8Array.of(1, 2, 3));
    for (const bad of ['', '!!!not base64!!!', wrongLength, signature.slice(0, -4), `${signature}AAAA`, b64(new Uint8Array(64))]) {
      expect(await verifyUpdate([pair.publicKey], name, sha512, bad), bad).toBe(false);
    }
    expect(await verifyUpdate([], name, sha512, signature)).toBe(false);
    expect(await verifyUpdate(['', 'not a key', wrongLength], name, sha512, signature)).toBe(false);
    expect(await verifyUpdate([pair.publicKey], '', sha512, signature)).toBe(false);
    expect(await verifyUpdate([pair.publicKey], name, 'a\nb', signature)).toBe(false);
    // @ts-expect-error not strings
    expect(await verifyUpdate([pair.publicKey], name, sha512, null)).toBe(false);
  });

  it('does not accept a signature made over the bare file name or hash without the format tag', async () => {
    const plain = await ed25519Sign(pair.privateKey, new TextEncoder().encode(`${name}\n${sha512}`));
    expect(await verifyUpdate([pair.publicKey], name, sha512, b64(plain))).toBe(false);
  });
});

describe('keys', () => {
  it('generates a raw 32-byte public key and a PKCS#8 private key, both in base64', async () => {
    const pair = await generateUpdateKeyPair();
    expect(Buffer.from(pair.publicKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(pair.privateKey, 'base64').subarray(0, 16).toString('hex')).toBe('302e020100300506032b657004220420');
  });
});
