import {
  changeCredentials, createBackupService, createFoldCommands, deleteAccount, exportLedgerCsv, migrateToServer, newIdV4, removeRecoveryKey, setRecoveryKey,
  type AccountSecrets, type CredentialChangeCryptoPort, type CredentialStorePort, type DeletableFold, type FoldGrantPort, type Id, type MigrationCryptoPort, type RecoveryCryptoPort, type RegistrationPort,
  type RelayAuthPort, type Secret, type Session, type DeviceSettingsPort, parseSettings,
} from '@cashfold/core';
import { composeKdf, createAesGcm, createArgon2Kdf, createBackupCrypto, createHkdf, createPbkdf2, SecretBuf, type BackupSecret as CryptoBackupSecret } from '@cashfold/crypto';
import type { OpenSession } from '../adapters/sqlite-opfs/web-session';
import { snapshotCodec } from '../adapters/transport/snapshot-codec';
import { createFoldTransfer } from '../adapters/transport/fold-transfer';
import { RpcError, type Handlers } from './rpc';
import type { SyncIdentity } from './sync-service';

// The account-level surface of the Core Worker: changing the password or Secret Key, the Recovery Key, leaving for another
// service, deleting the account, and the files that leave the app (backups, CSV). Each of them asks for the password again:
// an unlocked device alone is not enough to change or take away what the account is (FR-008, FR-101).

export interface AccountHandlerDeps {
  readonly open: () => OpenSession;
  readonly session: Session;
  readonly credentials: CredentialStorePort;
  readonly relayAuth: RelayAuthPort | undefined;
  readonly registration: RegistrationPort | undefined;
  readonly crypto: { readonly credentialChange: CredentialChangeCryptoPort; readonly migration: MigrationCryptoPort; readonly recovery: RecoveryCryptoPort } | undefined;
  readonly grants: FoldGrantPort;
  readonly rng: { bytes(n: number): Uint8Array };
  /** The account's keys and where it syncs, while unlocked. */
  readonly identity: () => SyncIdentity | undefined;
  /** Carries on syncing with the new keys or the new service. */
  readonly restartSync: (next: SyncIdentity) => void;
  /** Erases everything on this device (database, keys, credentials) and locks. */
  readonly eraseEverything: () => Promise<void>;
  readonly syncNow: () => void;
  readonly settings: DeviceSettingsPort;
  readonly nowMs: () => number;
}

const secretFrom = (bytes: unknown): SecretBuf => {
  if (!(bytes instanceof Uint8Array)) throw new RpcError('TypeError', 'bad_argument');
  const secret = SecretBuf.from(bytes);
  bytes.fill(0);
  return secret;
};

const backupCrypto = createBackupCrypto({
  aead: createAesGcm(), hkdf: createHkdf(), kdf: composeKdf(createArgon2Kdf(), createPbkdf2()), rng: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
  defaultKdf: { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1 },
});
const backupPort = {
  seal: (plain: Uint8Array, s: BackupSecret) => backupCrypto.seal(plain, toCrypto(s)),
  open: (file: Uint8Array, s: BackupSecret) => backupCrypto.open(file, toCrypto(s)),
};
type BackupSecret = Parameters<ReturnType<typeof createBackupService>['create']>[1];
const hexOf = (fold: Id): Uint8Array => Uint8Array.from({ length: 16 }, (_, i) => parseInt(fold.replaceAll('-', '').slice(i * 2, i * 2 + 2), 16));
function toCrypto(s: BackupSecret): CryptoBackupSecret {
  return s.kind === 'passphrase'
    ? { kind: 'passphrase', passphrase: SecretBuf.from(s.passphrase.use((b) => Uint8Array.from(b))) }
    : { kind: 'foldKey', key: SecretBuf.from(s.key.use((b) => Uint8Array.from(b))), fold: hexOf(s.fold) };
}

const needRelay = (deps: AccountHandlerDeps): { relay: RelayAuthPort; crypto: NonNullable<AccountHandlerDeps['crypto']> } => {
  if (deps.relayAuth === undefined || deps.crypto === undefined) throw new RpcError('RpcError', 'sync_unavailable');
  return { relay: deps.relayAuth, crypto: deps.crypto };
};

