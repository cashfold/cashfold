import {
  createAccount, createCategoryCommands, recoverAccount, createMaterialiser, createDeviceManager, createEmailVerification, createFoldCommands, createQuickUnlock, createRefreshRates, createSession, describeFoldDeletion, DEFAULT_LOCK_POLICY, newIdV4, registerExisting, signInOnNewDevice, unlock,
  parseSettings, toLockPolicy, type AccountCryptoPort, type CredentialChangeCryptoPort, type CredentialStorePort, type MigrationCryptoPort, type RecoveryCryptoPort, type DeviceLabelPort, type DeviceSettings, type DeviceSettingsPort, type EnrolCryptoPort, type Id, type LockPolicy, type QuickUnlockCryptoPort, type QuickUnlockStorePort,
  type AccountIdentity, type RatesSourcePort, type RegisterExistingCryptoPort, type RegistrationPort, type RelayAuthPort, type Session, type SessionPort, type UnlockCryptoPort,
} from '@cashfold/core';
import { SecretBuf } from '@cashfold/crypto';
import { createWebSession } from '../adapters/sqlite-opfs/web-session';
import type { SqliteRuntime } from '../adapters/sqlite-opfs/runtime';
import { createAttachments, snapshotSignerAllowed } from '@cashfold/core';
import { createWebAttachmentCrypto } from '../adapters/attachment-crypto';
import { createWebAttachmentTransport } from '../adapters/transport/attachment-transport';
import { createAccountHandlers } from './account-handlers';
import { createLedgerHandlers } from './ledger-handlers';
import { createSharingHandlers } from './sharing-handlers';
import { createFoldGrantPort } from '../adapters/transport/fold-grants';
import { createSyncService, type SyncIdentity, type SyncService, type SyncSession } from './sync-service';
import { RpcError, type Handlers } from './rpc';

// The Core Worker's application surface (contracts/core-api.md). Everything crossing the RPC boundary is plain data:
// passwords arrive as bytes so the page can wipe its copy, and results are `{ ok, value | error }` objects.
// Nothing secret ever goes back to the page except the Secret Key, once, at sign-up.

