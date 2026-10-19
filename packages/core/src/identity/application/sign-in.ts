import { newIdV4, type Id } from '../../shared-kernel/id';
import type { Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FoldSummary } from '../../sharing/ports/index';
import { normaliseEmail } from '../domain/user-account';
import { normaliseServerAddress } from '../domain/server-address';
import type {
  AccountSecrets, CredentialStorePort, EnrolCryptoPort, FoldGrantPort, KdfOffer, RelayAuthPort, RelayErrorKind, RelayLink, Secret, SessionPort, SessionServices,
} from '../ports/index';
import { checkKdfPolicy, type KdfSettings } from './kdf-policy';
import type { Session } from './lock';
import { asMap, foldRef, idOfBytes } from './relay-wire';

// Signing in on a device that has never seen the account (US4, FR-004): the password and the Secret Key together open the
// personal key set, this device gets its own signing key, registers it, and receives the keys of every Fold it belongs to.
// Everything local is created only after the service has accepted the proof, and removed again if a later step fails.

export interface SignInInput {
  readonly email: string;
  readonly server: string;
  /** The "C1-…" Secret Key from the Emergency Kit or the add-device link. */
  readonly secretKeyText: string;
  /** Consumed: wiped on every path. */
  readonly password: Secret;
}

export type SignInError =
  | DomainError<'invalid_email' | 'invalid_server' | 'invalid_secret_key' | 'wrong_credentials' | 'offline' | 'service_error' | 'kdf_below_floor' | 'already_has_account' | 'device_removed'>
  | (DomainError<'rate_limited'> & { readonly retryAfterS?: number });

export interface SignedIn {
  readonly accountId: string;
  readonly folds: readonly FoldSummary[];
  readonly deviceId: Id;
}

export interface SignInDeps {
  readonly relay: RelayAuthPort;
  readonly enrolCrypto: EnrolCryptoPort;
  readonly grants: FoldGrantPort;
  readonly credentials: CredentialStorePort;
  readonly sessionPort: SessionPort;
  readonly session: Session;
  readonly random: { bytes(length: number): Uint8Array };
  readonly logger?: Logger;
}

/** Thrown from the key-derivation callback so the sign-in stops before the password is used with weak settings. */
class PolicyRefusal extends Error {}

const toSettings = (k: KdfOffer): KdfSettings => (k.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: k.mKib, t: k.t, p: k.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: k.iterations });

export function mapRelayError(kind: RelayErrorKind): SignInError {
  switch (kind) {
    case 'offline': return { code: 'offline', message: 'The service cannot be reached. Check the address and your connection.' };
    case 'rate_limited': return { code: 'rate_limited', message: 'Too many attempts. Wait a little before trying again.' };
    case 'revoked': return { code: 'device_removed', message: 'This device was removed from the account' };
    case 'rejected': return { code: 'wrong_credentials', message: 'The email, password or Secret Key is not right' };
    case 'kdf_below_floor': return { code: 'kdf_below_floor', message: 'The service offered weaker password protection than this device accepts' };
    default: return { code: 'service_error', message: 'The service did not answer as expected' };
  }
}

