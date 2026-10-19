import { encode } from '@cashfold/protocol/cbor';
import type { FoldKeyGrant } from '@cashfold/protocol';
import type { Hpke, Rng, Signer } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// A Fold key, sealed to one member for one epoch (ARCH 7.2):
//   (enc, ct) = HPKE.Seal(pkR = member.enc.pk, info = CBOR["cashfold.foldkey.v1", fold, epoch, member],
//                         aad = CBOR["cashfold.foldkey.v1", fold, epoch, role], pt = FK)
//   sig       = Ed25519(granter.sig, CBOR["cashfold.foldkey.grant.v1", fold, epoch, member, role, enc, ct, granted_by])
// Opening checks the signature first, so a relay that swaps or edits a grant is caught before any decryption; the HPKE
// info and AAD then bind the key to its Fold, epoch, member and role even against a granter who re-signs.

const LABEL = 'cashfold.foldkey.v1';
const SIG_LABEL = 'cashfold.foldkey.grant.v1';
const text = (s: string) => new TextEncoder().encode(s);

export type GrantErrorCode = 'invalid_input' | 'bad_signature' | 'decrypt_failed';

export class GrantError extends Error {
  constructor(readonly code: GrantErrorCode) {
    super(code);
    this.name = 'GrantError';
  }
}

export interface SealGrantInput {
  readonly fold: Uint8Array;
  readonly epoch: number;
  readonly role: 1 | 2 | 3;
  /** The member's account id. */
  readonly member: string;
  readonly grantedBy: string;
  readonly recipientPublicKey: Uint8Array;
  readonly foldKey: SecretBuf;
  readonly granterSigningKey: SecretBuf;
}

export interface FoldKeyGrants {
  seal(input: SealGrantInput): Promise<FoldKeyGrant>;
  /** Re-signs a grant exactly as given. Only a granter's own client does this; tests use it to prove the AEAD binding. */
  resign(grant: FoldKeyGrant, granterSigningKey: SecretBuf): Promise<FoldKeyGrant>;
  /** Verifies the signature, then opens the Fold key. The caller owns the returned secret and must wipe it. */
  open(args: { grant: FoldKeyGrant; recipientSecretKey: SecretBuf; granterSigningPublicKey: Uint8Array }): Promise<SecretBuf>;
}

const info = (fold: Uint8Array, epoch: number, member: Uint8Array): Uint8Array => encode([LABEL, fold, epoch, member] as never);
const aad = (fold: Uint8Array, epoch: number, role: number): Uint8Array => encode([LABEL, fold, epoch, role] as never);
const signedBytes = (g: Omit<FoldKeyGrant, 'sig'>): Uint8Array =>
  encode([SIG_LABEL, g.fold, g.epoch, g.member, g.role, g.enc, g.ct, g.granted_by] as never);

export function createFoldKeyGrants({ hpke, signer, rng }: { hpke: Hpke; signer: Signer; rng: Rng }): FoldKeyGrants {
  return {
    async seal(input) {
      if (input.fold.length !== 16 || input.recipientPublicKey.length !== 32 || input.foldKey.length !== 32) throw new GrantError('invalid_input');
      if (!Number.isInteger(input.epoch) || input.epoch < 0 || input.epoch > 0xffff_ffff) throw new GrantError('invalid_input');
      const member = text(input.member);
      const { enc, ct } = await input.foldKey.use((fk) =>
        hpke.seal({ recipientPublicKey: input.recipientPublicKey, info: info(input.fold, input.epoch, member), aad: aad(input.fold, input.epoch, input.role), plaintext: fk, rng }),
      );
      const unsigned = { fold: input.fold, epoch: input.epoch, member, role: input.role, enc, ct, granted_by: text(input.grantedBy) };
      return { ...unsigned, sig: await signer.sign(input.granterSigningKey, signedBytes(unsigned)) };
    },

    async resign(grant, granterSigningKey) {
      const unsigned: Omit<FoldKeyGrant, 'sig'> = { fold: grant.fold, epoch: grant.epoch, member: grant.member, role: grant.role, enc: grant.enc, ct: grant.ct, granted_by: grant.granted_by };
      return { ...unsigned, sig: await signer.sign(granterSigningKey, signedBytes(unsigned)) };
    },

    async open({ grant, recipientSecretKey, granterSigningPublicKey }) {
      const { sig, ...unsigned } = grant;
      if (!(await signer.verify(granterSigningPublicKey, signedBytes(unsigned), sig))) throw new GrantError('bad_signature');
      try {
        const fk = await hpke.open({
          recipientSecretKey, enc: grant.enc, ct: grant.ct, info: info(grant.fold, grant.epoch, grant.member), aad: aad(grant.fold, grant.epoch, grant.role),
        });
        return SecretBuf.take(fk);
      } catch {
        throw new GrantError('decrypt_failed');
      }
    },
  };
}
