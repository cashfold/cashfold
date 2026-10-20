import { createAesGcm, createEd25519Signer, createHkdf, createOpSealer, createSharingCrypto, SecretBuf, type Rng } from '@cashfold/crypto';
import { encodeInvitationCode } from '@cashfold/crypto';
import type { Id } from '../shared-kernel/id';
import type { LocalDate } from '../shared-kernel/local-date';
import { err, ok } from '../shared-kernel/result';
import type { AccountIdentity, MembershipRemote, MembershipStore, OwnDevice, PublicKeyBundle, SharingCrypto, SharingKeyring, FoldDirectory, FoldSummary } from '../sharing/ports/index';
import { createHistoryWriter } from '../sharing/application/history-scope';
import { createMembershipCommands, type MembershipCommands } from '../sharing/application/membership-commands';
import { createMembershipLog, type MembershipLog } from '../sharing/application/membership-log-service';
import { createOpAuthoriser } from '../sharing/application/op-authorisation';
import { createFoldWiper } from '../sharing/application/local-wipe';
import type { MembershipEntry } from '../sharing/domain/membership-log';
import { foldSettingsPatch, settingsRecordId } from '../sharing/domain/fold';
import { createWritePath, type WritePath } from '../sync/application/write-path';
import type { GroupRegistry } from '../sync/domain/merge';
import type { OpLogStore, OpSealerPort, ProjectionStore, SealedOp } from '../sync/ports/index';
import { LEDGER_GROUPS } from '../ledger/domain/ledger-groups';
import { buildLedger, type Ledger } from '../ledger/application/projections/ledger';
import { createMemoryStores } from './memory-ports';
import { person, type Person } from './membership';
import { MemoryRelay } from './relay';
import { id } from './world';

// A small world of people sharing Folds: a service that carries membership entries, grants and ops (and, when told to, lies),
// and participants who each hold their own keys, their own copy of the log and their own replica of every Fold.

const rng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const signer = createEd25519Signer();
const realCrypto = createSharingCrypto({ rng });
const sharing = realCrypto as unknown as SharingCrypto;

type Failure = { readonly code: 'offline' | 'forbidden' | 'conflict' | 'not_found' | 'rate_limited' | 'rejected'; readonly message: string };
const failure = (code: Failure['code']) => err(code, code);

export class FakeService {
  readonly logs = new Map<Id, MembershipEntry[]>();
  readonly grants = new Map<string, Uint8Array[]>();
  readonly bundles = new Map<string, PublicKeyBundle>();
  readonly emails = new Map<string, string>();
  readonly discoverable = new Set<string>();
  readonly invitations: Array<{ fold: Id; subject: string; notifyEmail?: string }> = [];
  readonly relay = new MemoryRelay();
  /** Called with the entry before it is stored; return false to drop it, as a lying service might. */
  tamper: ((fold: Id, entry: MembershipEntry) => MembershipEntry | undefined) | undefined;

  register(p: Person, email: string, discoverable = true): void {
    this.bundles.set(p.account, { accountId: p.account, encPk: p.enc.publicKey, sigPk: p.sig.publicKey, selfSig: new Uint8Array(0) });
    this.emails.set(email.toLowerCase(), p.account);
    if (discoverable) this.discoverable.add(p.account);
  }

  setBundle(account: string, bundle: PublicKeyBundle): void {
    this.bundles.set(account, bundle);
  }

  active(fold: Id): Set<string> {
    const out = new Set<string>();
    for (const e of this.logs.get(fold) ?? []) {
      if (e.type === 'add_member') out.add(e.subject);
      if (e.type === 'remove_member' || e.type === 'leave') out.delete(e.subject);
    }
    return out;
  }

  everMember(fold: Id): Set<string> {
    return new Set((this.logs.get(fold) ?? []).filter((e) => e.type === 'add_member').map((e) => e.subject));
  }

  private append(fold: Id, account: string, entry: MembershipEntry, grants: readonly Uint8Array[]) {
    const log = this.logs.get(fold) ?? [];
    if (log.length === 0) {
      if (entry.idx !== 0) return failure('conflict');
    } else {
      if (!this.active(fold).has(account) || entry.signer !== account) return failure('forbidden');
      if (entry.idx !== log.length) return failure('conflict');
    }
    const stored = this.tamper === undefined ? entry : this.tamper(fold, entry);
    if (stored === undefined) return ok(true as const); // a lying service swallows it
    this.logs.set(fold, [...log, stored]);
    for (const g of grants) {
      const info = sharing.readGrant(g);
      if (info === undefined) continue;
      const key = `${fold}|${info.member}`;
      this.grants.set(key, [...(this.grants.get(key) ?? []).filter((x) => sharing.readGrant(x)?.epoch !== info.epoch), g]);
    }
    return ok(true as const);
  }