export interface AppHandlerDeps {
  readonly runtime: () => Promise<SqliteRuntime>;
  readonly rng: { bytes(n: number): Uint8Array };
  readonly credentials: CredentialStorePort;
  readonly accountCrypto: AccountCryptoPort & UnlockCryptoPort;
  readonly settings: DeviceSettingsPort;
  readonly quickStore: QuickUnlockStorePort;
  readonly quickCrypto: QuickUnlockCryptoPort;
  readonly nowMs: () => number;
  /** Called after the session locks itself (idle, hidden, page gone): announce and end the worker. */
  readonly onLocked: () => void;
  readonly lockPolicy?: LockPolicy;
  // Sync (US4). Every part is optional: without them the app is purely local, exactly as before.
  readonly relayAuth?: RelayAuthPort;
  readonly registration?: RegistrationPort;
  readonly enrolCrypto?: EnrolCryptoPort;
  readonly registerCrypto?: RegisterExistingCryptoPort;
  /** Changing credentials, moving to another service and the Recovery Key (US9). */
  readonly credentialCrypto?: { readonly credentialChange: CredentialChangeCryptoPort; readonly migration: MigrationCryptoPort; readonly recovery: RecoveryCryptoPort };
  readonly deviceLabels?: DeviceLabelPort;
  readonly ratesSource?: (server: string) => RatesSourcePort;
  readonly confirmEmail?: (server: string, token: string) => Promise<{ ok: true } | { ok: false; kind: string }>;
  /** Told about changes the page should reflect (sync status, other devices' changes, this device's removal). */
  readonly publish?: (event: { readonly type: string; readonly [key: string]: unknown }) => void;
  /** Erases this device's database. Used when the device is removed from the account. */
  readonly eraseLocalData?: () => Promise<void>;
  readonly syncTimers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export type Phase = 'no_account' | 'locked' | 'unlocked';

export interface AppRuntime {
  readonly handlers: Handlers;
  readonly session: Session;
}

const secretFrom = (bytes: unknown): SecretBuf => {
  if (!(bytes instanceof Uint8Array)) throw new RpcError('TypeError', 'bad_argument');
  const secret = SecretBuf.from(bytes);
  bytes.fill(0); // the copy that crossed the boundary is not needed any more
  return secret;
};

export function createAppHandlers(deps: AppHandlerDeps): AppRuntime {
  let webSession: ReturnType<typeof createWebSession> | undefined;
  const quickHolder: { quick?: ReturnType<typeof createQuickUnlock> } = {};
  let sync: SyncService | undefined;
  let identity: SyncIdentity | undefined;
  /** This account's keys for sharing: valid only while unlocked (the secrets are wiped with the session). */
  let sharingIdentity: AccountIdentity | undefined;
  const publishEvent = (event: { readonly type: string; readonly [key: string]: unknown }): void => (deps.publish ?? (() => undefined))(event);
  const session = createSession({
    closeDatabase: async () => {
      sync?.stop();
      sharingIdentity = undefined;
      await webSession?.stop();
      await quickHolder.quick?.markLocked().catch(() => undefined); // the inactivity period for quick unlock runs from here
    },
    terminateWorker: deps.onLocked,
    policy: deps.lockPolicy ?? DEFAULT_LOCK_POLICY,
    nowMs: deps.nowMs,
  });

  async function newWebSession() {
    webSession = createWebSession({
      runtime: await deps.runtime(), rng: deps.rng, nowMs: deps.nowMs, isUnlocked: () => session.state() === 'unlocked',
      sharing: { identity: () => sharingIdentity, link: () => sync?.link(), announce: (e) => publishEvent({ type: e.type, fold: e.fold }) },
    });
    return webSession;
  }

  // Quick unlock starts its own session through the same wiring as the password path.
  const lazySession: SessionPort = {
    start: async (secrets) => (await newWebSession()).start(secrets),
    stop: async () => void (await webSession?.stop()),
  };
  const quick = createQuickUnlock({ crypto: deps.quickCrypto, store: deps.quickStore, settings: deps.settings, credentials: deps.credentials, sessionPort: lazySession, session, nowMs: deps.nowMs });
  quickHolder.quick = quick;

  /** Applies the saved lock preferences to the running session. */
  const applySettings = async () => session.setPolicy(toLockPolicy(await deps.settings.load()));

  const open = () => {
    const current = webSession?.current();
    if (current === undefined || session.state() !== 'unlocked') throw new RpcError('RpcError', 'locked');
    session.activity();
    return current;
  };

  /** A new Fold gets the default categories as ordinary records (FR-048). Best effort: the Fold exists either way. */
  const seedCategories = async (fold: Id, names?: Readonly<Record<string, string>>): Promise<void> => {
    const current = webSession?.current();
    if (current === undefined) return;
    await current.commandBus.execute(createCategoryCommands().seedDefaultCategories, { fold, ...(names === undefined ? {} : { names }) }).catch(() => undefined);
  };

  // Occurrences that fell due while this device was away, or arrived with another device's changes, are created now.
  const materialiser = createMaterialiser({ clock: { nowMs: deps.nowMs } });
  const materialise = async (fold: Id): Promise<void> => {
    const current = webSession?.current();
    if (current === undefined) return;
    const done = await current.commandBus.execute(materialiser.materialiseDue, { fold, tzOffsetMin: -new Date().getTimezoneOffset() }).catch(() => undefined);
    if (done?.ok === true && done.value.created > 0) (deps.publish ?? (() => undefined))({ type: 'RemoteChanged', fold });
  };

  /** Erases what this device holds: credentials, quick unlock, the database file. Then locks. */
  async function eraseEverything(): Promise<void> {
    await deps.credentials.clear().catch(() => undefined);
    await deps.quickStore.clear().catch(() => undefined);
    try {
      webSession?.current()?.db.destroy();
    } catch {
      // The file is removed by eraseLocalData below if it is still there.
    }
    await deps.eraseLocalData?.().catch(() => undefined);
    await session.lock();
  }

  const grants = createFoldGrantPort({ keyring: () => webSession?.current()?.keyring, rng: deps.rng });
  const publish = deps.publish ?? (() => undefined);
  /** Attachments: sealed here, kept here, sent when the service can be reached, fetched on the first open elsewhere (FR-093). */
  const attachmentsFor = () => {
    const current = webSession?.current();
    if (current === undefined) throw new RpcError('RpcError', 'locked');
    return createAttachments({
      crypto: createWebAttachmentCrypto({ keyring: () => webSession?.current()?.keyring, rng: deps.rng }),
      store: current.attachmentStore, transport: createWebAttachmentTransport(() => sync?.link()),
      epochOf: (fold) => current.keyring.currentEpoch(fold),
    });
  };

  if (deps.relayAuth !== undefined) {
    sync = createSyncService({
      afterRound: async () => void (await attachmentsFor().upload()),
      auth: deps.relayAuth, grants, session: () => webSession?.current() as SyncSession | undefined, nowMs: deps.nowMs,
      ...(deps.ratesSource && { ratesSource: deps.ratesSource }), ...(deps.syncTimers && { timers: deps.syncTimers }),
      sharing: {
        async upkeep(fold) {
          const result = await webSession?.current()?.sharing.upkeep(fold);
          return result?.ok === true && result.value.outcome === 'wiped' ? 'wiped' : 'ok';
        },
        async adopt() {
          const joined = await webSession?.current()?.sharing.adoptAccepted();
          if (joined?.ok === true && joined.value.length > 0) publishEvent({ type: 'RemoteChanged', fold: joined.value[0] });
        },
        async mayPublishSnapshot(fold) {
          const current = webSession?.current();
          const me = sharingIdentity?.accountId;
          if (current === undefined || me === undefined) return true;
          const state = await current.membership.state(fold);
          const mine = state.ok ? state.value.members.get(me) : undefined;
          return mine === undefined || mine.scope === 'full';
        },
        async mayTrustSnapshot(fold, device) {
          const current = webSession?.current();
          if (current === undefined) return true;
          const state = await current.membership.state(fold);
          // A Fold that was never shared has no log: only this account's own devices write to it.
          if (!state.ok || state.value.length === 0) return true;
          const own = device === current.deviceId || current.deviceKeys.publicKey(device) !== undefined;
          return snapshotSignerAllowed(state.value, device, own ? sharingIdentity?.accountId : undefined);
        },
      },
      publish: (event) => {
        publish(event);
        if (event.type === 'RemoteChanged' && typeof event['fold'] === 'string') void materialise(event['fold'] as Id);
        // A device that has been removed from the account erases what it holds (FR-010): nothing more syncs, and nothing stays.
        if (event.type === 'DeviceRemoved') void eraseEverything();
      },
    });
  }
  const startSync = (next: SyncIdentity, registration: 'done' | 'pending'): void => {
    identity = next;
    sharingIdentity = { accountId: next.accountId, email: next.email, encPk: next.publicKeys.enc, sigPk: next.publicKeys.sig, encSk: next.account.encSk, sigSk: next.account.sigSk };
    webSession?.current()?.views.invalidate(); // the view of each Fold depends on whose checkpoints apply
    sync?.start(next, registration);
  };
  const needSync = (): { sync: SyncService; identity: SyncIdentity } => {
    if (sync === undefined || identity === undefined) throw new RpcError('RpcError', 'sync_unavailable');
    return { sync, identity };
  };
  const sessionDeviceId = (): Id => {
    const current = webSession?.current();
    if (current === undefined) throw new RpcError('RpcError', 'locked');
    return current.deviceId;
  };

  const ledger = createLedgerHandlers({ open, clock: { nowMs: deps.nowMs }, rng: deps.rng });
  const sharingHandlers: Record<string, Handlers[string]> = { ...createSharingHandlers({ open, identity: () => sharingIdentity, rng: deps.rng, nowMs: deps.nowMs }) };
  // A change to who is in a Fold, or an invitation taken up, is worth telling the service about at once rather than at the next poll.
  for (const method of ['sharing.invite', 'sharing.accept', 'sharing.decline', 'sharing.changeRole', 'sharing.remove', 'sharing.transfer', 'sharing.leave']) {
    const original = sharingHandlers[method]!;
    sharingHandlers[method] = (async (...args: Parameters<typeof original>) => {
      const result = (await original(...args)) as { ok?: boolean };
      if (result?.ok === true) void sync?.syncNow().catch(() => undefined);
      return result;
    }) as typeof original;
  }

  const accountHandlers = createAccountHandlers({
    open, session, credentials: deps.credentials, relayAuth: deps.relayAuth, registration: deps.registration, crypto: deps.credentialCrypto, grants, rng: deps.rng,
    identity: () => identity,
    restartSync: (next) => {
      sync?.stop();
      startSync(next, 'done');
    },
    eraseEverything,
    syncNow: () => void sync?.syncNow().catch(() => undefined),
    settings: deps.settings,
    nowMs: deps.nowMs,
  });

  const needLabels = (): DeviceLabelPort => {
    if (deps.deviceLabels === undefined) throw new RpcError('RpcError', 'sync_unavailable');
    return deps.deviceLabels;
  };
  const emailVerification = () => {
    const { identity: id } = needSync();
    return createEmailVerification({ link: () => sync?.link(), confirm: (token) => (deps.confirmEmail ? deps.confirmEmail(id.server, token) : Promise.resolve({ ok: false as const, kind: 'offline' })) });
  };

  const handlers: Handlers = {
    ...ledger,
    ...sharingHandlers,
    ...accountHandlers,

    async 'attachments.attach'(args: { fold: Id; transaction: Id; name: string; mime: string; bytes: Uint8Array }) {
      const s = open();
      const service = attachmentsFor();
      const result = await s.commandBus.execute(service.attachFile, { fold: args.fold, transaction: args.transaction, id: newIdV4((n) => deps.rng.bytes(n)), name: args.name, mime: args.mime, bytes: args.bytes });
      if (result.ok) void service.upload().then(() => sync?.syncNow()).catch(() => undefined);
      return result;
    },

    async 'attachments.open'(args: { fold: Id; transaction: Id }) {
      const s = open();
      return attachmentsFor().open(s.projections, args.fold, args.transaction);
    },

    async 'attachments.remove'(args: { fold: Id; transaction: Id }) {
      const s = open();
      return s.commandBus.execute(attachmentsFor().removeAttachment, args);
    },
    async status() {
      const stored = await deps.credentials.load();
      const phase: Phase = stored === undefined ? 'no_account' : webSession?.current() !== undefined && session.state() === 'unlocked' ? 'unlocked' : 'locked';
      return stored === undefined
        ? { phase }
        : { phase, email: stored.email, accountId: stored.accountId, server: stored.server, registration: stored.registration };
    },

    async createAccount(args: { email: string; password: Uint8Array; server: string; discoverable: boolean; foldName?: string; baseCurrency?: string; categoryNames?: Record<string, string> }) {
      const sessionPort = await newWebSession();
      const input = { email: args.email, password: secretFrom(args.password), server: args.server, discoverable: args.discoverable, ...(args.foldName === undefined ? {} : { foldName: args.foldName }), ...(args.baseCurrency === undefined ? {} : { baseCurrency: args.baseCurrency }) };
      const result = await createAccount({ crypto: deps.accountCrypto, registration: deps.registration ?? { register: async () => ({ ok: false, reason: 'offline' }) }, credentials: deps.credentials, sessionPort, session, random: deps.rng })(input);
      if (result.ok) {
        await applySettings();
        await seedCategories(result.value.fold.id, args.categoryNames); // the first Fold starts with the default category set, in the person's language
        if (result.value.sync !== undefined) startSync({ email: args.email.trim().toLowerCase(), accountId: result.value.accountId, server: args.server, ...result.value.sync }, result.value.registration);
      }
      return result.ok ? { ok: true, value: { secretKeyText: result.value.secretKeyText, accountId: result.value.accountId, fold: result.value.fold, registration: result.value.registration } } : result;
    },

    async unlock(args: { password: Uint8Array }) {
      const sessionPort = await newWebSession();
      const result = await unlock({ unlockCrypto: deps.accountCrypto, credentials: deps.credentials, sessionPort, session })({ password: secretFrom(args.password) });
      if (result.ok) {
        await applySettings();
        await quick.recordPasswordUnlock();
        const stored = await deps.credentials.load();
        if (result.value.sync !== undefined && stored !== undefined) startSync({ email: result.value.email, accountId: result.value.accountId, server: result.value.server, ...result.value.sync }, stored.registration);
      }
      return result.ok ? { ok: true, value: { accountId: result.value.accountId, email: result.value.email, server: result.value.server } } : result;
    },

    async 'quickUnlock.status'(args: { sessionMarker?: string }) {
      return quick.status(args.sessionMarker);
    },

    async 'quickUnlock.enable'(args: { password: Uint8Array; credentialId: Uint8Array; prfSalt: Uint8Array; prfOutput: Uint8Array; sessionMarker: string }) {
      open();
      return quick.enrol({ ...args, password: secretFrom(args.password) });
    },

    async 'quickUnlock.unlock'(args: { prfOutput: Uint8Array; sessionMarker?: string }) {
      const result = await quick.unlock({ prfOutput: args.prfOutput, sessionMarker: args.sessionMarker });
      if (result.ok) {
        await applySettings();
        const stored = await deps.credentials.load();
        if (result.value.sync !== undefined && stored !== undefined) startSync({ email: result.value.email, accountId: result.value.accountId, server: result.value.server, ...result.value.sync }, stored.registration);
      }
      return result.ok ? { ok: true, value: { accountId: result.value.accountId, email: result.value.email, server: result.value.server } } : result;
    },

    async 'quickUnlock.disable'() {
      open();
      await quick.disable();
      return true;
    },

    async 'settings.get'() {
      return deps.settings.load();
    },

    async 'settings.set'(args: Partial<DeviceSettings>) {
      const merged = parseSettings({ ...(await deps.settings.load()), ...args });
      await deps.settings.save(merged);
      await applySettings();
      return merged;
    },

    /** Re-checks the password, then returns the Secret Key for the Emergency Kit (it is never kept in the page). */
    async 'emergencyKit.export'(args: { password: Uint8Array }) {
      open();
      const wait = session.unlockDelayMs();
      if (wait > 0) {
        args.password.fill(0);
        return { ok: false, error: { code: 'too_many_attempts', retryAfterMs: wait } };
      }
      const stored = await deps.credentials.load();
      if (stored === undefined) return { ok: false, error: { code: 'no_account' } };
      const material = await deps.accountCrypto.unlock({ password: secretFrom(args.password), credentials: stored });
      if (material === 'wrong_password') {
        session.recordFailedUnlock();
        return { ok: false, error: { code: 'wrong_password' } };
      }
      const secretKeyText = material.secretKey.use((b) => new TextDecoder().decode(b));
      for (const secret of [material.sessionKey, material.deviceSigningKey, material.secretKey]) secret.wipe();
      session.recordSuccessfulUnlock();
      return { ok: true, value: { accountId: stored.accountId, email: stored.email, server: stored.server, secretKeyText } };
    },

    // ------------------------------------------------------------ sync (US4)

    /** Signs in on a device that has no account yet, from the password and Secret Key (FR-004). */
    async 'account.signIn'(args: { email: string; server: string; secretKeyText: string; password: Uint8Array }) {
      if (deps.relayAuth === undefined || deps.enrolCrypto === undefined) throw new RpcError('RpcError', 'sync_unavailable');
      const sessionPort = await newWebSession();
      const result = await signInOnNewDevice({
        relay: deps.relayAuth, enrolCrypto: deps.enrolCrypto, grants, credentials: deps.credentials, sessionPort, session, random: deps.rng,
      })({ email: args.email, server: args.server, secretKeyText: args.secretKeyText, password: secretFrom(args.password) });
      if (!result.ok) return result;
      await applySettings();
      const stored = await deps.credentials.load();
      if (stored !== undefined) startSync({ email: stored.email, accountId: result.value.accountId, server: stored.server, ...result.value.sync }, 'done');
      return { ok: true, value: { accountId: result.value.accountId, folds: result.value.folds } };
    },

    /** Gets back into an account with its Recovery Key when the password or Secret Key is lost; sets a new password and Secret Key (FR-009). */
    async 'account.recover'(args: { email: string; server: string; recoveryKeyText: string; newPassword: Uint8Array }) {
      if (deps.relayAuth === undefined || deps.enrolCrypto === undefined || deps.credentialCrypto === undefined) throw new RpcError('RpcError', 'sync_unavailable');
      const relayAuth = deps.relayAuth;
      const enrolCrypto = deps.enrolCrypto;
      const sessionPort = await newWebSession();
      const result = await recoverAccount({
        crypto: deps.credentialCrypto.recovery, relay: relayAuth, credentials: deps.credentials, random: deps.rng,
        signIn: (input) => signInOnNewDevice({ relay: relayAuth, enrolCrypto, grants, credentials: deps.credentials, sessionPort, session, random: deps.rng })(input),
      })({ email: args.email, server: args.server, recoveryKeyText: args.recoveryKeyText, newPassword: secretFrom(args.newPassword) });
      if (!result.ok) return result;
      await applySettings();
      const stored = await deps.credentials.load();
      if (stored !== undefined) startSync({ email: stored.email, accountId: result.value.accountId, server: stored.server, ...result.value.sync }, 'done');
      return { ok: true, value: { accountId: result.value.accountId, folds: result.value.folds, secretKeyText: result.value.secretKeyText } };
    },

    /** Registers an account made offline (or before sync existed) with a service, then starts syncing it (T200). */
    async 'sync.enable'(args: { password: Uint8Array; server?: string; inviteCode?: string }) {
      if (deps.registerCrypto === undefined || deps.registration === undefined) throw new RpcError('RpcError', 'sync_unavailable');
      open();
      const result = await registerExisting({ crypto: deps.registerCrypto, registration: deps.registration, credentials: deps.credentials })({
        password: secretFrom(args.password), ...(args.server !== undefined && { server: args.server }), ...(args.inviteCode !== undefined && { inviteCode: args.inviteCode }),
      });
      if (!result.ok) return result;
      const stored = await deps.credentials.load();
      if (stored === undefined) return { ok: false, error: { code: 'no_account' } };
      session.track(result.value.account.encSk);
      session.track(result.value.account.sigSk);
      session.track(result.value.account.srpX);
      startSync({ email: stored.email, accountId: stored.accountId, server: result.value.server, account: result.value.account, publicKeys: result.value.publicKeys }, 'done');
      return { ok: true, value: { server: result.value.server } };
    },

    /** What the backup reminder needs: whether there is anything to lose, when a backup was last made, and whether the account is on a service. */
    async 'storage.status'() {
      const s = open();
      // Any account, transaction or transfer record at all: one indexed probe, not a read of the Fold.
      const hasData = s.db.rows('SELECT 1 FROM record_meta WHERE table_code IN (1, 6, 7) LIMIT 1').length > 0;
      const settings = await deps.settings.load();
      const stored = await deps.credentials.load();
      const r = s.recovery;
      return {
        hasData, onService: stored?.registration === 'done', lastBackupAtMs: settings.lastBackupAtMs, dismissedAtMs: settings.backupNagDismissedAtMs,
        // Told once per session, and never anything that could be read from the file: only what was done.
        ...(r !== undefined && { recovery: { reason: r.reason, incomplete: r.incomplete, rebuilt: r.rebuilt, refetch: r.refetch.length, blocked: r.blocked.length, atMs: r.atMs } }),
      };
    },

    async 'sync.status'() {
      open();
      const stored = await deps.credentials.load();
      const snap = sync === undefined ? { connection: 'idle', overall: 'synced', folds: [], attention: [], clock: [] } : await sync.snapshot();
      return { ...snap, available: sync !== undefined, registration: stored?.registration ?? 'pending', server: stored?.server };
    },

    async 'sync.now'() {
      open();
      await sync?.syncNow();
      return true;
    },

    async 'devices.list'() {
      open();
      const { identity: id } = needSync();
      return createDeviceManager({ link: () => sync?.link(), labels: needLabels(), account: id.account, thisDevice: sessionDeviceId() }).list();
    },

    async 'devices.rename'(args: { device: Id; label: string }) {
      open();
      const { identity: id } = needSync();
      return createDeviceManager({ link: () => sync?.link(), labels: needLabels(), account: id.account, thisDevice: sessionDeviceId() }).rename(args.device, args.label);
    },

    async 'devices.revoke'(args: { device: Id }) {
      open();
      const { identity: id } = needSync();
      return createDeviceManager({ link: () => sync?.link(), labels: needLabels(), account: id.account, thisDevice: sessionDeviceId() }).revoke(args.device);
    },

    async 'email.status'() {
      open();
      return emailVerification().status();
    },
    async 'email.request'() {
      open();
      return emailVerification().request();
    },
    async 'email.submit'(args: { token: string }) {
      open();
      return emailVerification().submit(args.token);
    },
    async 'email.setDiscoverable'(args: { discoverable: boolean }) {
      open();
      return emailVerification().setDiscoverable(args.discoverable);
    },

    async 'rates.refresh'(args: { fold: Id }) {
      const s = open();
      const stored = await deps.credentials.load();
      if (deps.ratesSource === undefined || stored === undefined) return { ok: true, value: { status: 'unavailable', reason: 'not_published' } };
      return s.commandBus.execute(createRefreshRates({ source: deps.ratesSource(stored.server) }), { fold: args.fold });
    },

    async 'session.activity'() {
      session.activity();
      return true;
    },
    async 'session.visibility'(args: { state: 'visible' | 'hidden' }) {
      session.visibility(args.state);
      return session.covered();
    },
    async 'session.focus'(args: { focused: boolean }) {
      session.focus(args.focused);
      return session.covered();
    },
    async 'session.pageHide'() {
      session.pageHide();
      return true;
    },
    async 'session.tick'() {
      session.tick();
      return session.state();
    },

    async 'folds.list'() {
      return [...(await open().directory.list())];
    },

    async 'folds.create'(args: { name: string; baseCurrency: string; categoryNames?: Record<string, string> }) {
      const s = open();
      const commands = createFoldCommands({ directory: s.directory, foldKeys: s.keyring });
      const created = await s.commandBus.execute(commands.createFold, { fold: newIdV4((n) => deps.rng.bytes(n)), name: args.name, baseCurrency: args.baseCurrency });
      if (created.ok) await seedCategories(created.value.id, args.categoryNames);
      return created;
    },

    async 'folds.rename'(args: { fold: Id; name: string }) {
      const s = open();
      return s.commandBus.execute(createFoldCommands({ directory: s.directory, foldKeys: s.keyring }).renameFold, args);
    },

    async 'folds.describeDeletion'(args: { fold: Id }) {
      return (await describeFoldDeletion(open().directory, args.fold)) ?? null;
    },

    async 'folds.delete'(args: { fold: Id; confirmName: string }) {
      const s = open();
      return s.commandBus.execute(createFoldCommands({ directory: s.directory, foldKeys: s.keyring }).deleteFold, args);
    },
  };

  return { handlers, session };
}
