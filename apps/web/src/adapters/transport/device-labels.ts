import { createAesGcm, createHkdf, SecretBuf, type Rng } from '@cashfold/crypto';
import type { AccountSecrets, DeviceLabelPort } from '@cashfold/core';
import { encode } from '@cashfold/protocol/cbor';

// A device's name is sealed under a key derived from the account's encryption key, which every device of the account holds
// and the service never sees. Layout: nonce (12) then AES-256-GCM of the UTF-8 label.

const LABEL = 'cashfold.devlabel.v1';
const aad = encode([LABEL]);

export function createDeviceLabels(rng: Rng): DeviceLabelPort {
  const aead = createAesGcm();
  const hkdf = createHkdf();
  const keyOf = (account: AccountSecrets) => hkdf.derive(SecretBuf.from(account.encSk.use((b) => b)), new Uint8Array(0), new TextEncoder().encode(LABEL), 32);

  return {
    async seal(label, account) {
      const key = await keyOf(account);
      try {
        const nonce = Uint8Array.from(rng.bytes(12));
        return Uint8Array.from([...nonce, ...(await aead.seal(key, nonce, new TextEncoder().encode(label), aad))]);
      } finally {
        key.wipe();
      }
    },
    async open(sealed, account) {
      if (sealed.length < 28) return undefined;
      const key = await keyOf(account);
      try {
        return new TextDecoder().decode(await aead.open(key, sealed.slice(0, 12), sealed.slice(12), aad));
      } catch {
        return undefined;
      } finally {
        key.wipe();
      }
    },
  };
}
