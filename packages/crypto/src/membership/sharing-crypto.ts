import { decodeFoldKeyGrantWire, encodeFoldKeyGrantWire } from '@cashfold/protocol/wire';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createFoldKeyGrants, GrantError } from '../hpke/fold-key-grant';
import { createHpke } from '../hpke/hpke';
import { fingerprint } from '../fingerprint';
import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { signBundle, verifyBundle, type PublicKeyBundleData } from './bundle';
import { createLogCrypto, type LogCrypto, type PlainLogEntry } from './log-crypto';

// The crypto sharing needs, in the shape the core asks for it: Fold-key grants, signed log entries, key bundles, fingerprints.
// Ids are text here (UUIDs for Folds, account ids as typed). Secrets are copied into a SecretBuf for each call and wiped after.

type SecretLike = { use<T>(fn: (bytes: Uint8Array) => T): T };
const own = (s: SecretLike): SecretBuf => SecretBuf.from(s.use((b) => Uint8Array.from(b)));

function uuidBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
}
function uuidText(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export interface GrantFacts {
  readonly fold: string;
  readonly epoch: number;
  readonly member: string;
  readonly role: 1 | 2 | 3;
  readonly grantedBy: string;
}

export interface SharingCrypto {
  readonly log: LogCrypto;
  signEntry(draft: Omit<PlainLogEntry, 'sig'>, signingKey: SecretLike): Promise<PlainLogEntry>;
  verifyBundle(bundle: PublicKeyBundleData): Promise<boolean>;
  fingerprint(encPk: Uint8Array, sigPk: Uint8Array): Uint8Array;
  sealGrant(args: {
    fold: string; epoch: number; role: 1 | 2 | 3; member: string; grantedBy: string; recipientEncPk: Uint8Array; foldKey: SecretLike; signingKey: SecretLike;
  }): Promise<Uint8Array>;
  readGrant(bytes: Uint8Array): GrantFacts | undefined;
  openGrant(args: { grant: Uint8Array; encSk: SecretLike; granterSigPk: Uint8Array }): Promise<SecretBuf | undefined>;
  newFoldKey(): SecretBuf;
  signBundle(args: { accountId: string; encPk: Uint8Array; sigSk: SecretLike }): Promise<PublicKeyBundleData>;
}

export function createSharingCrypto({ rng }: { rng: Rng }): SharingCrypto {
  const signer = createEd25519Signer();
  const grants = createFoldKeyGrants({ hpke: createHpke({ aead: createAesGcm(), aeadId: 2 }), signer, rng });
  const log = createLogCrypto({ signer });

  return {
    log,

    async signEntry(draft, signingKey) {
      const key = own(signingKey);
      try {
        return await log.sign(draft, key);
      } finally {
        key.wipe();
      }
    },

    verifyBundle: (bundle) => verifyBundle(signer, bundle),
    fingerprint,

    async sealGrant(args) {
      const foldKey = own(args.foldKey);
      const signingKey = own(args.signingKey);
      try {
        return encodeFoldKeyGrantWire(await grants.seal({
          fold: uuidBytes(args.fold), epoch: args.epoch, role: args.role, member: args.member, grantedBy: args.grantedBy,
          recipientPublicKey: args.recipientEncPk, foldKey, granterSigningKey: signingKey,
        }));
      } finally {
        foldKey.wipe();
        signingKey.wipe();
      }
    },

    readGrant(bytes) {
      try {
        const g = decodeFoldKeyGrantWire(bytes);
        return { fold: uuidText(g.fold), epoch: g.epoch, member: fromUtf8(g.member), role: g.role as 1 | 2 | 3, grantedBy: fromUtf8(g.granted_by) };
      } catch {
        return undefined;
      }
    },

    async openGrant({ grant, encSk, granterSigPk }) {
      const secret = own(encSk);
      try {
        return await grants.open({ grant: decodeFoldKeyGrantWire(grant), recipientSecretKey: secret, granterSigningPublicKey: granterSigPk });
      } catch (e) {
        if (e instanceof GrantError) return undefined;
        return undefined; // malformed bytes
      } finally {
        secret.wipe();
      }
    },

    newFoldKey: () => SecretBuf.from(rng.bytes(32)),
    signBundle: async ({ accountId, encPk, sigSk }) => {
      const key = own(sigSk);
      try {
        return await signBundle(signer, { accountId, encPk, sigSk: key });
      } finally {
        key.wipe();
      }
    },
  };
}