  remoteFor(account: string, online: () => boolean): MembershipRemote {
    const guard = <T>(run: () => T) => (online() ? run() : (failure('offline') as never));
    return {
      folds: async () => guard(() => ok([...this.logs.keys()].filter((f) => this.active(f).has(account)))),
      fetchLog: async (fold, after) => guard(() => {
        const log = this.logs.get(fold) ?? [];
        if (log.length > 0 && !this.everMember(fold).has(account)) return failure('forbidden');
        return ok({ entries: log.slice(after + 1), head: log.length - 1 });
      }),
      postLog: async (fold, entry, grants) => guard(() => this.append(fold, account, entry, grants)),
      invite: async (fold, entry, grants, notifyEmail) => guard(() => {
        const r = this.append(fold, account, entry, grants);
        if (r.ok) this.invitations.push({ fold, subject: entry.subject, ...(notifyEmail !== undefined && { notifyEmail }) });
        return r;
      }),
      fetchGrants: async (fold) => guard(() => (this.active(fold).has(account) ? ok([...(this.grants.get(`${fold}|${account}`) ?? [])]) : failure('forbidden'))),
      lookup: async (email) => guard(() => {
        const found = this.emails.get(email.toLowerCase());
        return found !== undefined && this.discoverable.has(found) ? ok(this.bundles.get(found)!) : failure('not_found');
      }),
      publicKeys: async (who) => guard(() => (this.bundles.has(who) ? ok(this.bundles.get(who)!) : failure('not_found'))),
    };
  }
}

class MemoryKeyring implements SharingKeyring {
  private readonly keys = new Map<string, SecretBuf>();
  async epochs(fold: Id) {
    return [...this.keys.keys()].filter((k) => k.startsWith(`${fold}|`)).map((k) => Number(k.split('|')[1])).sort((a, b) => a - b);
  }
  async key(fold: Id, epoch: number) {
    return this.keys.get(`${fold}|${epoch}`);
  }
  async importFoldKey(fold: Id, epoch: number, key: { use<T>(fn: (b: Uint8Array) => T): T; wipe(): void }) {
    if (!this.keys.has(`${fold}|${epoch}`)) this.keys.set(`${fold}|${epoch}`, SecretBuf.from(key.use((b) => Uint8Array.from(b))));
    key.wipe();
  }
  async createFoldKey(fold: Id) {
    this.keys.set(`${fold}|1`, SecretBuf.from(rng.bytes(32)));
    return 1;
  }
  async dropFoldKeys(fold: Id) {
    for (const k of [...this.keys.keys()]) if (k.startsWith(`${fold}|`)) this.keys.delete(k);
  }
  secret(fold: Id, epoch: number): SecretBuf | undefined {
    return this.keys.get(`${fold}|${epoch}`);
  }
  /** Forgets one epoch's key, as a device that never had it. */
  forget(fold: Id, epoch: number) {
    this.keys.delete(`${fold}|${epoch}`);
  }
}

class MemoryDirectory implements FoldDirectory {
  readonly rows = new Map<Id, FoldSummary>();
  async list() {
    return [...this.rows.values()];
  }
  async get(fold: Id) {
    return this.rows.get(fold);
  }
  async add(fold: FoldSummary) {
    this.rows.set(fold.id, fold);
  }
  async rename(fold: Id, name: string) {
    const f = this.rows.get(fold);
    if (f) this.rows.set(fold, { ...f, name });
  }
  async remove(fold: Id) {
    this.rows.delete(fold);
  }
}

class MemoryMembershipStore implements MembershipStore {
  readonly logs = new Map<Id, MembershipEntry[]>();
  async list(fold: Id) {
    return this.logs.get(fold) ?? [];
  }
  async append(fold: Id, entry: MembershipEntry) {
    this.logs.set(fold, [...(this.logs.get(fold) ?? []), entry]);
  }
  async clear(fold: Id) {
    this.logs.delete(fold);
  }
}

export interface Participant {
  readonly person: Person;
  readonly account: string;
  readonly email: string;
  readonly identity: AccountIdentity;
  readonly directory: MemoryDirectory;
  readonly store: MemoryMembershipStore;
  readonly keyring: MemoryKeyring;
  readonly log: MembershipLog;
  readonly commands: MembershipCommands;
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  readonly writePath: WritePath;
  /** Other devices of this account that the service lists. */
  readonly devices: OwnDevice[];
  online: boolean;
  readonly cursors: Map<string, bigint>;
  /** The device's civil date, as yyyymmdd. */
  today: number;
  now: number;
  createFold(fold: Id, name?: string): Promise<void>;
  /** Pushes pending ops to the service and applies what is new; returns how many ops were applied and how many were set aside. */
  sync(fold: Id): Promise<{ applied: number; quarantined: readonly string[] }>;
  ledger(fold: Id): Promise<Ledger>;
  bundle(): Promise<PublicKeyBundle>;
  code(): Promise<string>;
  /** The sealer's view: seals an op as this device, whatever this account's role, to build forged traffic. */
  forge(op: Parameters<OpSealerPort['seal']>[0]): Promise<SealedOp>;
}

