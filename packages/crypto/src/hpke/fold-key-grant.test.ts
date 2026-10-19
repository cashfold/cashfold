import { describe, expect, it } from 'vitest';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import { x25519PublicKey } from '../adapters/noble/x25519';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { createFoldKeyGrants, GrantError } from './fold-key-grant';
import { createHpke } from './hpke';

const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const hpke = createHpke({ aead: createAesGcm(), aeadId: 2 });
const signer = createEd25519Signer();
const grants = createFoldKeyGrants({ hpke, signer, rng: osRng });

async function people() {
  const member = await hpke.generate(osRng);
  const granter = await signer.generate(osRng);
  const foldKey = SecretBuf.from(osRng.bytes(32));
  const fold = osRng.bytes(16);
  return { member, granter, foldKey, fold };
}
const base = (p: Awaited<ReturnType<typeof people>>) => ({ fold: p.fold, epoch: 1, role: 1 as const, member: 'ABCDEF', grantedBy: 'ABCDEF', recipientPublicKey: p.member.publicKey, foldKey: p.foldKey, granterSigningKey: p.granter.secretKey });
const reject = async (promise: Promise<unknown>, code: string) => expect(await promise.then(() => 'ok', (e: unknown) => (e as GrantError).code)).toBe(code);

describe('Fold-key grants (ARCH 7.2)', () => {
  it('round-trips a Fold key to its member, and carries the fields the relay and peers need', async () => {
    const p = await people();
    const grant = await grants.seal(base(p));
    expect(grant).toMatchObject({ epoch: 1, role: 1 });
    expect(grant.ct).toHaveLength(48);
    expect(grant.enc).toHaveLength(32);
    const opened = await grants.open({ grant, recipientSecretKey: p.member.secretKey, granterSigningPublicKey: p.granter.publicKey });
    expect(opened.use((b) => Array.from(b))).toEqual(p.foldKey.use((b) => Array.from(b)));
  });

  it('is sealed freshly each time (no two grants of the same key look alike)', async () => {
    const p = await people();
    const [a, b] = [await grants.seal(base(p)), await grants.seal(base(p))];
    expect(a.ct).not.toEqual(b.ct);
    expect(a.enc).not.toEqual(b.enc);
  });

  it('cannot be opened by anyone but the member', async () => {
    const p = await people();
    const grant = await grants.seal(base(p));
    const stranger = await hpke.generate(osRng);
    await reject(grants.open({ grant, recipientSecretKey: stranger.secretKey, granterSigningPublicKey: p.granter.publicKey }), 'decrypt_failed');
  });

  it('checks the signature before anything is decrypted, and refuses an unknown or wrong signer', async () => {
    const p = await people();
    const grant = await grants.seal(base(p));
    const other = await signer.generate(osRng);
    await reject(grants.open({ grant, recipientSecretKey: p.member.secretKey, granterSigningPublicKey: other.publicKey }), 'bad_signature');
    await reject(grants.open({ grant: { ...grant, sig: new Uint8Array(64) }, recipientSecretKey: p.member.secretKey, granterSigningPublicKey: p.granter.publicKey }), 'bad_signature');
  });

  it.each([
    ['epoch', (g: Awaited<ReturnType<typeof grants.seal>>) => ({ ...g, epoch: g.epoch + 1 })],
    ['role', (g: Awaited<ReturnType<typeof grants.seal>>) => ({ ...g, role: 2 as const })],
    ['member', (g: Awaited<ReturnType<typeof grants.seal>>) => ({ ...g, member: new TextEncoder().encode('GHJKLM') })],
    ['fold', (g: Awaited<ReturnType<typeof grants.seal>>) => ({ ...g, fold: new Uint8Array(16).fill(9) })],
    ['ciphertext', (g: Awaited<ReturnType<typeof grants.seal>>) => ({ ...g, ct: Uint8Array.from(g.ct, (x, i) => (i === 3 ? x ^ 1 : x)) })],
    ['encapsulated key', (g: Awaited<ReturnType<typeof grants.seal>>) => ({ ...g, enc: Uint8Array.from(g.enc, (x, i) => (i === 3 ? x ^ 1 : x)) })],
  ])('refuses a grant whose %s was changed in transit', async (_name, change) => {
    const p = await people();
    const grant = await grants.seal(base(p));
    await reject(grants.open({ grant: change(grant), recipientSecretKey: p.member.secretKey, granterSigningPublicKey: p.granter.publicKey }), 'bad_signature');
  });

  it('binds the key to its Fold, epoch, role and member even when re-signed by a granter (AAD and info)', async () => {
    const p = await people();
    const grant = await grants.seal(base(p));
    // A malicious granter who re-signs a copy with a different epoch still cannot make the sealed key open under it.
    const forged = await grants.resign({ ...grant, epoch: 2 }, p.granter.secretKey);
    await reject(grants.open({ grant: forged, recipientSecretKey: p.member.secretKey, granterSigningPublicKey: p.granter.publicKey }), 'decrypt_failed');
    const roled = await grants.resign({ ...grant, role: 3 }, p.granter.secretKey);
    await reject(grants.open({ grant: roled, recipientSecretKey: p.member.secretKey, granterSigningPublicKey: p.granter.publicKey }), 'decrypt_failed');
  });

  it('refuses a Fold key that is not 32 bytes and a recipient key that is not a public key', async () => {
    const p = await people();
    await reject(grants.seal({ ...base(p), foldKey: SecretBuf.from(new Uint8Array(31)) }), 'invalid_input');
    await reject(grants.seal({ ...base(p), recipientPublicKey: new Uint8Array(31) }), 'invalid_input');
    await reject(grants.seal({ ...base(p), epoch: -1 }), 'invalid_input');
  });

  it('matches the public key derived from the member\'s secret key', async () => {
    const p = await people();
    expect(x25519PublicKey(p.member.secretKey)).toEqual(p.member.publicKey);
  });
});
