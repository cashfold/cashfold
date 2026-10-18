import { describe, expect, it } from 'vitest';
import ed from '../../../../../vectors/kat/ed25519.json' with { type: 'json' };
import x from '../../../../../vectors/kat/x25519.json' with { type: 'json' };
import { SecretBuf } from '../../secret-buf.js';
import { hex, toHex } from '../../test-support.js';
import { createEd25519Signer } from './ed25519.js';
import { x25519, x25519PublicKey } from './x25519.js';

describe('X25519 (RFC 7748 section 6.1)', () => {
  it('derives public keys', () => {
    expect(toHex(x25519PublicKey(SecretBuf.from(hex(x.alice_private))))).toBe(x.alice_public);
    expect(toHex(x25519PublicKey(SecretBuf.from(hex(x.bob_private))))).toBe(x.bob_public);
  });

  it('agrees on the shared secret from both sides', () => {
    const a = x25519(SecretBuf.from(hex(x.alice_private)), hex(x.bob_public));
    const b = x25519(SecretBuf.from(hex(x.bob_private)), hex(x.alice_public));
    expect(toHex(a.use((s) => s))).toBe(x.shared);
    expect(toHex(b.use((s) => s))).toBe(x.shared);
  });

  it('rejects low-order points (all-zero shared secret)', () => {
    expect(() => x25519(SecretBuf.from(hex(x.alice_private)), new Uint8Array(32))).toThrow();
  });
});

describe('Ed25519 (RFC 8032 section 7.1)', () => {
  const signer = createEd25519Signer();
  for (const v of ed.cases) {
    it(v.name, async () => {
      const sk = SecretBuf.from(hex(v.secret));
      expect(toHex(await signer.publicKey(sk))).toBe(v.public);
      expect(toHex(await signer.sign(sk, hex(v.message)))).toBe(v.signature);
      expect(await signer.verify(hex(v.public), hex(v.message), hex(v.signature))).toBe(true);
    });
  }

  it('verify is strict and never throws', async () => {
    const v = ed.cases[1]!;
    const sig = hex(v.signature);
    expect(await signer.verify(hex(v.public), hex('73'), sig)).toBe(false); // wrong message
    const bad = Uint8Array.from(sig);
    bad[0] = bad[0]! ^ 1;
    expect(await signer.verify(hex(v.public), hex(v.message), bad)).toBe(false);
    expect(await signer.verify(hex(v.public), hex(v.message), sig.slice(0, 63))).toBe(false); // truncated
    expect(await signer.verify(new Uint8Array(31), hex(v.message), sig)).toBe(false); // short key
    // non-canonical S (S + L) must be rejected
    const L = 2n ** 252n + 27742317777372353535851937790883648493n;
    const s = BigInt('0x' + toHex(sig.slice(32).reverse())) + L;
    const nc = new Uint8Array(64);
    nc.set(sig.slice(0, 32));
    nc.set(hex(s.toString(16).padStart(64, '0')).reverse(), 32);
    expect(await signer.verify(hex(v.public), hex(v.message), nc)).toBe(false);
  });

  it('generates a key pair that signs and verifies', async () => {
    const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
    const kp = await signer.generate(rng);
    const msg = new TextEncoder().encode('hello');
    expect(await signer.verify(kp.publicKey, msg, await signer.sign(kp.secretKey, msg))).toBe(true);
  });
});
