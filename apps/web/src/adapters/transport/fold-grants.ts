import { createAesGcm, createEd25519Signer, createFoldKeyGrants, createHpke, SecretBuf, type Rng } from '@cashfold/crypto';
import { idToBytes, type FoldGrantPort, type Role } from '@cashfold/core';
import { decodeFoldKeyGrantWire as decodeFoldKeyGrant, encodeFoldKeyGrantWire as encodeFoldKeyGrant } from '@cashfold/protocol/wire';
import type { FoldKeyring } from '../sqlite-opfs/fold-store';

// Fold keys travel between an account's devices as HPKE grants addressed to the account's own encryption key, signed with
// its signing key (ARCH 7.2). The service stores them and cannot open them. A grant whose signature or contents do not
// check out is skipped, never half-trusted.

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const ROLE: Readonly<Record<number, Role>> = { 1: 'owner', 2: 'editor', 3: 'viewer' };

export function createFoldGrantPort(deps: { keyring: () => FoldKeyring | undefined; rng: Rng }): FoldGrantPort {
  const grants = createFoldKeyGrants({ hpke: createHpke({ aead: createAesGcm(), aeadId: 2 }), signer: createEd25519Signer(), rng: deps.rng });
  const asBuf = (s: { use<T>(fn: (b: Uint8Array) => T): T }): SecretBuf => SecretBuf.from(s.use((b) => b));

  return {
    async grantsFor({ fold, account, accountId, publicKeys }) {
      const keyring = deps.keyring();
      if (keyring === undefined) return [];
      const out: Uint8Array[] = [];
      const sigSk = asBuf(account.sigSk);
      try {
        for (const epoch of await keyring.epochs(fold)) {
          const key = await keyring.key(fold, epoch);
          if (key === undefined) continue;
          out.push(encodeFoldKeyGrant(await grants.seal({
            fold: idToBytes(fold), epoch, role: 1, member: accountId, grantedBy: accountId, recipientPublicKey: publicKeys.enc, foldKey: key, granterSigningKey: sigSk,
          })));
        }
      } finally {
        sigSk.wipe();
      }
      return out;
    },

    async open({ fold, grants: raw, account, publicKeys }) {
      const out: Array<{ epoch: number; role: Role; key: SecretBuf }> = [];
      const encSk = asBuf(account.encSk);
      try {
        for (const bytes of raw) {
          try {
            const g = decodeFoldKeyGrant(bytes);
            const role = ROLE[g.role];
            if (role === undefined || !sameBytes(g.fold, idToBytes(fold))) continue;
            // An owner's grant to their own devices is signed by their own signing key.
            const key = await grants.open({ grant: g, recipientSecretKey: encSk, granterSigningPublicKey: publicKeys.sig });
            out.push({ epoch: g.epoch, role, key });
          } catch {
            continue;
          }
        }
      } finally {
        encSk.wipe();
      }
      return out.sort((a, b) => a.epoch - b.epoch);
    },
  };
}