export async function createParticipant(service: FakeService, account: string, deviceNumber: number, opts: { groups?: GroupRegistry; today?: number; discoverable?: boolean } = {}): Promise<Participant> {
  const p = await person(account, deviceNumber);
  const email = `${account.toLowerCase()}@example.com`;
  const bundle = await realCrypto.signBundle({ accountId: account, encPk: p.enc.publicKey, sigSk: p.sig.secretKey });
  service.register(p, email, opts.discoverable ?? true);
  service.setBundle(account, bundle);

  const directory = new MemoryDirectory();
  const store = new MemoryMembershipStore();
  const keyring = new MemoryKeyring();
  const stores = createMemoryStores();
  const devices: OwnDevice[] = [{ id: p.device, sigPk: p.devicePk, revoked: false }];
  const identity: AccountIdentity = { accountId: account, email, encPk: p.enc.publicKey, sigPk: p.sig.publicKey, encSk: p.enc.secretKey, sigSk: p.sig.secretKey };

  const self: Participant = {
    cursors: new Map(),
    person: p, account, email, identity, directory, store, keyring, oplog: stores.oplog, projections: stores.projections, devices, online: true,
    today: opts.today ?? 20_260_301, now: 1_800_000_000_000,
  } as unknown as Participant;

  const remote = service.remoteFor(account, () => self.online);
  const log = createMembershipLog({
    store, remote, crypto: sharing, directory, identity: () => identity, devices: async () => devices, clock: { nowMs: () => self.now },
  });

  const keys = {
    foldKey: async (fold: string, epoch: number) => keyring.secret(fold as Id, epoch),
    deviceSigningKey: () => p.deviceSk,
    signerPublicKey: async (fold: string, dev: string) => {
      if (devices.some((d) => d.id === dev)) return devices.find((d) => d.id === dev)!.sigPk;
      const s = await log.state(fold as Id);
      return s.ok ? s.value.devices.get(dev)?.sigPk : undefined;
    },
  };
  const sealer = createOpSealer({ aead: createAesGcm(), hkdf: createHkdf(), signer, rng, keys }) as unknown as OpSealerPort;
  const authorise = createOpAuthoriser({ log, ownAccount: () => account, ownDevices: async () => devices });
  const writePath = createWritePath({
    oplog: stores.oplog, projections: stores.projections, sealer, clock: { nowMs: () => self.now }, random: rng,
    keys: { deviceId: () => p.device, currentEpoch: async (fold) => (await keyring.epochs(fold)).at(-1) },
    groups: opts.groups ?? LEDGER_GROUPS, authorise,
  });

  const wipe = createFoldWiper({ directory, foldKeys: keyring, membership: store, also: async (fold) => void (await stores.projections.clear(fold)) });
  const commands = createMembershipCommands({
    log, keyring, history: createHistoryWriter({ projections: stores.projections, writePath }), today: () => self.today, wipe,
  });

  Object.assign(self, {
    log, commands, writePath,
    async createFold(fold: Id, name = 'Home') {
      await directory.add({ id: fold, name, baseCurrency: 'USD', epoch: 1, role: 'owner' });
      await keyring.createFoldKey(fold);
      const patch = foldSettingsPatch({ name, baseCurrency: 'USD' });
      await writePath.submit({ fold, rec: settingsRecordId(fold), table: patch.table, fields: patch.fields, sets: new Map() });
    },
    async sync(fold: Id) {
      const pending = await stores.oplog.listPending(fold);
      if (pending.length > 0) {
        service.relay.push(fold, pending.map((o) => o.sealed));
        await stores.oplog.markPushed(fold, pending.map((o) => o.sealed.op));
      }
      let applied = 0;
      const quarantined: string[] = [];
      // Always from the start: ops already held are duplicates, and ops that could not be placed yet get another chance.
      const cursorKey = `${fold}`;
      const pulled = service.relay.pull(fold, 0n, 10_000);
      for (const { sealed } of pulled.ops) {
        const r = await writePath.applyRemote(sealed);
        if (r.ok && r.value.kind === 'applied') applied += 1;
        if (r.ok && r.value.kind === 'quarantined') quarantined.push(r.value.reason);
      }
      self.cursors.set(cursorKey, pulled.head);
      return { applied, quarantined };
    },
    async ledger(fold: Id) {
      return buildLedger(await stores.projections.listRecords(fold), undefined, { member: account });
    },
    async bundle() {
      return bundle;
    },
    async code() {
      return encodeInvitationCode(bundle);
    },
    forge: (op: Parameters<OpSealerPort['seal']>[0]) => sealer.seal(op),
  });
  return self;
}

export const worldFold = (n: number): Id => id(0xf000 + n);
export const asLocalDate = (n: number): LocalDate => n as LocalDate;