export function createAccountHandlers(deps: AccountHandlerDeps): Handlers {
  const { credentials } = deps;

  /** Throttles and checks the password the way the Emergency Kit export does: wrong guesses slow down. Returns the stored credentials. */
  const identityGate = async (): Promise<{ ok: false; error: { code: string; retryAfterMs?: number } } | undefined> => {
    const wait = deps.session.unlockDelayMs();
    return wait > 0 ? { ok: false, error: { code: 'too_many_attempts', retryAfterMs: wait } } : undefined;
  };
  const tracked = async <T extends { ok: boolean; error?: { code: string } }>(run: () => Promise<T>): Promise<T | { ok: false; error: { code: string; retryAfterMs?: number } }> => {
    const blocked = await identityGate();
    if (blocked !== undefined) return blocked;
    const result = await run();
    if (!result.ok && result.error?.code === 'wrong_password') deps.session.recordFailedUnlock();
    else if (result.ok) deps.session.recordSuccessfulUnlock();
    return result;
  };

  return {
    async 'credentials.change'(args: { password: Uint8Array; newPassword?: Uint8Array; rotateSecretKey?: boolean }) {
      deps.open();
      const { relay, crypto } = needRelay(deps);
      const newPassword = args.newPassword === undefined ? undefined : secretFrom(args.newPassword);
      return tracked(async () => {
        const result = await changeCredentials({ crypto: crypto.credentialChange, relay, credentials, session: deps.session })({
          password: secretFrom(args.password), ...(newPassword !== undefined && { newPassword }), ...(args.rotateSecretKey === true && { rotateSecretKey: true }),
        });
        if (!result.ok) return result;
        const id = deps.identity();
        // The service signs this device in with the new sign-in secret from now on.
        if (id !== undefined) deps.restartSync({ ...id, account: { ...id.account, srpX: result.value.srpX } as AccountSecrets });
        return { ok: true as const, value: { ...(result.value.secretKeyText !== undefined && { secretKeyText: result.value.secretKeyText }), otherDevicesSignedOut: true } };
      });
    },

    async 'recovery.set'(args: { password: Uint8Array }) {
      deps.open();
      const { relay, crypto } = needRelay(deps);
      return tracked(() => setRecoveryKey({ crypto: crypto.recovery, verify: crypto.credentialChange, relay, credentials, account: () => deps.identity()?.account })({ password: secretFrom(args.password) }));
    },

    async 'recovery.remove'(args: { password: Uint8Array }) {
      deps.open();
      const { relay, crypto } = needRelay(deps);
      return tracked(() => removeRecoveryKey({ verify: crypto.credentialChange, relay, credentials })({ password: secretFrom(args.password) }));
    },

    async 'account.delete'(args: { password: Uint8Array }) {
      const s = deps.open();
      const { relay, crypto } = needRelay(deps);
      return tracked(() =>
        deleteAccount({
          crypto: crypto.credentialChange, relay, credentials, eraseLocal: deps.eraseEverything,
          folds: {
            async list(): Promise<readonly DeletableFold[]> {
              const out: DeletableFold[] = [];
              for (const f of await s.directory.list()) {
                const state = await s.membership.state(f.id);
                out.push({ id: f.id, name: f.name, role: f.role, shared: state.ok && state.value.members.size > 1 });
              }
              return out;
            },
            async leave(fold) {
              return (await s.sharing.leaveFold(fold)).ok;
            },
          },
        })({ password: secretFrom(args.password) }),
      );
    },

    async 'account.migrate'(args: { password: Uint8Array; server: string; inviteCode?: string; deleteOld?: boolean }) {
      const s = deps.open();
      const { relay, crypto } = needRelay(deps);
      if (deps.registration === undefined) throw new RpcError('RpcError', 'sync_unavailable');
      const current = deps.identity();
      return tracked(async () => {
        const result = await migrateToServer({
          crypto: crypto.migration, relay, registration: deps.registration!, credentials,
          folds: createFoldTransfer({ session: () => s, grants: deps.grants, identity: () => current }),
        })({ password: secretFrom(args.password), server: args.server, ...(args.inviteCode !== undefined && { inviteCode: args.inviteCode }), ...(args.deleteOld !== undefined && { deleteOld: args.deleteOld }) });
        if (result.ok && current !== undefined) deps.restartSync({ ...current, server: result.value.server });
        return result;
      });
    },

    // ------------------------------------------------------------ files that leave and enter the app

    /** The encrypted file for a Fold, under a passphrase (FR-091). */
    async 'backup.create'(args: { fold: Id; passphrase: Uint8Array }) {
      const s = deps.open();
      const passphrase = secretFrom(args.passphrase);
      try {
        if (passphrase.length === 0) return { ok: false, error: { code: 'empty_passphrase' } };
        const service = createBackupService({ projections: s.projections, writePath: s.writePath, codec: snapshotCodec, crypto: backupPort });
        const file = await service.create(args.fold, { kind: 'passphrase', passphrase });
        // The reminder to make a backup rests on this (decideBackupNag).
        await deps.settings.save(parseSettings({ ...(await deps.settings.load()), lastBackupAtMs: deps.nowMs() }));
        return { ok: true, value: { file } };
      } finally {
        passphrase.wipe();
      }
    },

    /** Makes a new Fold from a backup file. The Fold takes the backup's name (marked as restored) and base currency. */
    async 'backup.restore'(args: { file: Uint8Array; passphrase: Uint8Array }) {
      const s = deps.open();
      const passphrase = secretFrom(args.passphrase);
      const secret = { kind: 'passphrase' as const, passphrase };
      try {
        const service = createBackupService({ projections: s.projections, writePath: s.writePath, codec: snapshotCodec, crypto: backupPort });
        const seen = await service.inspect(args.file, secret);
        if (!seen.ok) return seen;
        const commands = createFoldCommands({ directory: s.directory, foldKeys: s.keyring });
        const created = await s.commandBus.execute(commands.createFold, {
          fold: newIdV4((n) => deps.rng.bytes(n)), name: `${seen.value.name ?? 'Restored'} (restored)`.slice(0, 80), baseCurrency: seen.value.baseCurrency ?? 'USD',
        });
        if (!created.ok) return created;
        const restored = await service.restore(args.file, secret, created.value.id);
        if (!restored.ok) {
          // Nothing half-restored is kept.
          await s.commandBus.execute(commands.deleteFold, { fold: created.value.id, confirmName: created.value.name }).catch(() => undefined);
          return restored;
        }
        deps.syncNow();
        return { ok: true, value: { fold: created.value, records: restored.value.records } };
      } finally {
        passphrase.wipe();
      }
    },

    /** The Fold's ledger as CSV (FR-092). The file is plain text anyone can read, so it asks for the password again first. */
    async 'csv.export'(args: { fold: Id; password: Uint8Array }) {
      const s = deps.open();
      const password = secretFrom(args.password);
      return tracked(async () => {
        const stored = await credentials.load();
        if (stored === undefined) {
          password.wipe();
          return { ok: false as const, error: { code: 'no_account' } };
        }
        const checked = await verifyPassword(deps, password, stored);
        if (!checked) return { ok: false as const, error: { code: 'wrong_password' } };
        const view = await s.views.get(args.fold, s.projections);
        return { ok: true as const, value: { text: exportLedgerCsv(view.ledger), name: (await s.directory.get(args.fold))?.name ?? 'cashfold' } };
      });
    },
  };
}

/** Checks a password against this device's credentials without keeping anything it opens. */
async function verifyPassword(deps: AccountHandlerDeps, password: Secret, stored: Parameters<CredentialChangeCryptoPort['begin']>[0]['credentials']): Promise<boolean> {
  if (deps.crypto === undefined) {
    password.wipe();
    return false;
  }
  const handle = await deps.crypto.credentialChange.begin({ password, credentials: stored });
  if (handle === 'wrong_password') return false;
  handle.wipe();
  return true;
}
