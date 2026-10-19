import {
  asMap, clockNotices, createRefreshRates, createSnapshotService, createSyncClient, createSyncStatus, deriveEvents, ensureRemoteFolds, idOfBytes, receiveFolds, syncAttention,
  type AccountSecrets, type ClockNotice, type CommandBus, type EventBus, type FoldDirectory, type FoldGrantPort, type FoldKeyImportPort, type FoldKeyPort, type FoldSyncStatus, type Id, type NeedsAttentionItem,
  type OpLogStore, type ProjectionStore, type RatesSourcePort, type RelayAuthPort, type RelayErrorKind, type SealedSnapshotPort, type SessionServices, type SyncCursorPort, type SyncReport, type SyncState, type WritePath,
} from '@cashfold/core';
import { SecretBuf } from '@cashfold/crypto';
import { snapshotCodec } from '../adapters/transport/snapshot-codec';
import { createRelaySnapshotTransport, createRelayTransport, RelayFailure } from '../adapters/transport/relay-ports';
import { openFoldStream, type FoldStream } from '../adapters/transport/stream';
import type { WebRelayLink } from '../adapters/transport/relay-auth';
import type { DeviceKeyStore } from '../adapters/sqlite-opfs/sync-stores';

// The background sync of one unlocked session. It signs in to the user's service with the cached SRP-x, learns the account's
// devices and Folds, then keeps every Fold in step: pushing local changes, pulling and applying others', on a nudge from the
// stream, on a local change, on a timer, and when the network returns. Nothing here is on the path of a local edit: the app
// works the same offline, and this service only moves bytes when there is a service to move them to.

/** What the service needs from an open session (the web session satisfies it; tests supply one over memory). */
export interface SyncSession {
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  readonly writePath: WritePath;
  readonly directory: FoldDirectory;
  readonly foldKeys: FoldKeyPort;
  readonly keyImport: FoldKeyImportPort;
  readonly commandBus: CommandBus;
  readonly events: EventBus;
  readonly cursors: SyncCursorPort;
  readonly deviceKeys: DeviceKeyStore;
  readonly syncMarks: { lastSyncedAt(fold: Id): number | undefined; markSynced(fold: Id, atMs: number): void };
  readonly snapshotSealer: SealedSnapshotPort;
  readonly deviceId: Id;
}

export interface SyncIdentity {
  readonly email: string;
  readonly accountId: string;
  readonly server: string;
  readonly account: AccountSecrets;
  readonly publicKeys: { readonly enc: Uint8Array; readonly sig: Uint8Array };
}

/** Where the connection to the service stands, apart from how each Fold is doing. */
export type Connection =
  | 'idle'
  | 'connecting'
  | 'online'
  /** The service cannot be reached; the next attempt is already scheduled. */
  | 'offline'
  /** The service did not accept the stored credentials: the password or Secret Key changed elsewhere. */
  | 'needs_password'
  /** This device was removed from the account, or the account was deleted. */
  | 'removed'
  /** This account has never been registered with a service. */
  | 'not_registered';

export interface SyncSnapshot {
  readonly connection: Connection;
  readonly overall: SyncState;
  readonly folds: readonly FoldSyncStatus[];
  readonly attention: readonly NeedsAttentionItem[];
  readonly clock: readonly ClockNotice[];
}

export interface SyncServiceDeps {
  readonly auth: RelayAuthPort;
  readonly grants: FoldGrantPort;
  readonly session: () => SyncSession | undefined;
  readonly nowMs: () => number;
  /** Told whenever the status changes or other devices' changes were applied. */
  readonly publish: (event: { readonly type: string; readonly [key: string]: unknown }) => void;
  readonly ratesSource?: (server: string) => RatesSourcePort;
  readonly openStream?: typeof openFoldStream;
  readonly timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  readonly pollMs?: number;
  readonly retryMs?: { readonly first: number; readonly max: number };
  readonly ratesEveryMs?: number;
  /** After this many changes a snapshot is published, so new devices start close to the head. */
  readonly snapshotEvery?: number;
}

