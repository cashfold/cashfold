import {
  budgetingRepairRules, createCommandBus, createEventBus, createFoldWiper, createHistoryWriter, createLedgerQueries, createLedgerViews, createMembershipCommands, createMembershipLog, createOpAuthoriser, createQueryBus,
  createRepair, createUpcasters, createWritePath, ledgerRepairRules, LEDGER_GROUPS, purgeExpired, roleResolver, schedulingRepairRules, SCHEMA_VERSION,
  type AccountIdentity, type CommandBus, type EventBus, type FoldDirectory, type Id, type LedgerViews, type MembershipCommands, type MembershipLog, type OpLogStore, type OpSealerPort, type ProjectionStore, type QueryBus,
  type RelayLink, type SealedSnapshotPort, type SessionPort, type SessionSecrets, type SessionServices, type SharingCrypto, type SyncCursorPort, type WritePath,
} from '@cashfold/core';
import { createAesGcm, createEd25519Signer, createHkdf, createOpSealer, createSharingCrypto, createSnapshotSealer, SecretBuf, type Rng } from '@cashfold/crypto';
import { createWebMembershipRemote } from '../transport/membership-remote';
import { createSqliteAttachmentStore, type SqliteAttachmentStore } from './attachment-store';
import { createSqliteMembershipStore } from './membership-store';
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
  /** What sharing needs from the running app: this account's keys, the live session with the service, and a way to say a Fold is gone. */
  readonly sharing?: {
    identity(): AccountIdentity | undefined;
    link(): RelayLink | undefined;
    announce(event: { readonly type: string; readonly fold: Id }): void;
  };
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
  /** The membership log of each Fold and what can be done with it: invite, accept, change roles, remove, leave (US7). */
  readonly membership: MembershipLog;
  readonly sharing: MembershipCommands;
  readonly sharingCrypto: SharingCrypto;
  /** The sealed pieces of attachments kept on this device. */
  readonly attachmentStore: SqliteAttachmentStore;
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
      const sharingCrypto = createSharingCrypto({ rng }) as unknown as SharingCrypto;
      const held: { log?: MembershipLog } = {};
      const sealKeys = {
        foldKey: (fold: string, epoch: number) => keyring.key(fold as Id, epoch),
        deviceSigningKey: () => deviceKey,
        // This device's own key, and the account's other devices as the service listed them; another account's devices come
        // from the Fold's membership log, where their owners certified them.
        signerPublicKey: async (fold: string, dev: string) => {
          if (dev === secrets.deviceId) return devicePk;
          const own = deviceKeys.publicKey(dev as Id);
          if (own !== undefined) return own;
          const s = await held.log?.state(fold as Id);
          return s?.ok === true ? s.value.devices.get(dev)?.sigPk : undefined;
        },
      };
      const sealer = createOpSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys: sealKeys }) as unknown as OpSealerPort;
      const snapshotSealer = createSnapshotSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys: sealKeys }) as unknown as SealedSnapshotPort;

      const ownDevices = async () => [{ id: secrets.deviceId as Id, sigPk: devicePk, revoked: false }, ...deviceKeys.list().filter((d) => d.id !== secrets.deviceId)];
      const membershipStore = createSqliteMembershipStore(db);
      const sharingContext = options.sharing ?? { identity: () => undefined, link: () => undefined, announce: () => undefined };
      const membership = (held.log = createMembershipLog({
        store: membershipStore, remote: createWebMembershipRemote(sharingContext.link), crypto: sharingCrypto, directory, identity: sharingContext.identity, devices: ownDevices, clock: { nowMs },
      }));
      const authorise = createOpAuthoriser({ log: membership, ownAccount: () => sharingContext.identity()?.accountId, ownDevices });

      const writePath = createWritePath({
        oplog, projections, sealer, clock: { nowMs }, random: rng,
        keys: { deviceId: () => secrets.deviceId, currentEpoch: (fold) => keyring.currentEpoch(fold) },
        groups: LEDGER_GROUPS, upcasters: createUpcasters(SCHEMA_VERSION, new Map()), authorise,
      });
      const events = createEventBus();
      const buses = { writePath, projections, events, roleOf: roleResolver(directory), isUnlocked: options.isUnlocked };
      const commandBus = createCommandBus(buses);
      const queryBus = createQueryBus(buses);
      // Each account sees its own checkpoints when it joined with "from now on" history (FR-102); the rules of every context are applied.
      const views = createLedgerViews(
        events, createRepair([...ledgerRepairRules, ...budgetingRepairRules, ...schedulingRepairRules]),
        () => { const me = sharingContext.identity(); return me === undefined ? undefined : { member: me.accountId }; },
      );
      const cursors = createSqliteCursors(db);
      const attachmentStore = createSqliteAttachmentStore(db);
      const wipe = createFoldWiper({
        directory, foldKeys: keyring, membership: membershipStore,
        also: async (fold) => {
          await projections.clear(fold);
          attachmentStore.clearFold(fold);
        },
        announce: (e) => { views.invalidate(e.fold); sharingContext.announce(e); },
      });
      const sharing = createMembershipCommands({
        log: membership, keyring, history: createHistoryWriter({ projections, writePath }), wipe,
        joined: async (fold, scope) => {
          if (scope === 'from_join') await cursors.set(fold, { serverSeq: 0n, fromSnapshot: true });
        },
        today: () => { const d = new Date(nowMs()); return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate(); },
      });
      const queries = createLedgerQueries({ views, clock: { nowMs }, quarantined: (fold) => oplog.listQuarantined(fold) });
      open = {
        db, oplog, projections, writePath, events, keyring, commandBus, queryBus, queries, views, directory, foldKeys: keyring, keyImport: keyring, deviceId: secrets.deviceId as Id,
        cursors, deviceKeys, syncMarks: createSqliteSyncMarks(db), snapshotSealer, membership, sharing, sharingCrypto, attachmentStore,
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
