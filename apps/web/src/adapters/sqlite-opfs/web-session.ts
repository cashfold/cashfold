import {
  createCommandBus, createEventBus, createLedgerQueries, createLedgerViews, createQueryBus, createUpcasters, createWritePath, LEDGER_GROUPS, purgeExpired, roleResolver, SCHEMA_VERSION,
  type CommandBus, type EventBus, type FoldDirectory, type Id, type LedgerViews, type OpLogStore, type OpSealerPort, type ProjectionStore, type QueryBus, type SealedSnapshotPort, type SessionPort, type SessionSecrets, type SessionServices,
  type SyncCursorPort, type WritePath,
} from '@cashfold/core';
import { createAesGcm, createEd25519Signer, createHkdf, createOpSealer, createSnapshotSealer, SecretBuf, type Rng } from '@cashfold/crypto';
import type { EncryptedDatabase } from './database';
import { EncryptedDatabase as Database } from './database';
import { createFoldKeyring, createSqliteFoldDirectory, type FoldKeyring } from './fold-store';
import { migrate } from './migrate';
import type { SqliteRuntime } from './runtime';
import { createSqliteOpLog, createSqliteProjections } from './sqlite-stores';
import { createSqliteCursors, createSqliteDeviceKeys, createSqliteSyncMarks, type DeviceKeyStore } from './sync-stores';

export interface WebSessionOptions {
  readonly runtime: SqliteRuntime;
  readonly rng: Rng;
  readonly nowMs?: () => number;
  readonly file?: string;
  /** Whether the app is currently unlocked: commands are refused otherwise. */
  readonly isUnlocked: () => boolean;
}

/** Everything wired for one unlocked session. */
export interface OpenSession extends SessionServices {
  readonly db: EncryptedDatabase;
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  readonly writePath: WritePath;
  readonly events: EventBus;
  readonly keyring: FoldKeyring;
  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;
  readonly queries: ReturnType<typeof createLedgerQueries>;
  readonly views: LedgerViews;
  readonly directory: FoldDirectory;
  /** This device's id, so the page can tell its own changes from other devices' (FR-053). */
  readonly deviceId: Id;
  readonly cursors: SyncCursorPort;
  /** Signing keys of the account's devices, which is how ops written elsewhere are verified. */
  readonly deviceKeys: DeviceKeyStore;
  readonly syncMarks: ReturnType<typeof createSqliteSyncMarks>;
  readonly snapshotSealer: SealedSnapshotPort;
}

async function purgeAllFolds(stores: { oplog: OpLogStore; projections: ProjectionStore }, directory: FoldDirectory, now: number): Promise<void> {
  for (const fold of await directory.list()) await purgeExpired(stores, fold.id, now);
}

/** The SessionPort for the browser: opens the encrypted database, migrates it and wires the write path over it. */
export function createWebSession(options: WebSessionOptions): SessionPort & { current(): OpenSession | undefined } {
  const { runtime, rng } = options;
  const nowMs = options.nowMs ?? Date.now;
  let open: OpenSession | undefined;

  async function start(secrets: SessionSecrets): Promise<OpenSession> {
    const db = Database.open(runtime, options.file ?? '/cashfold.db', secrets.sessionKey as SecretBuf);
    try {
      await migrate(db);
      const signer = createEd25519Signer();
      const deviceKey = secrets.deviceSigningKey as SecretBuf;
      const devicePk = await signer.publicKey(deviceKey);
      const keyring = createFoldKeyring(db, { databaseKey: secrets.sessionKey as SecretBuf, rng });
      const directory = createSqliteFoldDirectory(db, nowMs);
      const oplog = createSqliteOpLog(db);
      const projections = createSqliteProjections(db);

      const deviceKeys = createSqliteDeviceKeys(db);
      const sealKeys = {
        foldKey: (fold: string, epoch: number) => keyring.key(fold as Id, epoch),
        deviceSigningKey: () => deviceKey,
        // This device's own key, and the account's other devices as the service listed them. Another account's devices
        // (a shared Fold) will come from that Fold's membership log.
        signerPublicKey: async (_fold: string, dev: string) => (dev === secrets.deviceId ? devicePk : deviceKeys.publicKey(dev as Id)),
      };
      const sealer = createOpSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys: sealKeys }) as unknown as OpSealerPort;
      const snapshotSealer = createSnapshotSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys: sealKeys }) as unknown as SealedSnapshotPort;

      const writePath = createWritePath({
        oplog, projections, sealer, clock: { nowMs }, random: rng,
        keys: { deviceId: () => secrets.deviceId, currentEpoch: (fold) => keyring.currentEpoch(fold) },
        groups: LEDGER_GROUPS, upcasters: createUpcasters(SCHEMA_VERSION, new Map()),
      });
      const events = createEventBus();
      const buses = { writePath, projections, events, roleOf: roleResolver(directory), isUnlocked: options.isUnlocked };
      const commandBus = createCommandBus(buses);
      const queryBus = createQueryBus(buses);
      const views = createLedgerViews(events);
      const queries = createLedgerQueries({ views, clock: { nowMs }, quarantined: (fold) => oplog.listQuarantined(fold) });
      open = {
        db, oplog, projections, writePath, events, keyring, commandBus, queryBus, queries, views, directory, foldKeys: keyring, keyImport: keyring, deviceId: secrets.deviceId as Id,
        cursors: createSqliteCursors(db), deviceKeys, syncMarks: createSqliteSyncMarks(db), snapshotSealer,
      };

      // Deleted records older than 30 days are removed for good (FR-052). Done at every start, which is when a
      // long-closed app catches up; a failure here must not stop the app from opening.
      await purgeAllFolds({ oplog, projections }, directory, nowMs()).catch(() => undefined);
      return open;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  return {
    start,
    async stop() {
      open?.keyring.wipe();
      open?.db.close();
      open = undefined;
    },
    current: () => open,
  };
}
