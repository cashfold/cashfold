import type { Id } from '../shared-kernel/id';
import { applyOpInto, DELETED_FIELD, type FieldValue, type FoldState, type Op, type RecordState, type SetDelta } from '../sync/domain/merge';
import { compareHlc, receive, tick, ZERO_HLC, type Hlc } from '../sync/domain/hlc';
import type { OpDraft } from '../sync/application/write-path';
import { MemoryRelay } from './relay';
import { createRng, type Rng } from './rng';
import { createReplica, createWorld, id, type Replica, type World } from './world';

export interface ClusterOptions {
  readonly replicas: number;
  readonly fold?: Id;
}

export interface Cluster {
  readonly fold: Id;
  readonly world: World;
  readonly relay: MemoryRelay;
  readonly replicas: readonly Replica[];
  edit(index: number, draft: Omit<OpDraft, 'fold'>): Promise<void>;
  /** Push pending ops, then pull and apply everything new. Delivery may be shuffled and duplicated. */
  sync(index: number, delivery?: { rng: Rng; duplicates: boolean }): Promise<void>;
  setOffline(index: number, offline: boolean): void;
  isOffline(index: number): boolean;
  /** Brings every replica online and syncs until nothing changes. */
  settle(): Promise<void>;
  states(): Promise<FoldState[]>;
}

export async function createCluster({ replicas, fold = id(0xf0) }: ClusterOptions): Promise<Cluster> {
  const world = await createWorld();
  world.addFold(fold);
  const relay = new MemoryRelay();
  const nodes: Replica[] = [];
  for (let i = 0; i < replicas; i++) nodes.push(await createReplica(world, { device: id(0xd0 + i), nowMs: 1_700_000_000_000 + i * 7 }));
  const cursors = nodes.map(() => 0n);
  const offline = nodes.map(() => false);

  const cluster: Cluster = {
    fold, world, relay, replicas: nodes,

    async edit(index, draft) {
      const r = await nodes[index]!.writePath.submit({ ...draft, fold });
      if (!r.ok) throw new Error(`edit failed: ${r.error.code}`);
    },

    async sync(index, delivery) {
      if (offline[index]) return;
      const node = nodes[index]!;
      const pending = await node.oplog.listPending(fold);
      if (pending.length > 0) {
        relay.push(fold, pending.map((p) => p.sealed));
        await node.oplog.markPushed(fold, pending.map((p) => p.sealed.op));
      }
      const pulled = relay.pull(fold, cursors[index]!, Number.MAX_SAFE_INTEGER);
      let batch = pulled.ops.map((o) => o.sealed);
      if (delivery !== undefined) {
        batch = delivery.rng.shuffle(batch);
        if (delivery.duplicates) batch = [...batch, ...batch.filter(() => delivery.rng.chance(0.3))];
      }
      for (const sealed of batch) {
        const r = await node.writePath.applyRemote(sealed);
        if (!r.ok) throw new Error('applyRemote failed');
      }
      cursors[index] = pulled.head;
    },

    setOffline(index, value) {
      offline[index] = value;
    },
    isOffline: (index) => offline[index]!,

    async settle() {
      offline.fill(false);
      for (let round = 0; round < nodes.length + 2; round++) {
        const before = relay.size(fold);
        for (let i = 0; i < nodes.length; i++) await cluster.sync(i);
        if (relay.size(fold) === before && round > 0) break;
      }
    },

    async states() {
      return Promise.all(nodes.map((n) => n.projections.listRecords(fold)));
    },
  };
  return cluster;
}

const RECORDS = [id(0x101), id(0x102), id(0x103)];
const MEMBERS = [id(0x51), id(0x52), id(0x53)];
const SET_FIELD = 20;

function randomValue(rng: Rng): FieldValue {
  return rng.pick<FieldValue>([BigInt(rng.int(1000) - 500), `s${rng.int(5)}`, rng.chance(0.5), null, rng.bytes(2)]);
}

async function randomDraft(rng: Rng, replica: Replica, fold: Id): Promise<Omit<OpDraft, 'fold'>> {
  const rec = rng.pick(RECORDS);
  const fields = new Map<number, FieldValue>();
  for (let n = rng.int(3); n >= 0; n--) fields.set(1 + rng.int(4), randomValue(rng));
  if (rng.chance(0.15)) fields.set(DELETED_FIELD, rng.chance(0.5));
  const sets = new Map<number, SetDelta>();
  if (rng.chance(0.3)) {
    const member = rng.pick(MEMBERS);
    const current = (await replica.projections.getRecord(fold, rec))?.sets.get(SET_FIELD)?.adds.get(member);
    const observed = current === undefined ? [] : [...current];
    sets.set(SET_FIELD, rng.chance(0.6) || observed.length === 0
      ? { add: [member], rem: [] }
      : { add: [], rem: observed.map((tag): [Id, Id] => [member, tag]) });
  }
  return { rec, table: 6, fields, sets };
}

