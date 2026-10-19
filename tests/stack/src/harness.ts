import {
  createCommandBus, createEventBus, createUpcasters, createWritePath, LEDGER_GROUPS, roleResolver, SCHEMA_VERSION,
  type CredentialStorePort, type DeviceCredentials, type FoldDirectory, type FoldKeyImportPort, type FoldKeyPort, type FoldSummary, type Id, type OpSealerPort, type SealedSnapshotPort, type SessionPort,
  type SessionSecrets, type SessionServices, type SyncCursorPort,
} from '@cashfold/core';
import { createMemoryStores } from '@cashfold/core/testing';
import { createAesGcm, createEd25519Signer, createHkdf, createOpSealer, createSnapshotSealer, SecretBuf } from '@cashfold/crypto';
import type { SyncSession } from '../../../apps/web/src/worker/sync-service';

// One simulated device: the same wiring as the web session, over memory instead of SQLite.

export const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

export function memoryKeyring(): FoldKeyPort & FoldKeyImportPort & { key(fold: Id, epoch: number): Promise<SecretBuf | undefined>; currentEpoch(fold: Id): Promise<number | undefined> } {
  const keys = new Map<string, SecretBuf>();
  const epochsOf = (fold: Id) => [...keys.keys()].filter((k) => k.startsWith(`${fold}:`)).map((k) => Number(k.split(':')[1])).sort((a, b) => a - b);
  return {
    async createFoldKey(fold) {
      keys.set(`${fold}:1`, SecretBuf.from(rng.bytes(32)));
      return 1;
    },
    async dropFoldKeys(fold) {
      for (const k of [...keys.keys()]) if (k.startsWith(`${fold}:`)) keys.delete(k);
    },
    async importFoldKey(fold, epoch, key) {
      if (!keys.has(`${fold}:${epoch}`)) keys.set(`${fold}:${epoch}`, SecretBuf.from(key.use((b) => b)));
      key.wipe();
    },
    async epochs(fold) {
      return epochsOf(fold);
    },
    async key(fold, epoch) {
      return keys.get(`${fold}:${epoch}`);
    },
    async currentEpoch(fold) {
      return epochsOf(fold).at(-1);
    },
  };
}

export interface NodeSession extends Omit<SyncSession, 'keyImport'>, SessionServices {
  readonly keyImport: FoldKeyImportPort;
  readonly keyring: ReturnType<typeof memoryKeyring>;
  readonly deviceKeyMap: Map<string, Uint8Array>;
  setNow(ms: number): void;
}

export async function createNodeSession(secrets: Pick<SessionSecrets, 'deviceId'> & { deviceSigningKey: SecretBuf }, nowMs: () => number = Date.now): Promise<NodeSession> {
  const stores = createMemoryStores();
  const signer = createEd25519Signer();
  const devicePk = await signer.publicKey(secrets.deviceSigningKey);
  const keyring = memoryKeyring();
  const deviceKeyMap = new Map<string, Uint8Array>();
  const folds = new Map<Id, FoldSummary>();
  const directory: FoldDirectory = {
    list: async () => [...folds.values()], get: async (f) => folds.get(f), add: async (f) => void folds.set(f.id, f),
    rename: async (f, name) => void (folds.has(f) && folds.set(f, { ...folds.get(f)!, name })), remove: async (f) => void folds.delete(f),
  };
  const sealKeys = {
    foldKey: (fold: string, epoch: number) => keyring.key(fold as Id, epoch),
    deviceSigningKey: () => secrets.deviceSigningKey,
    signerPublicKey: async (_f: string, dev: string) => (dev === secrets.deviceId ? devicePk : deviceKeyMap.get(dev)),
  };
  const sealer = createOpSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys: sealKeys }) as unknown as OpSealerPort;
  const snapshotSealer = createSnapshotSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys: sealKeys }) as unknown as SealedSnapshotPort;
  const writePath = createWritePath({
    oplog: stores.oplog, projections: stores.projections, sealer, clock: { nowMs }, random: rng,
    keys: { deviceId: () => secrets.deviceId, currentEpoch: (fold) => keyring.currentEpoch(fold) },
    groups: LEDGER_GROUPS, upcasters: createUpcasters(SCHEMA_VERSION, new Map()),
  });
  const events = createEventBus();
  const commandBus = createCommandBus({ writePath, projections: stores.projections, events, roleOf: roleResolver(directory), isUnlocked: () => true });
  const cursorState = new Map<Id, { serverSeq: bigint; fromSnapshot: boolean }>();
  const cursors: SyncCursorPort = {
    get: async (f) => cursorState.get(f) ?? { serverSeq: 0n, fromSnapshot: false },
    set: async (f, s) => void cursorState.set(f, { ...s }),
  };
  const marks = new Map<Id, number>();
  return {
    oplog: stores.oplog, projections: stores.projections, writePath, directory, foldKeys: keyring, keyImport: keyring, commandBus, events, cursors, keyring, deviceKeyMap,
    deviceKeys: {
      replaceAll(rows) {
        for (const r of rows) deviceKeyMap.set(r.id, r.sigPk);
      },
      publicKey: (dev) => deviceKeyMap.get(dev),
    },
    syncMarks: { lastSyncedAt: (f) => marks.get(f), markSynced: (f, at) => void marks.set(f, at) },
    snapshotSealer, deviceId: secrets.deviceId as Id, setNow: () => undefined,
  };
}

export function memoryCredentials(): CredentialStorePort & { current(): DeviceCredentials | undefined } {
  let stored: DeviceCredentials | undefined;
  return { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined), current: () => stored };
}

export function sessionPortFor(holder: { session?: NodeSession | undefined }, build: (secrets: SessionSecrets) => Promise<NodeSession>): SessionPort {
  return {
    async start(secrets) {
      holder.session = await build(secrets);
      return holder.session;
    },
    async stop() {
      holder.session = undefined;
    },
  };
}
