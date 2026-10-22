import { encode } from '@cashfold/protocol/cbor';
import { describe, expect, it } from 'vitest';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import { x25519PublicKey } from '../adapters/noble/x25519';
import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { decodeInvitationCode, encodeInvitationCode, signBundle, verifyBundle } from './bundle';

const rng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const signer = createEd25519Signer();

async function make() {
  const sig = await signer.generate(rng);
  const encPk = x25519PublicKey(SecretBuf.from(rng.bytes(32)));
  return { sig, encPk, bundle: await signBundle(signer, { accountId: 'ABCDEF', encPk, sigSk: sig.secretKey }) };
}

describe('public key bundle', () => {
  it('verifies as made, and carries the signing key it was signed with', async () => {
    const { sig, bundle } = await make();
    expect(bundle.sigPk).toEqual(sig.publicKey);
    expect(await verifyBundle(signer, bundle)).toBe(true);
  });

  it('is refused when any part is changed: the account, either key or the signature', async () => {
    const { bundle } = await make();
    const other = await make();
    expect(await verifyBundle(signer, { ...bundle, accountId: 'ABCDEG' })).toBe(false);
    expect(await verifyBundle(signer, { ...bundle, encPk: other.encPk })).toBe(false);
    expect(await verifyBundle(signer, { ...bundle, sigPk: other.sig.publicKey })).toBe(false);
    expect(await verifyBundle(signer, { ...bundle, selfSig: new Uint8Array(64) })).toBe(false);
    const flipped = Uint8Array.from(bundle.selfSig);
    flipped[0] = flipped[0]! ^ 1;
    expect(await verifyBundle(signer, { ...bundle, selfSig: flipped })).toBe(false);
  });

  it('cannot be passed off by a service that swaps only the encryption key', async () => {
    const { bundle } = await make();
    const swapped = { ...bundle, encPk: x25519PublicKey(SecretBuf.from(rng.bytes(32))) };
    expect(await verifyBundle(signer, swapped)).toBe(false);
  });

  it('rejects malformed bundles without throwing', async () => {
    const { bundle } = await make();
    expect(await verifyBundle(signer, { ...bundle, accountId: '' })).toBe(false);
    expect(await verifyBundle(signer, { ...bundle, encPk: new Uint8Array(31) })).toBe(false);
    expect(await verifyBundle(signer, { ...bundle, selfSig: new Uint8Array(10) })).toBe(false);
  });
});

describe('invitation code', () => {
  it('round-trips a bundle through text', async () => {
    const { bundle } = await make();
    const code = encodeInvitationCode(bundle);
    expect(code.startsWith('cf-invite1:')).toBe(true);
    expect(code).toMatch(/^cf-invite1:[A-Za-z0-9_-]+$/);
    expect(decodeInvitationCode(code)).toEqual(bundle);
    expect(decodeInvitationCode(`  ${code}\n`)).toEqual(bundle);
    expect(await verifyBundle(signer, decodeInvitationCode(code)!)).toBe(true);
  });

  it('is refused when it is not a code, is damaged or is the wrong shape', async () => {
    const { bundle } = await make();
    const code = encodeInvitationCode(bundle);
    for (const bad of ['', 'cf-invite1:', 'cf-invite2:abc', 'hello', code.slice(0, -4), `${code}AAAA`, 'cf-invite1:!!!']) expect(decodeInvitationCode(bad)).toBeUndefined();
  });

  it('a code with a swapped key decodes but does not verify', async () => {
    const { bundle } = await make();
    const other = await make();
    const forged = decodeInvitationCode(encodeInvitationCode({ ...bundle, encPk: other.encPk }))!;
    expect(await verifyBundle(signer, forged)).toBe(false);
  });
});

describe('invitation codes of the wrong shape', () => {
  const code = (v: unknown) => `cf-invite1:${btoa(String.fromCharCode(...encode(v as never))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const good = { a: 'acct', e: new Uint8Array(32), s: new Uint8Array(32), g: new Uint8Array(64) };

  it('accepts the right shape and refuses every deviation from it', () => {
    expect(decodeInvitationCode(code(good))).toBeDefined();
    for (const bad of [
      [1n, 2n],
      { ...good, x: 1n },
      { ...good, a: '' },
      { ...good, a: 'x'.repeat(65) },
      { ...good, a: 7n },
      { ...good, e: new Uint8Array(31) },
      { ...good, s: new Uint8Array(33) },
      { ...good, g: new Uint8Array(63) },
    ]) expect(decodeInvitationCode(code(bad))).toBeUndefined();
  });
});
