import { createEd25519Signer, createLogCrypto, createHpke, createAesGcm, SecretBuf, type PlainLogEntry, type Rng } from '@cashfold/crypto';
import { id } from './world';

// Test people for the membership log: each has an account key pair (and an encryption key pair for grants), and signs
// entries as their account.

const signer = createEd25519Signer();
const hpke = createHpke({ aead: createAesGcm(), aeadId: 2 });
const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };

export const logCrypto = createLogCrypto({ signer });

export interface Person {
  readonly account: string;
  readonly enc: { readonly publicKey: Uint8Array; readonly secretKey: SecretBuf };
  readonly sig: { readonly publicKey: Uint8Array; readonly secretKey: SecretBuf };
  readonly device: ReturnType<typeof id>;
  readonly devicePk: Uint8Array;
  readonly deviceSk: SecretBuf;
}

export async function person(account: string, deviceNumber: number): Promise<Person> {
  const enc = await hpke.generate(osRng);
  const sig = await signer.generate(osRng);
  const dev = await signer.generate(osRng);
  return { account, enc, sig, device: id(deviceNumber), devicePk: dev.publicKey, deviceSk: dev.secretKey };
}

export type EntryDraft = Omit<PlainLogEntry, 'sig' | 'signer' | 'idx' | 'prev' | 'ts'> & { ts?: number };

/** Builds and signs a chain of entries. */
export class LogBuilder {
  readonly entries: PlainLogEntry[] = [];
  private clock = 1_000;

  async append(by: Person, draft: EntryDraft & { idx?: number; prev?: Uint8Array }): Promise<PlainLogEntry> {
    const last = this.entries.at(-1);
    const { idx, prev, ts, ...rest } = draft;
    const unsigned: Omit<PlainLogEntry, 'sig'> = {
      ...rest, signer: by.account, idx: idx ?? this.entries.length, prev: prev ?? (last === undefined ? new Uint8Array(32) : await logCrypto.hash(last)), ts: ts ?? (this.clock = Math.max(this.clock + 10, (last?.ts ?? 0) + 10)),
    };
    const entry = await logCrypto.sign(unsigned, by.sig.secretKey);
    this.entries.push(entry);
    return entry;
  }

  genesis(owner: Person) {
    return this.append(owner, { type: 'add_member', subject: owner.account, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: owner.enc.publicKey, sig: owner.sig.publicKey } });
  }

  add(by: Person, who: Person, role: 1 | 2 | 3, scope: 'full' | 'from_join' = 'full', fromEpoch = 1) {
    return this.append(by, { type: 'add_member', subject: who.account, role, scope, fromEpoch, pubkeys: { enc: who.enc.publicKey, sig: who.sig.publicKey } });
  }

  device(by: Person) {
    return this.append(by, { type: 'add_device', subject: by.device, pubkeys: { sig: by.devicePk } });
  }
}
