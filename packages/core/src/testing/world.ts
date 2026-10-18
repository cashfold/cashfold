import { createAesGcm, createEd25519Signer, createHkdf, createOpSealer, SecretBuf, type Rng } from '@cashfold/crypto';
import type { Id } from '../shared-kernel/id.js';
import { createWritePath, type WritePath } from '../sync/application/write-path.js';
import type { GroupRegistry } from '../sync/domain/merge.js';
import type { OpLogStore, OpSealerPort, ProjectionStore } from '../sync/ports/index.js';
import { createMemoryStores } from './memory-ports.js';

/** Deterministic test identifier: `id(1)` is always the same UUID. */
export const id = (n: number): Id => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}` as Id;

const signer = createEd25519Signer();
const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };

/** Shared key directory for a group of test replicas: Fold keys per epoch and device signing keys. */
export interface World {
  addFold(fold: Id): void;
  addFoldKey(fold: Id, epoch: number): Promise<void>;
  forgetFoldKey(fold: Id, epoch: number): void;
  /** Removes every key for the Fold, as if this group of devices had been removed from it. */
  dropFold(fold: Id): void;
  setCurrentEpoch(fold: Id, epoch: number): void;
  /** @internal */ readonly internals: {
    foldKey(fold: Id, epoch: number): SecretBuf | undefined;
    currentEpoch(fold: Id): number | undefined;
    registerDevice(dev: Id, existing?: SecretBuf): Promise<SecretBuf>;
    publicKey(dev: Id): Uint8Array | undefined;
  };
}

export async function createWorld(): Promise<World> {
  const foldKeys = new Map<string, SecretBuf>();
  const epochs = new Map<Id, number>();
  const devices = new Map<Id, { publicKey: Uint8Array; secretKey: SecretBuf }>();
  const world: World = {
    addFold(fold) {
      foldKeys.set(`${fold}:1`, SecretBuf.from(osRng.bytes(32)));
      epochs.set(fold, 1);
    },
    async addFoldKey(fold, epoch) {
      foldKeys.set(`${fold}:${epoch}`, SecretBuf.from(osRng.bytes(32)));
    },
    forgetFoldKey(fold, epoch) {
      foldKeys.delete(`${fold}:${epoch}`);
    },
    dropFold(fold) {
      for (const k of [...foldKeys.keys()]) if (k.startsWith(`${fold}:`)) foldKeys.delete(k);
      epochs.delete(fold);
    },
    setCurrentEpoch(fold, epoch) {
      epochs.set(fold, epoch);
    },
    internals: {
      foldKey: (fold, epoch) => foldKeys.get(`${fold}:${epoch}`),
      currentEpoch: (fold) => epochs.get(fold),
      async registerDevice(dev, existing) {
        if (existing !== undefined) return existing;
        const pair = await signer.generate(osRng);
        devices.set(dev, pair);
        return pair.secretKey;
      },
      publicKey: (dev) => devices.get(dev)?.publicKey,
    },
  };
  return world;
}

export interface Replica {
  readonly device: Id;
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  readonly writePath: WritePath;
  setNow(ms: number): void;
  /** A second replica with the same device identity and signing key but an empty log: a restored backup or a clone. */
  fork(): Promise<Replica>;
  failNextProjectionWrite(): void;
  corruptStoredOp(index: number): void;
}

export async function createReplica(world: World, opts: { device: Id; groups?: GroupRegistry; nowMs?: number; signingKey?: SecretBuf }): Promise<Replica> {
  const { internals } = world;
  const deviceKey = await internals.registerDevice(opts.device, opts.signingKey);
  const stores = createMemoryStores();
  let now = opts.nowMs ?? 1_700_000_000_000;

  const crypt = createOpSealer({
    aead: createAesGcm(), hkdf: createHkdf(), signer, rng: osRng,
    keys: {
      foldKey: async (fold, epoch) => internals.foldKey(fold as Id, epoch),
      deviceSigningKey: () => deviceKey,
      signerPublicKey: async (_fold, dev) => internals.publicKey(dev as Id),
    },
  });
  // The crypto package types ids as plain strings; core brands them. The shapes are otherwise identical.
  const sealer = crypt as unknown as OpSealerPort;

  const writePath = createWritePath({
    oplog: stores.oplog,
    projections: stores.projections,
    sealer,
    clock: { nowMs: () => now },
    random: osRng,
    keys: { deviceId: () => opts.device, currentEpoch: async (fold) => internals.currentEpoch(fold) },
    groups: opts.groups ?? new Map(),
  });

  return {
    device: opts.device,
    oplog: stores.oplog,
    projections: stores.projections,
    writePath,
    setNow: (ms) => {
      now = ms;
    },
    fork: () => createReplica(world, { ...opts, nowMs: now, signingKey: deviceKey }),
    failNextProjectionWrite: stores.failNextProjectionWrite,
    corruptStoredOp: stores.corruptStoredOp,
  };
}
