import type { AccountRow, Bytes, DeviceRow, OpRow, PushOutcome, RecoveryRow, RateTableRow, SnapshotRow, Store, StoredOp } from './store.js';

const hex = (b: Bytes): string => Buffer.from(b).toString('hex');

interface FoldState {
  createdAtMs: number;
  headSeq: bigint;
  members: Map<string, { role: number; fromEpoch: number; removedAtMs: number | null }>;
  log: Array<{ entry: Uint8Array; hash: Uint8Array }>;
  ops: StoredOp[];
  byOpId: Map<string, StoredOp>;
  /** Highest device sequence ever stored, kept after pruning so the sequence check survives it. */
  lastSeq: Map<string, bigint>;
  acks: Map<string, bigint>;
  grants: Map<string, { epoch: number; grant: Uint8Array }>;
  snapshot?: SnapshotRow;
  chunks: Map<string, Uint8Array>;
}

/** A complete in-memory store. Same behaviour as PostgreSQL, checked by the shared contract tests. */
export function createMemoryStore(): Store {
  const accounts = new Map<string, AccountRow>();
  const recoveries = new Map<string, RecoveryRow>();
  const byEmail = new Map<string, string>();
  const tombstones = new Set<string>();
  const devices = new Map<string, DeviceRow>();
  const verifications = new Map<string, { accountId: string; expiresAtMs: number; used: boolean }>();
  const folds = new Map<string, FoldState>();
  let rateTable: RateTableRow | undefined;

  const fold = (id: Bytes): FoldState | undefined => folds.get(hex(id));

  return {
    accounts: {
      async create(row) {
        if (accounts.has(row.accountId)) return 'id_taken';
        if (byEmail.has(hex(row.emailHmac))) return 'email_taken';
        accounts.set(row.accountId, { ...row, bundleSig: row.bundleSig ?? null, failCount: 0, lockedUntilMs: null, emailVerifiedAtMs: null });
        byEmail.set(hex(row.emailHmac), row.accountId);
        return 'ok';
      },
      async byEmailHmac(hmac) {
        const id = byEmail.get(hex(hmac));
        return id === undefined ? undefined : accounts.get(id);
      },
      async byId(id) {
        return accounts.get(id);
      },
      async replaceCredentials(id, next) {
        const a = accounts.get(id);
        if (a !== undefined) accounts.set(id, { ...a, ...next, failCount: 0, lockedUntilMs: null });
      },
      async recordFailure(id, lockedUntilMs) {
        const a = accounts.get(id);
        if (a === undefined) return 0;
        accounts.set(id, { ...a, failCount: a.failCount + 1, lockedUntilMs });
        return a.failCount + 1;
      },
      async clearFailures(id) {
        const a = accounts.get(id);
        if (a !== undefined) accounts.set(id, { ...a, failCount: 0, lockedUntilMs: null });
      },
      async setEmailVerified(id, atMs) {
        const a = accounts.get(id);
        if (a !== undefined) accounts.set(id, { ...a, emailVerifiedAtMs: atMs });
      },
      async setDiscoverable(id, value) {
        const a = accounts.get(id);
        if (a !== undefined) accounts.set(id, { ...a, discoverable: value });
      },
      async remove(id) {
        const a = accounts.get(id);
        if (a === undefined) return;
        accounts.delete(id);
        recoveries.delete(id);
        byEmail.delete(hex(a.emailHmac));
        for (const [k, d] of devices) if (d.accountId === id) devices.delete(k);
        for (const f of folds.values()) f.members.delete(id);
        for (const [k, v] of verifications) if (v.accountId === id) verifications.delete(k);
        tombstones.add(id);
      },
      async isTombstoned(id) {
        return tombstones.has(id);
      },
    },
    recovery: {
      async get(id) {
        return recoveries.get(id);
      },
      async put(id, row) {
        if (accounts.has(id)) recoveries.set(id, row);
      },
      async remove(id) {
        recoveries.delete(id);
      },
    },
    devices: {
      async add(row) {
        const k = hex(row.devId);
        if (devices.has(k)) return 'exists';
        devices.set(k, row);
        return 'ok';
      },
      async list(accountId) {
        return [...devices.values()].filter((d) => d.accountId === accountId).sort((a, b) => a.createdAtMs - b.createdAtMs);
      },
      async get(devId) {
        return devices.get(hex(devId));
      },
      async revoke(accountId, devId, atMs) {
        const d = devices.get(hex(devId));
        if (d === undefined || d.accountId !== accountId || d.revokedAtMs !== null) return false;
        devices.set(hex(devId), { ...d, revokedAtMs: atMs });
        return true;
      },
      async setLabel(accountId, devId, labelCt) {
        const d = devices.get(hex(devId));
        if (d === undefined || d.accountId !== accountId || d.revokedAtMs !== null) return false;
        devices.set(hex(devId), { ...d, labelCt });
        return true;
      },
    },
    emailVerification: {
      async put(accountId, tokenHash, expiresAtMs) {
        verifications.set(hex(tokenHash), { accountId, expiresAtMs, used: false });
      },
      async consume(tokenHash, nowMs) {
        const v = verifications.get(hex(tokenHash));
        if (v === undefined || v.used || v.expiresAtMs <= nowMs) return undefined;
        v.used = true;
        return v.accountId;
      },
    },
    folds: {
      async create(foldId, owner, atMs) {
        if (fold(foldId) !== undefined) return 'exists';
        folds.set(hex(foldId), { createdAtMs: atMs, headSeq: 0n, members: new Map([[owner, { role: 1, fromEpoch: 1, removedAtMs: null }]]), log: [], ops: [], byOpId: new Map(), lastSeq: new Map(), acks: new Map(), grants: new Map(), chunks: new Map() });
        return 'ok';
      },
      async list(accountId) {
        return [...folds].filter(([, f]) => f.members.get(accountId)?.removedAtMs === null).map(([k, f]) => ({ foldId: Buffer.from(k, 'hex'), headSeq: f.headSeq }));
      },
      async roleOf(foldId, accountId) {
        const m = fold(foldId)?.members.get(accountId);
        return m?.removedAtMs === null ? m.role : undefined;
      },
      async member(foldId, accountId) {
        return fold(foldId)?.members.get(accountId);
      },
      async addMember(foldId, accountId, role, fromEpoch) {
        fold(foldId)?.members.set(accountId, { role, fromEpoch, removedAtMs: null });
      },
      async setRole(foldId, accountId, role) {
        const m = fold(foldId)?.members.get(accountId);
        if (m !== undefined) fold(foldId)!.members.set(accountId, { ...m, role });
      },
      async removeMember(foldId, accountId, atMs) {
        const m = fold(foldId)?.members.get(accountId);
        if (m !== undefined) fold(foldId)!.members.set(accountId, { ...m, removedAtMs: atMs });
      },
      async members(foldId) {
        return [...(fold(foldId)?.members ?? [])].filter(([, m]) => m.removedAtMs === null).map(([account]) => account);
      },
      async remove(foldId) {
        folds.delete(hex(foldId));
      },
    },
    log: {
      async append(foldId, idx, entry, hash) {
        const f = fold(foldId);
        if (f === undefined || idx !== f.log.length) return 'conflict';
        f.log.push({ entry, hash });
        return 'ok';
      },
      async list(foldId, after) {
        const log = fold(foldId)?.log ?? [];
        return { entries: log.slice(after + 1).map((l) => l.entry), head: log.length - 1 };
      },
      async last(foldId) {
        const log = fold(foldId)?.log ?? [];
        const l = log.at(-1);
        return l === undefined ? undefined : { idx: log.length - 1, hash: l.hash, entry: l.entry };
      },
    },
    grants: {
      async put(foldId, member, epoch, grant) {
        const f = fold(foldId);
        if (f !== undefined) f.grants.set(`${member}:${epoch}`, { epoch, grant });
      },
      async forMember(foldId, member) {
        return [...(fold(foldId)?.grants.entries() ?? [])].filter(([k]) => k.startsWith(`${member}:`)).map(([, v]) => v).sort((a, b) => a.epoch - b.epoch).map((v) => v.grant);
      },
    },
    ops: {
      async push(foldId, ops) {
        const f = fold(foldId);
        if (f === undefined) return ops.map((o): PushOutcome => ({ op: o.opId, status: 'seq_gap' }));
        const out: PushOutcome[] = [];
        for (const op of ops) {
          const known = f.byOpId.get(hex(op.opId));
          if (known !== undefined) {
            out.push({ op: op.opId, status: 'duplicate', serverSeq: known.serverSeq });
            continue;
          }
          const last = f.lastSeq.get(hex(op.devId)) ?? 0n;
          if (op.devSeq <= last) out.push({ op: op.opId, status: 'seq_conflict' });
          else if (op.devSeq !== last + 1n) out.push({ op: op.opId, status: 'seq_gap' });
          else {
            f.headSeq += 1n;
            const stored: StoredOp = { ...op, serverSeq: f.headSeq };
            f.ops.push(stored);
            f.byOpId.set(hex(op.opId), stored);
            f.lastSeq.set(hex(op.devId), op.devSeq);
            out.push({ op: op.opId, status: 'stored', serverSeq: f.headSeq });
          }
        }
        return out;
      },
      async pull(foldId, after, limit, minEpoch = 0) {
        const f = fold(foldId);
        if (f === undefined) return { ops: [], head: 0n, more: false };
        const rest = f.ops.filter((o) => o.serverSeq > after && o.epoch >= minEpoch);
        return { ops: rest.slice(0, limit), head: f.headSeq, more: rest.length > limit };
      },
      async head(foldId) {
        return fold(foldId)?.headSeq ?? 0n;
      },
      async lastDevSeq(foldId, devId) {
        return fold(foldId)?.lastSeq.get(hex(devId)) ?? 0n;
      },
    },
    snapshots: {
      async put(row) {
        const f = fold(row.foldId);
        if (f !== undefined && (f.snapshot === undefined || row.atSeq >= f.snapshot.atSeq)) f.snapshot = row;
      },
      async get(foldId) {
        return fold(foldId)?.snapshot;
      },
      async acknowledge(foldId, devId, seq) {
        const f = fold(foldId);
        if (f === undefined) return;
        const k = hex(devId);
        if (seq > (f.acks.get(k) ?? 0n)) f.acks.set(k, seq);
      },
      async folds() {
        return [...folds.values()].filter((f) => f.snapshot !== undefined).map((f) => f.snapshot!.foldId);
      },
      async prune(foldId) {
        const f = fold(foldId);
        if (f?.snapshot === undefined) return 0;
        const at = f.snapshot.atSeq;
        const active = [...devices.values()].filter((d) => d.revokedAtMs === null && f.members.get(d.accountId)?.removedAtMs === null);
        if (active.length === 0 || active.some((d) => (f.acks.get(hex(d.devId)) ?? 0n) < at)) return 0;
        const keep = f.ops.filter((o) => o.serverSeq > at);
        const removed = f.ops.length - keep.length;
        for (const o of f.ops) if (o.serverSeq <= at) f.byOpId.delete(hex(o.opId));
        f.ops = keep;
        return removed;
      },
    },
    attachments: {
      async putChunk(foldId, attId, index, data, quota) {
        const f = fold(foldId);
        if (f === undefined) return 'conflict';
        const key = `${hex(attId)}:${index}`;
        const had = f.chunks.get(key);
        if (had !== undefined) return Buffer.from(had).equals(Buffer.from(data)) ? 'ok' : 'conflict';
        if (quota !== undefined && f.chunks.size >= quota) return 'quota';
        f.chunks.set(key, Uint8Array.from(data));
        return 'ok';
      },
      async getChunk(foldId, attId, index) {
        return fold(foldId)?.chunks.get(`${hex(attId)}:${index}`);
      },
      async chunkCount(foldId) {
        return fold(foldId)?.chunks.size ?? 0;
      },
    },
    rates: {
      async put(row) {
        if (rateTable === undefined || row.asOfMs >= rateTable.asOfMs) rateTable = row;
      },
      async latest() {
        return rateTable;
      },
    },
    async close() {
      accounts.clear();
      recoveries.clear();
    },
  };
}
export type { OpRow };
