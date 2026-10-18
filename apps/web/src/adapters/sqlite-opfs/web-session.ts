import {
  createCommandBus, createEventBus, createUpcasters, createWritePath, roleResolver, SCHEMA_VERSION,
  type CommandBus, type EventBus, type FoldDirectory, type Id, type OpLogStore, type OpSealerPort, type ProjectionStore, type SessionPort, type SessionSecrets, type SessionServices, type WritePath,
} from '@cashfold/core';
import { createAesGcm, createEd25519Signer, createHkdf, createOpSealer, SecretBuf, type Rng } from '@cashfold/crypto';
import type { EncryptedDatabase } from './database';
import { EncryptedDatabase as Database } from './database';
import { createFoldKeyring, createSqliteFoldDirectory, type FoldKeyring } from './fold-store';
import { migrate } from './migrate';
import type { SqliteRuntime } from './runtime';
import { createSqliteOpLog, createSqliteProjections } from './sqlite-stores';

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
  readonly directory: FoldDirectory;
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

      const sealer = createOpSealer({
        aead: createAesGcm(), hkdf: createHkdf(), signer, rng,
        keys: {
          foldKey: (fold, epoch) => keyring.key(fold as Id, epoch),
          deviceSigningKey: () => deviceKey,
          // Other devices' keys come from the Fold's membership log (sharing story); until then only this device signs.
          signerPublicKey: async (_fold, dev) => (dev === secrets.deviceId ? devicePk : undefined),
        },
      }) as unknown as OpSealerPort;

      const writePath = createWritePath({
        oplog, projections, sealer, clock: { nowMs }, random: rng,
        keys: { deviceId: () => secrets.deviceId, currentEpoch: (fold) => keyring.currentEpoch(fold) },
        groups: new Map(), upcasters: createUpcasters(SCHEMA_VERSION, new Map()),
      });
      const events = createEventBus();
      const commandBus = createCommandBus({ writePath, projections, events, roleOf: roleResolver(directory), isUnlocked: options.isUnlocked });
      open = { db, oplog, projections, writePath, events, keyring, commandBus, directory, foldKeys: keyring };
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