export interface ScenarioResult {
  readonly converged: boolean;
  readonly opCount: number;
  readonly quarantined: number;
  readonly states: FoldState[];
}

/** Random edits, syncs with shuffled and duplicated delivery, and partitions; then everyone reconnects. SC-004. */
export async function runScenario(seed: number, opts: { replicas?: number; steps?: number } = {}): Promise<ScenarioResult> {
  const rng = createRng(seed);
  const cluster = await createCluster({ replicas: opts.replicas ?? 2 + rng.int(3) });
  const n = cluster.replicas.length;
  for (let step = 0; step < (opts.steps ?? 30); step++) {
    const i = rng.int(n);
    const roll = rng.next();
    if (roll < 0.6) await cluster.edit(i, await randomDraft(rng, cluster.replicas[i]!, cluster.fold));
    else if (roll < 0.9) await cluster.sync(i, { rng, duplicates: rng.chance(0.5) });
    else cluster.setOffline(i, !cluster.isOffline(i));
  }
  await cluster.settle();
  const states = await cluster.states();
  let quarantined = 0;
  for (const r of cluster.replicas) quarantined += (await r.oplog.listQuarantined(cluster.fold)).length;
  const first = states[0]!;
  const same = (a: FoldState, b: FoldState) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  return { converged: states.every((s) => same(s, first)), opCount: cluster.relay.size(cluster.fold), quarantined, states };
}

function canonical(state: FoldState): unknown {
  const bytes = (v: unknown): unknown => (v instanceof Uint8Array ? Array.from(v) : v);
  return [...state].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rec, r]) => [
    rec, r.table, r.tableConflict,
    [...r.fields].sort(([a], [b]) => a - b).map(([f, e]) => [f, e.hlc, e.dev, e.opId, typeof e.value === 'bigint' ? `${e.value}n` : bytes(e.value)]),
    [...r.sets].sort(([a], [b]) => a - b).map(([f, s]) => [f, [...s.adds].map(([m, t]) => [m, [...t].sort()]).sort(), [...s.removed].map(([m, t]) => [m, [...t].sort()]).sort()]),
  ]);
}

/**
 * The same convergence property at the merge layer alone: no crypto, so thousands of trials run in a second.
 * Replicas edit offline with their own HLC, exchange ops in random order with duplicates, then compare.
 */
export function runMergeTrial(seed: number): { converged: boolean; opCount: number } {
  const rng = createRng(seed);
  const n = 2 + rng.int(3);
  const clocks: Hlc[] = Array.from({ length: n }, () => ZERO_HLC);
  const states = Array.from({ length: n }, () => new Map<Id, RecordState>());
  const all: Op[] = [];
  const inbox: Op[][] = Array.from({ length: n }, () => []);
  let opNo = 0;

  const edit = (i: number): void => {
    const now = 1000 + rng.int(50);
    const t = tick(clocks[i]!, now);
    if (!t.ok) throw new Error('clock overflow');
    clocks[i] = t.value;
    const rec = rng.pick(RECORDS);
    const fields = new Map<number, FieldValue>();
    for (let k = rng.int(3); k >= 0; k--) fields.set(1 + rng.int(3), randomValue(rng));
    if (rng.chance(0.1)) fields.set(DELETED_FIELD, rng.chance(0.5));
    const member = rng.pick(MEMBERS);
    const sets = new Map<number, SetDelta>();
    if (rng.chance(0.4)) {
      const observed = [...(states[i]!.get(rec)?.sets.get(SET_FIELD)?.adds.get(member) ?? [])];
      sets.set(SET_FIELD, rng.chance(0.6) || observed.length === 0 ? { add: [member], rem: [] } : { add: [], rem: observed.map((tag): [Id, Id] => [member, tag]) });
    }
    const op: Op = { id: id(0x10000 + opNo++), rec, dev: id(0xd0 + i), hlc: t.value, table: 6, fields, sets };
    applyOpInto(states[i]!, op);
    all.push(op);
    for (let j = 0; j < n; j++) if (j !== i) inbox[j]!.push(op);
  };

  const deliver = (i: number): void => {
    const batch = rng.shuffle(inbox[i]!.splice(0, inbox[i]!.length));
    for (const op of rng.chance(0.5) ? [...batch, ...batch.filter(() => rng.chance(0.3))] : batch) {
      const r = receive(clocks[i]!, op.hlc, 1000);
      if (r.ok && compareHlc(r.value, clocks[i]!) > 0) clocks[i] = r.value;
      applyOpInto(states[i]!, op);
    }
  };

  for (let step = 0; step < 40; step++) {
    const i = rng.int(n);
    if (rng.chance(0.65)) edit(i);
    else deliver(i);
  }
  for (let i = 0; i < n; i++) deliver(i);
  const reference = JSON.stringify(canonical(states[0]!));
  return { converged: states.every((s) => JSON.stringify(canonical(s)) === reference), opCount: all.length };
}