export function signInOnNewDevice(deps: SignInDeps) {
  const { relay, enrolCrypto, grants, credentials, sessionPort, session, random, logger } = deps;

  return async function run(input: SignInInput): Promise<Result<SignedIn, SignInError>> {
    const refuse = <E extends SignInError>(error: E): Result<never, E> => {
      input.password.wipe();
      return { ok: false, error };
    };

    const email = normaliseEmail(input.email);
    if (!email.ok) return refuse(email.error);
    const server = normaliseServerAddress(input.server);
    if (!server.ok) return refuse(server.error);
    if ((await credentials.load()) !== undefined) return refuse({ code: 'already_has_account', message: 'This device already has an account' } as const);

    const handle = await enrolCrypto.begin({ email: email.value, password: input.password, secretKeyText: input.secretKeyText });
    if (handle === 'invalid_secret_key') return err('invalid_secret_key', 'That is not a valid Secret Key');

    const deviceId = newIdV4((n) => random.bytes(n));
    let services: SessionServices | undefined;
    let material: Awaited<ReturnType<typeof handle.complete>> | undefined;
    let link: RelayLink | undefined;
    const undo = async (): Promise<void> => {
      await credentials.clear().catch(() => undefined);
      await sessionPort.stop().catch(() => undefined);
      if (material !== undefined && material !== 'wrong_secret') {
        for (const s of secretsOf(material)) {
          session.release(s);
          s.wipe();
        }
      }
      link?.close();
    };

    // Every early exit below returns an error result; the one place that cleans up is after the attempt.
    const attempt = async (): Promise<Result<SignedIn, SignInError>> => {
      let signedIn;
      try {
        signedIn = await relay.signIn({
          server: server.value, email: email.value, deviceId,
          async deriveX(hello) {
            if (!checkKdfPolicy(toSettings(hello.kdf)).ok) throw new PolicyRefusal();
            return handle.deriveSrpX(hello);
          },
        });
      } catch (e) {
        if (e instanceof PolicyRefusal) return err('kdf_below_floor', mapRelayError('kdf_below_floor').message);
        throw e;
      }
      if (!signedIn.ok) return { ok: false, error: mapRelayError(signedIn.kind) };
      link = signedIn.link;

      const keyset = await link.request('GET', '/accounts/me/keyset');
      if (!keyset.ok) return { ok: false, error: mapRelayError(keyset.kind) };
      const keySetBytes = asMap(keyset.body).get('keyset');
      if (!(keySetBytes instanceof Uint8Array)) return err('service_error', mapRelayError('protocol').message);

      material = await handle.complete({ keySet: keySetBytes, deviceId });
      if (material === 'wrong_secret') return err('wrong_credentials', mapRelayError('rejected').message);
      const m = material;
      for (const s of secretsOf(m)) session.track(s);

      const device = await link.request('POST', '/devices', { dev_id: deviceIdBytes(deviceId), sig_pk: m.deviceSigPk });
      if (!device.ok && device.kind !== 'conflict') return { ok: false, error: mapRelayError(device.kind) };

      services = await sessionPort.start({ deviceId, sessionKey: m.sessionKey, deviceSigningKey: m.deviceSigningKey });
      await credentials.save({ ...m.credentials, email: email.value, server: server.value, registration: 'done' });

      const folds = await receiveFolds({ link, grants, services, account: m.account, publicKeys: m.publicKeys });
      if (!folds.ok) return folds;
      logger?.info('device.enrolled', {});
      return ok({ accountId: m.accountId, folds: folds.value, deviceId });
    };

    try {
      const result = await attempt();
      if (!result.ok) await undo();
      else link?.close();
      return result;
    } catch (e) {
      await undo();
      throw e;
    } finally {
      handle.wipe();
    }
  };
}

const secretsOf = (m: { sessionKey: Secret; deviceSigningKey: Secret; account: AccountSecrets }): Secret[] => [m.sessionKey, m.deviceSigningKey, m.account.encSk, m.account.sigSk, m.account.srpX];

const deviceIdBytes = (id: Id): Uint8Array => Uint8Array.from({ length: 16 }, (_, i) => parseInt(id.replaceAll('-', '').slice(i * 2, i * 2 + 2), 16));

/** Fetches the Folds this account belongs to, opens their keys, and records them on this device. */
export async function receiveFolds(args: {
  link: RelayLink;
  grants: FoldGrantPort;
  services: SessionServices;
  account: AccountSecrets;
  publicKeys: { enc: Uint8Array; sig: Uint8Array };
}): Promise<Result<FoldSummary[], SignInError>> {
  const { link, grants, services, account, publicKeys } = args;
  const list = await link.request('GET', '/folds');
  if (!list.ok) return { ok: false, error: mapRelayError(list.kind) };
  if (!Array.isArray(list.body)) return err('service_error', mapRelayError('protocol').message);
  const out: FoldSummary[] = [];
  for (const entry of list.body as unknown[]) {
    const fold = idOfBytes(asMap(entry).get('fold'));
    if (fold === undefined) continue;
    const reply = await link.request('GET', `/folds/${foldRef(fold)}/grants?member=me`);
    if (!reply.ok) return { ok: false, error: mapRelayError(reply.kind) };
    const raw = (Array.isArray(reply.body) ? reply.body : []).filter((g): g is Uint8Array => g instanceof Uint8Array);
    const opened = await grants.open({ fold, grants: raw, account, publicKeys });
    if (opened.length === 0 || services.keyImport === undefined) continue; // nothing this device can read
    for (const k of opened) await services.keyImport.importFoldKey(fold, k.epoch, k.key);
    const top = opened.reduce((a, b) => (b.epoch > a.epoch ? b : a));
    // The name and base currency are in the Fold's settings record, which arrives with the first sync and replaces these.
    const summary: FoldSummary = { id: fold, name: 'Syncing…', baseCurrency: 'USD', epoch: top.epoch, role: top.role };
    await services.directory.add(summary);
    out.push(summary);
  }
  return ok(out);
}