export interface SyncService {
  /** Begins syncing for this identity. Does nothing for an account that is not registered with a service. */
  start(identity: SyncIdentity, registration: 'done' | 'pending'): void;
  /** Ends everything: streams, timers, the session with the service. Called when the app locks. */
  stop(): void;
  /** One round now, whatever the timers say. Resolves when it has finished. */
  syncNow(): Promise<void>;
  snapshot(): Promise<SyncSnapshot>;
  /** The live session with the service, if signed in (device management and email verification use it). */
  link(): WebRelayLink | undefined;
}

const LOCAL_CHANGES: ReadonlySet<string> = new Set(['RecordCreated', 'RecordChanged', 'RecordDeleted', 'RecordRestored']);

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const timers = deps.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const pollMs = deps.pollMs ?? 30_000;
  const retry = deps.retryMs ?? { first: 2_000, max: 5 * 60_000 };
  const ratesEvery = deps.ratesEveryMs ?? 6 * 3_600_000;
  const snapshotEvery = deps.snapshotEvery ?? 200;
  const status = createSyncStatus();

  let identity: SyncIdentity | undefined;
  let registration: 'done' | 'pending' = 'pending';
  let generation = 0; // bumped by stop(); work started under an older generation discards its results
  let connection: Connection = 'idle';
  let link: WebRelayLink | undefined;
  let streams = new Map<Id, FoldStream>();
  let pollTimer: unknown;
  let retryTimer: unknown;
  let nudgeTimer: unknown;
  let backoff = retry.first;
  let running: Promise<void> | undefined;
  let again = false;
  let applyingRemote = false;
  let unsubscribe: (() => void) | undefined;
  let lastRates = 0;
  const reports = new Map<Id, SyncReport>();
  const lastPublished = new Map<Id, bigint>();

  const changed = (): void => deps.publish({ type: 'SyncChanged' });
  const setConnection = (next: Connection): void => {
    if (connection !== next) {
      connection = next;
      changed();
    }
  };
  const live = (g: number): boolean => g === generation && identity !== undefined && deps.session() !== undefined;
  const clear = (h: unknown): void => {
    if (h !== undefined) timers.clear(h);
  };

  function closeLink(): void {
    for (const s of streams.values()) s.close();
    streams = new Map();
    link?.close();
    link = undefined;
  }

  function scheduleRetry(afterMs?: number): void {
    clear(retryTimer);
    const wait = afterMs ?? backoff;
    backoff = Math.min(backoff * 2, retry.max);
    retryTimer = timers.set(() => void connect(), wait);
  }

  async function connect(): Promise<void> {
    const g = generation;
    const id = identity;
    if (id === undefined || !live(g) || connection === 'connecting') return;
    setConnection('connecting');
    const srpX = id.account.srpX;
    const signed = await deps.auth.signIn({
      server: id.server, email: id.email, deviceId: deps.session()!.deviceId,
      deriveX: async () => SecretBuf.from(srpX.use((b) => b)),
    }).catch(() => ({ ok: false as const, kind: 'protocol' as RelayErrorKind }));
    if (!live(g)) {
      if (signed.ok) signed.link.close();
      return;
    }
    if (!signed.ok) {
      switch (signed.kind) {
        case 'revoked':
          setConnection('removed');
          deps.publish({ type: 'DeviceRemoved' });
          return;
        case 'rejected':
          setConnection('needs_password');
          return;
        case 'rate_limited':
          setConnection('offline');
          scheduleRetry(60_000);
          return;
        default:
          setConnection('offline');
          scheduleRetry();
          return;
      }
    }
    link = signed.link as WebRelayLink;
    backoff = retry.first;
    setConnection('online');
    await onConnected(g);
  }

  async function onConnected(g: number): Promise<void> {
    const s = deps.session();
    const l = link;
    const id = identity;
    if (s === undefined || l === undefined || id === undefined || !live(g)) return;

    // Who else signs for this account, so their ops can be verified.
    const devices = await l.request('GET', '/devices');
    if (devices.ok && Array.isArray(devices.body)) {
      const rows = [];
      for (const row of devices.body as unknown[]) {
        const m = asMap(row);
        const devId = idOfBytes(m.get('dev_id'));
        const sigPk = m.get('sig_pk');
        if (devId !== undefined && sigPk instanceof Uint8Array) rows.push({ id: devId, sigPk, revoked: m.has('revoked_at') });
      }
      s.deviceKeys.replaceAll(rows, deps.nowMs());
    }

    // Folds made offline reach the service; Folds made on other devices reach this one.
    const services: SessionServices = { commandBus: s.commandBus, directory: s.directory, foldKeys: s.foldKeys, keyImport: s.keyImport };
    const ensured = await ensureRemoteFolds({ link: l, directory: s.directory, grants: deps.grants, account: id.account, accountId: id.accountId, publicKeys: id.publicKeys });
    if (!ensured.ok && ensured.kind === 'gone') return void gone();
    if (!live(g)) return;
    await receiveFolds({ link: l, grants: deps.grants, services, account: id.account, publicKeys: id.publicKeys });

    await syncAll();
    if (!live(g)) return;
    for (const fold of await s.directory.list()) void openStream(g, fold.id);
    armPoll(g);
  }

  function gone(): void {
    closeLink();
    setConnection('removed');
    deps.publish({ type: 'DeviceRemoved' });
  }

  async function openStream(g: number, fold: Id): Promise<void> {
    const l = link;
    if (l === undefined || streams.has(fold) || !live(g)) return;
    const open = deps.openStream ?? openFoldStream;
    const stream = await open({
      link: l, fold,
      onNudge: () => schedule(0),
      onClose: () => {
        streams.delete(fold);
        if (live(g) && link === l) scheduleStreamReopen(g, fold);
      },
    }).catch(() => undefined);
    if (stream !== undefined && live(g) && link === l) streams.set(fold, stream);
    else stream?.close();
  }

  function scheduleStreamReopen(g: number, fold: Id): void {
    timers.set(() => void openStream(g, fold), 15_000);
  }

  function armPoll(g: number): void {
    clear(pollTimer);
    pollTimer = timers.set(() => {
      if (live(g)) void syncAll().finally(() => armPoll(g));
    }, pollMs);
  }

  function schedule(delayMs: number): void {
    clear(nudgeTimer);
    nudgeTimer = timers.set(() => void syncAll(), delayMs);
  }

  function syncAll(): Promise<void> {
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await syncRound();
        } while (again);
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  async function syncRound(): Promise<void> {
    const g = generation;
    const s = deps.session();
    const l = link;
    const id = identity;
    if (s === undefined || l === undefined || id === undefined || connection !== 'online') return;

    const transport = createRelayTransport(l);
    const snapshots = createSnapshotService({
      codec: snapshotCodec, oplog: s.oplog, projections: s.projections, cursors: s.cursors, keys: { deviceId: () => s.deviceId, currentEpoch: async (f) => (await s.keyImport.epochs(f)).at(-1) },
      sealer: s.snapshotSealer, transport: createRelaySnapshotTransport(l),
    });
    for (const summary of await s.directory.list()) {
      if (!live(g)) return;
      status.begin(summary.id);
      changed();
      const client = createSyncClient({
        oplog: s.oplog, writePath: s.writePath, cursors: s.cursors, clock: { nowMs: deps.nowMs },
        transport: {
          push: (f, ops) => transport.push(f, ops),
          pull: (f, after, limit) => transport.pull(f, after, limit),
        },
        onApplied: (fold, outcome) => {
          applyingRemote = true;
          try {
            s.events.publish(deriveEvents(fold, outcome));
          } finally {
            applyingRemote = false;
          }
        },
      });
      let report: SyncReport;
      try {
        report = await client.syncFold(summary.id);
      } catch (e) {
        report = { pushed: 0, pulled: 0, applied: 0, duplicates: 0, quarantined: 0, ignored: 0, head: 0n, rejectedOps: [], failure: e instanceof RelayFailure && e.kind === 'offline' ? 'offline' : 'failed' };
      }
      if (!live(g)) return;
      reports.set(summary.id, report);
      const pending = (await s.oplog.listPending(summary.id)).length;
      status.finish(summary.id, report, deps.nowMs(), pending);
      if (report.failure === undefined) {
        s.syncMarks.markSynced(summary.id, deps.nowMs());
        await snapshots.acknowledge(summary.id).catch(() => undefined);
        const at = (await s.cursors.get(summary.id)).serverSeq;
        if (at - (lastPublished.get(summary.id) ?? 0n) >= BigInt(snapshotEvery)) {
          if ((await snapshots.publish(summary.id)) === 'published') lastPublished.set(summary.id, at);
        }
      } else if (report.failure === 'offline') {
        sessionLost(g);
      }
      if (report.applied > 0) deps.publish({ type: 'RemoteChanged', fold: summary.id });
      changed();
    }
    void refreshRates(g);
  }

  /** A request failed because the network did; the session may be gone too, so sign in again from scratch. */
  function sessionLost(g: number): void {
    if (!live(g)) return;
    closeLink();
    clear(pollTimer);
    setConnection('offline');
    scheduleRetry();
  }

  async function refreshRates(g: number): Promise<void> {
    const s = deps.session();
    const id = identity;
    if (s === undefined || id === undefined || deps.ratesSource === undefined || !live(g) || deps.nowMs() - lastRates < ratesEvery) return;
    lastRates = deps.nowMs();
    const refresh = createRefreshRates({ source: deps.ratesSource(id.server) });
    for (const f of await s.directory.list()) await s.commandBus.execute(refresh, { fold: f.id }).catch(() => undefined);
  }

  return {
    start(next, reg) {
      this.stop();
      identity = next;
      registration = reg;
      generation++;
      const s = deps.session();
      if (s === undefined) return;
      unsubscribe = s.events.subscribe((e) => {
        if (LOCAL_CHANGES.has(e.type) && !applyingRemote) schedule(300);
      });
      if (reg !== 'done') {
        setConnection('not_registered');
        return;
      }
      backoff = retry.first;
      void connect();
    },

    stop() {
      generation++;
      unsubscribe?.();
      unsubscribe = undefined;
      for (const t of [pollTimer, retryTimer, nudgeTimer]) clear(t);
      pollTimer = retryTimer = nudgeTimer = undefined;
      closeLink();
      identity = undefined;
      running = undefined;
      again = false;
      reports.clear();
      lastPublished.clear();
      connection = 'idle';
    },

    async syncNow() {
      if (identity === undefined) return;
      if (link === undefined && registration === 'done' && connection !== 'connecting' && connection !== 'removed' && connection !== 'needs_password') {
        clear(retryTimer);
        await connect();
        return;
      }
      await syncAll();
    },

    async snapshot() {
      const s = deps.session();
      const quarantined = [];
      const folds = status.folds();
      // Quarantined ops are listed with the ledger's own Needs attention; what sync adds is refused changes and a relay that skips ops.
      let attention: NeedsAttentionItem[] = [];
      if (s !== undefined) {
        for (const f of await s.directory.list()) {
          quarantined.push(...(await s.oplog.listQuarantined(f.id)));
          const report = reports.get(f.id);
          if (report !== undefined) attention = attention.concat(syncAttention(report));
        }
      }
      return { connection, overall: connection === 'removed' || connection === 'needs_password' ? 'error' : status.overall(), folds, attention, clock: clockNotices(quarantined, deps.nowMs()) };
    },

    link: () => link,
  };
}
